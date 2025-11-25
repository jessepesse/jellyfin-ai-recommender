
import { z } from 'zod';
import axios from 'axios';
import ConfigService from './services/config';
import { JellyfinAuthResponse } from './types';
import { sanitizeConfigUrl, validateRequestUrl, validateSafeUrl } from './utils/ssrf-protection';

// Custom URL validator that allows local IPs and HTTP
const urlSchema = z.string().refine(
    (val) => {
        if (!val) return true; // Optional field
        try {
            const url = new URL(val);
            // Allow http and https only
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch {
            return false;
        }
    },
    { message: "Invalid server URL format" }
);

// Zod schema for login request body
export const LoginSchema = z.object({
    username: z.string().min(1, "Username is required"),
    password: z.string().min(1, "Password is required"),
    serverUrl: urlSchema.optional(),
});

export class AuthService {
    private static cleanBaseUrl(inputUrl: string): string {
        if (!inputUrl) return '';
        // Use permissive validation for user-provided URLs
        const sanitized = sanitizeConfigUrl(inputUrl);
        if (!sanitized) return '';
        // Remove /web and anything after it (common client path)
        const clean = sanitized.split('/web')[0];
        return clean;
    }
    public async authenticateUser(username: string, password: string, serverUrl?: string): Promise<JellyfinAuthResponse> {
        const cfg = await ConfigService.getConfig();
        let baseUrl = serverUrl || cfg.jellyfinUrl || process.env.JELLYFIN_URL;
        if (!baseUrl) throw new Error('Jellyfin server URL not configured. Please set via Setup Wizard or JELLYFIN_URL env.');
        
        console.debug(`[Auth] Raw input URL: ${baseUrl}`);
        
        // Clean common browser-paste URLs (strip /web, hash fragments, trailing slashes)
        baseUrl = AuthService.cleanBaseUrl(String(baseUrl));
        
        if (!baseUrl) {
            throw new Error('No Jellyfin URL provided or invalid. Ensure URL uses http:// or https:// protocol and is not a blocked endpoint.');
        }
        
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
            const endpoint = validateRequestUrl(`${candidate}/Users/AuthenticateByName`);
            try {
                console.debug(`[Auth] Attempting login to: ${endpoint}`);
                // SSRF Protection: Explicit validation immediately before axios call breaks CodeQL taint flow
                const response = await axios.post<JellyfinAuthResponse>(validateSafeUrl(endpoint), authBody, { headers: authHeaders, timeout: 10000 });
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

