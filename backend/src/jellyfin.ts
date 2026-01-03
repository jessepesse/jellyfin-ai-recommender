import axios, { AxiosError } from 'axios';
import { JellyfinItem, JellyfinLibrary, HttpError } from './types'; // Removed JellyfinAuthResponse, JellyfinUser as authenticateUser moved
import ConfigService from './services/config';
import { sanitizeUrl, validateRequestUrl, validateSafeUrl } from './utils/ssrf-protection';

/**
 * Custom error for Jellyfin authentication failures (401)
 * This error should be propagated to frontend to trigger token refresh
 */
export class JellyfinAuthError extends Error {
    public readonly statusCode: number = 401;
    public readonly isAuthError: boolean = true;

    constructor(message: string = 'Jellyfin token expired or invalid - please re-login') {
        super(message);
        this.name = 'JellyfinAuthError';
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Check if an axios error is a 401 authentication error
 */
function isAuthError(error: unknown): boolean {
    const err = error as AxiosError;
    return err?.response?.status === 401;
}

// Query parameters interface for Jellyfin API calls
interface JellyfinQueryParams {
    ParentId?: string;
    Recursive?: boolean;
    IncludeItemTypes?: string;
    Fields?: string;
    SearchTerm?: string;
    userId?: string;
    Filters?: string;
    SortBy?: string;
    SortOrder?: string;
    EnableUserData?: boolean;
    Limit?: number;
}

export class JellyfinService {

    private static async getBaseUrl(override?: string): Promise<string | null> {
        // Treat "none" or empty string as no override (fallback to DB/env)
        const cleanOverride = sanitizeUrl(override);
        if (cleanOverride) return cleanOverride;

        try {
            const cfg = await ConfigService.getConfig();
            const raw = cfg && cfg.jellyfinUrl ? String(cfg.jellyfinUrl) : (process.env.JELLYFIN_URL || '');
            // SSRF Protection: validate URL before use
            const validated = sanitizeUrl(raw);
            if (!validated) throw new Error('Jellyfin URL not configured or invalid');
            return validated;
        } catch (e) {
            const raw = process.env.JELLYFIN_URL || '';
            // SSRF Protection: validate URL before use
            const validated = sanitizeUrl(raw);
            if (!validated) throw new Error('Jellyfin URL not configured or invalid');
            return validated;
        }
    }

    private static getHeaders(accessToken?: string) {
        const token = accessToken ? String(accessToken).trim() : '';
        if (!token) {
            throw new Error('Authentication Failed: No User Access Token provided. Please log in again.');
        }
        return {
            'X-Emby-Token': token,
            'X-Emby-Authorization': `MediaBrowser Client="Jellyfin AI", Device="Web", DeviceId="ai-recommender", Version="1.0.0", Token="${token}"`
        } as Record<string, string>;
    }

    // Removed authenticateUser as it's now in AuthService

    public async getLibraries(accessToken: string, serverUrl?: string): Promise<JellyfinLibrary[]> {
        const baseRaw = await JellyfinService.getBaseUrl(serverUrl);
        if (!baseRaw) {
            console.warn('[Jellyfin] getLibraries: No Jellyfin base URL configured');
            return [];
        }
        const base = baseRaw.endsWith('/') ? baseRaw.slice(0, -1) : baseRaw;
        const headers = JellyfinService.getHeaders(accessToken);
        try {
            // Diagnostic: log which base URL we are using for this request (debug level)
            console.debug(`[Jellyfin] getLibraries using base: ${base}`);
            const url = validateRequestUrl(`${base}/Library/VirtualFolders`);
            // SSRF Protection: Explicit validation immediately before axios call breaks CodeQL taint flow
            // codeql[js/request-forgery] - User-configured Jellyfin URL, validated by validateSafeUrl
            const response = await axios.get<any>(validateSafeUrl(url), { headers, timeout: 10000 });
            return response.data.Items || [];
        } catch (error) {
            const err = error as AxiosError;
            // Propagate 401 errors to frontend for token refresh
            if (isAuthError(error)) {
                console.error('[Jellyfin] AUTH ERROR: Token expired or invalid (401) - user needs to re-login');
                throw new JellyfinAuthError();
            }
            console.error('[Jellyfin] Error fetching libraries:', err?.response?.status, err?.response?.data ?? err?.message ?? err);
            return [];
        }
    }

    public async getItems(userId: string, accessToken: string, libraryId: string, searchTerm?: string, serverUrl?: string): Promise<JellyfinItem[]> {
        try {
            const baseRaw = await JellyfinService.getBaseUrl(serverUrl);
            if (!baseRaw) throw new Error('Jellyfin base URL not configured');
            const base = baseRaw.endsWith('/') ? baseRaw.slice(0, -1) : baseRaw;
            const headers = JellyfinService.getHeaders(accessToken);

            const params: JellyfinQueryParams = {
                ParentId: libraryId,
                Recursive: true,
                IncludeItemTypes: 'Movie,Series',
                Fields: 'Genres,CommunityRating,Overview,ImageTags',
            };

            if (searchTerm) {
                params.SearchTerm = searchTerm;
            }

            const url = validateRequestUrl(`${base}/Users/${userId}/Items`);
            // SSRF Protection: Explicit validation immediately before axios call breaks CodeQL taint flow
            // codeql[js/request-forgery] - User-configured Jellyfin URL, validated by validateSafeUrl
            const response = await axios.get<any>(validateSafeUrl(url), { headers, params, timeout: 10000 });

            const items: JellyfinItem[] = response.data.Items;

            return items.map(item => {
                if (item.ImageTags?.Primary) {
                    item.imageUrl = `${base}/Items/${item.Id}/Images/Primary?maxHeight=300&tag=${item.ImageTags.Primary}`;
                }
                return item;
            });

        } catch (error) {
            const err = error as AxiosError;
            // Propagate 401 errors to frontend for token refresh
            if (isAuthError(error)) {
                console.error('[Jellyfin] AUTH ERROR: Token expired or invalid (401) while fetching items - user needs to re-login');
                throw new JellyfinAuthError();
            }
            console.error('[Jellyfin] Error fetching items from library %s: status=%s', libraryId, err?.response?.status, err?.response?.data ?? err?.message ?? err);
            throw error;
        }
    }

    /**
     * Fetch ONLY watched items (IsPlayed filter) from Jellyfin.
     * This ensures we get actual watch history, not the entire library.
     */
    public async getUserHistory(userId: string, accessToken: string, limit: number = 200, serverUrl?: string): Promise<JellyfinItem[]> {
        try {
            const baseRaw = await JellyfinService.getBaseUrl(serverUrl);
            if (!baseRaw) throw new Error('Jellyfin base URL not configured');
            const base = baseRaw.endsWith('/') ? baseRaw.slice(0, -1) : baseRaw;
            const headers = JellyfinService.getHeaders(accessToken);

            // STRICT filters: Only return items the user has actually watched
            const params: JellyfinQueryParams = {
                Recursive: true,
                IncludeItemTypes: 'Movie,Episode',  // Movies and Episodes
                Filters: 'IsPlayed',               // CRITICAL: Only watched items
                SortBy: 'DatePlayed',              // Sort by when they were watched
                SortOrder: 'Descending',           // Newest watches first
                Limit: limit,
                Fields: 'ProviderIds,Overview,Genres,CommunityRating,ProductionYear,PremiereDate,UserData,DateCreated,RunTimeTicks,SeriesId,SeriesName',
            };

            console.debug(`[Jellyfin] Fetching watched history: ${base}/Users/${userId}/Items (limit: ${limit})`);
            const url = validateRequestUrl(`${base}/Users/${userId}/Items`);
            // SSRF Protection: Explicit validation immediately before axios call breaks CodeQL taint flow
            // codeql[js/request-forgery] - User-configured Jellyfin URL, validated by validateSafeUrl
            const response = await axios.get<any>(validateSafeUrl(url), { headers, params, timeout: 15000 });
            const items: JellyfinItem[] = response.data.Items || [];

            console.debug(`[Jellyfin] Retrieved ${items.length} watched items`);

            return items.map(item => {
                if (item.ImageTags?.Primary) {
                    item.imageUrl = `${base}/Items/${item.Id}/Images/Primary?maxHeight=300&tag=${item.ImageTags.Primary}`;
                }
                return item;
            });
        } catch (error) {
            const err = error as AxiosError;
            // Propagate 401 errors to frontend for token refresh
            if (isAuthError(error)) {
                console.error('[Jellyfin] AUTH ERROR: Token expired or invalid (401) while fetching history - user needs to re-login');
                throw new JellyfinAuthError();
            }
            // Use parameterized logging to prevent format string injection
            console.error('[Jellyfin] Error fetching user history: status=%s', err?.response?.status, err?.response?.data ?? err?.message ?? err);
            return [];
        }
    }

    /**
     * Return a Set of identifiers representing items owned in the user's Jellyfin library.
     * Each entry will be either `tmdb:<id>` when a TMDB provider id is present, or
     * `titleyear:<normalized title>::<year>` for title+year matching fallback.
     */
    public async getOwnedIds(userId: string, accessToken: string, serverUrl?: string): Promise<Set<string>> {
        try {
            const baseRaw = await JellyfinService.getBaseUrl(serverUrl);
            if (!baseRaw) {
                console.warn('getOwnedIds: No Jellyfin base URL configured');
                return new Set();
            }
            const base = baseRaw.endsWith('/') ? baseRaw.slice(0, -1) : baseRaw;
            const headers = JellyfinService.getHeaders(accessToken);

            // Fetch the user's libraries and aggregate items similarly to getItems logic
            let libs: JellyfinLibrary[] = [];
            try {
                libs = (await this.getLibraries(accessToken, serverUrl)) || [];
            } catch (e) {
                console.warn('Failed to fetch libraries for ownedId extraction', e);
                libs = [];
            }
            const pools = libs.length ? await Promise.all(libs.map(l => {
                const url = validateRequestUrl(`${base}/Users/${userId}/Items`);
                // codeql[js/request-forgery] - False positive: URL validated 3x (sanitizeUrl in getBaseUrl, validateRequestUrl, validateSafeUrl)
                return axios.get<{ Items: JellyfinItem[] }>(validateSafeUrl(url), { headers, params: { ParentId: l.Id, Recursive: true, IncludeItemTypes: 'Movie,Series', Fields: 'ProviderIds,ProductionYear,Name,PremiereDate' }, timeout: 15000 }).then(r => r.data.Items || []).catch(() => [] as JellyfinItem[]);
            })) : [];
            const items = (pools || []).flat();

            const owned = new Set<string>();
            const normalize = (s: string) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^the|^a/, '').trim();

            for (const it of items) {
                // Try provider IDs first
                const providerIds = it?.ProviderIds || {};
                const tmdb = providerIds?.Tmdb ?? providerIds?.tmdb ?? null;
                if (tmdb) {
                    owned.add(`tmdb:${String(tmdb)}`);
                }

                const title = it?.Name || '';
                const year = it?.ProductionYear || (it?.PremiereDate ? String(it.PremiereDate).substring(0, 4) : '') || '';
                if (title) {
                    const key = `titleyear:${normalize(title)}::${String(year || '')}`;
                    owned.add(key);
                }
            }

            return owned;
        } catch (e) {
            const err = e as AxiosError;
            // Propagate 401 errors to frontend for token refresh
            if (isAuthError(e)) {
                console.error('[Jellyfin] AUTH ERROR: Token expired or invalid (401) while fetching owned IDs - user needs to re-login');
                throw new JellyfinAuthError();
            }
            console.error('[Jellyfin] Failed to compute owned IDs:', err?.response?.status, err?.message ?? err);
            return new Set();
        }
    }

    /**
     * Validate a token and get the current user's profile from Jellyfin.
     * Used by auth middleware to verify identity of Admin users.
     */
    public async getMe(accessToken: string, serverUrl?: string): Promise<{ Id: string, Name: string, Policy: { IsAdministrator: boolean } } | null> {
        try {
            const baseRaw = await JellyfinService.getBaseUrl(serverUrl);
            if (!baseRaw) return null;

            const base = baseRaw.endsWith('/') ? baseRaw.slice(0, -1) : baseRaw;
            const headers = JellyfinService.getHeaders(accessToken);

            const url = validateRequestUrl(`${base}/Users/Me`);

            // codeql[js/request-forgery] - internal utility with validated URL
            const response = await axios.get<any>(validateSafeUrl(url), { headers, timeout: 5000 });

            if (response.data && response.data.Id) {
                return {
                    Id: response.data.Id,
                    Name: response.data.Name,
                    Policy: {
                        IsAdministrator: response.data.Policy?.IsAdministrator || false
                    }
                };
            }
            return null;
        } catch (error) {
            // 401 means invalid token
            if (isAuthError(error)) {
                return null;
            }
            console.error('[Jellyfin] Error in getMe:', (error as any).message);
            return null;
        }
    }
}

