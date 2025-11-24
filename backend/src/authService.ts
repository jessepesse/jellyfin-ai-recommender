
import { z } from 'zod';
import axios from 'axios';
import ConfigService from './services/config';
import { JellyfinAuthResponse } from './types';

// Zod schema for login request body
export const LoginSchema = z.object({
    username: z.string().min(1, "Username is required"),
    password: z.string().min(1, "Password is required"),
    serverUrl: z.string().url("Invalid server URL").optional(),
});

export class AuthService {
    private static cleanBaseUrl(inputUrl: string): string {
        if (!inputUrl) return '';
        let clean = String(inputUrl).trim();
        // Remove hash fragments and anything after (e.g. #/home)
        clean = clean.replace(/#.*$/, '');
        // Remove /web and anything after it (common client path)
        clean = clean.split('/web')[0];
        // Remove trailing slashes
        clean = clean.replace(/\/+$/, '');
        return clean;
    }
    public async authenticateUser(username: string, password: string, serverUrl?: string): Promise<JellyfinAuthResponse> {
        const cfg = await ConfigService.getConfig();
        let baseUrl = serverUrl || cfg.jellyfinUrl || process.env.JELLYFIN_URL;
        if (!baseUrl) throw new Error('Jellyfin server URL not configured. Please set via Setup Wizard or JELLYFIN_URL env.');
        // Clean common browser-paste URLs (strip /web, hash fragments, trailing slashes)
        baseUrl = AuthService.cleanBaseUrl(String(baseUrl));
        console.debug(`[Auth] Sanitized URL to: ${baseUrl}`);

        // Candidate roots to try when authenticating. Prefer the sanitized root,
        // then common mounted prefixes used by some reverse proxies.
        const candidates = [baseUrl, `${baseUrl}/jellyfin`, `${baseUrl}/emby`].map(s => AuthService.cleanBaseUrl(s));

        const authHeaders = {
            'Content-Type': 'application/json',
            'X-Emby-Authorization': 'MediaBrowser Client="Jellyfin AI", Device="Web", DeviceId="ai-recommender", Version="1.0.0"'
        };

        const authBody = {
            Username: username,
            Pw: password
        };

        let lastError: any = null;

        for (const candidate of candidates) {
            const endpoint = `${candidate}/Users/AuthenticateByName`;
            try {
                console.debug(`[Auth] Attempting login to: ${endpoint}`);
                const response = await axios.post<JellyfinAuthResponse>(endpoint, authBody, { headers: authHeaders, timeout: 10000 });
                // If authentication succeeded and the candidate differs from stored config, persist it
                try {
                    if (candidate && candidate !== cfg.jellyfinUrl) {
                        await ConfigService.saveConfig({ jellyfinUrl: candidate });
                        console.debug(`[Auth] Persisted working Jellyfin URL to config: ${candidate}`);
                    }
                } catch (saveErr) {
                    console.warn('[Auth] Failed to persist working Jellyfin URL:', saveErr);
                }
                return response.data;
            } catch (err: any) {
                lastError = err;
                // If 404, try next candidate. For other errors, log details and rethrow.
                if (err?.response && err.response.status === 404) {
                    console.warn(`[Auth] Endpoint not found (404) at: ${endpoint} — trying next candidate`);
                    continue;
                }
                console.error(`[Auth] Login failed at ${endpoint}:`, err?.response ? { status: err.response.status, data: err.response.data } : err?.message || err);
                throw err;
            }
        }

        // If we exhausted candidates, throw the last error to be handled by the route.
        throw lastError || new Error('Failed to authenticate with Jellyfin (no response)');
    }
}

