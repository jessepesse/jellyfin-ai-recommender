import axios from 'axios';
import { JellyfinItem, JellyfinLibrary } from './types'; // Removed JellyfinAuthResponse, JellyfinUser as authenticateUser moved
import ConfigService from './services/config';
import { sanitizeUrl, validateRequestUrl } from './utils/ssrf-protection';

export class JellyfinService {

    private static async getBaseUrl(override?: string): Promise<string | null> {
        // Treat "none" or empty string as no override (fallback to DB/env)
        const cleanOverride = sanitizeUrl(override);
        if (cleanOverride) return cleanOverride;
        
        try {
            const cfg = await ConfigService.getConfig();
            const raw = cfg && cfg.jellyfinUrl ? String(cfg.jellyfinUrl) : (process.env.JELLYFIN_URL || '');
            let clean = raw ? String(raw).trim() : '';
            // Remove trailing slashes safely (avoid ReDoS)
            while (clean.endsWith('/')) {
                clean = clean.slice(0, -1);
            }
            if (!clean) throw new Error('Jellyfin URL not configured');
            return clean;
        } catch (e) {
            const raw = process.env.JELLYFIN_URL || '';
            let clean = raw ? String(raw).trim() : '';
            // Remove trailing slashes safely (avoid ReDoS)
            while (clean.endsWith('/')) {
                clean = clean.slice(0, -1);
            }
            if (!clean) throw new Error('Jellyfin URL not configured');
            return clean;
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
        const base = await JellyfinService.getBaseUrl(serverUrl);
        if (!base) {
            console.warn('getLibraries: No Jellyfin base URL configured');
            return [];
        }
        const headers = JellyfinService.getHeaders(accessToken);
        try {
            // Diagnostic: log which base URL we are using for this request (debug level)
            console.debug(`[Jellyfin] getLibraries using base: ${base}`);
            const url = validateRequestUrl(`${base}/Library/VirtualFolders`);
            const response = await axios.get<any>(url, { headers, timeout: 10000 });
            return response.data.Items || [];
        } catch (error) {
            const err: any = error;
            console.error('Error fetching Jellyfin libraries:', err?.response?.status, err?.response?.data ?? err?.message ?? err);
            return [];
        }
    }

    public async getItems(userId: string, accessToken: string, libraryId: string, searchTerm?: string, serverUrl?: string): Promise<JellyfinItem[]> {
        try {
            const base = await JellyfinService.getBaseUrl(serverUrl);
            if (!base) throw new Error('Jellyfin base URL not configured');
            const headers = JellyfinService.getHeaders(accessToken);

            const params: any = {
                ParentId: libraryId,
                Recursive: true,
                IncludeItemTypes: 'Movie,Series',
                Fields: 'Genres,CommunityRating,Overview,ImageTags',
            };

            if (searchTerm) {
                params.SearchTerm = searchTerm;
            }

            const url = validateRequestUrl(`${base}/Users/${userId}/Items`);
            const response = await axios.get<any>(url, { headers, params, timeout: 10000 });
            
            const items: JellyfinItem[] = response.data.Items;

            return items.map(item => {
                if (item.ImageTags?.Primary) {
                    item.imageUrl = `${base}/Items/${item.Id}/Images/Primary?maxHeight=300&tag=${item.ImageTags.Primary}`;
                }
                return item;
            });

        } catch (error) {
            const err: any = error;
            console.error(`Error fetching items from library ${libraryId}:`, err?.response?.status, err?.response?.data ?? err?.message ?? err);
            throw error;
        }
    }

        /**
         * Fetch ONLY watched items (IsPlayed filter) from Jellyfin.
         * This ensures we get actual watch history, not the entire library.
         */
        public async getUserHistory(userId: string, accessToken: string, limit: number = 200, serverUrl?: string): Promise<JellyfinItem[]> {
            try {
                const base = await JellyfinService.getBaseUrl(serverUrl);
                if (!base) throw new Error('Jellyfin base URL not configured');
                const headers = JellyfinService.getHeaders(accessToken);
                
                // STRICT filters: Only return items the user has actually watched
                const params: any = {
                    Recursive: true,
                    IncludeItemTypes: 'Movie,Series',  // Movies and TV Series only (not Episodes)
                    Filters: 'IsPlayed',               // CRITICAL: Only watched items
                    SortBy: 'DatePlayed',              // Sort by when they were watched
                    SortOrder: 'Descending',           // Newest watches first
                    Limit: limit,
                    Fields: 'ProviderIds,Overview,Genres,CommunityRating,ProductionYear,PremiereDate,UserData,DateCreated',
                };
                
                console.debug(`[Jellyfin] Fetching watched history: ${base}/Users/${userId}/Items (limit: ${limit})`);
                const url = validateRequestUrl(`${base}/Users/${userId}/Items`);
                const response = await axios.get<any>(url, { headers, params, timeout: 15000 });
                const items: JellyfinItem[] = response.data.Items || [];
                
                console.debug(`[Jellyfin] Retrieved ${items.length} watched items`);
                
                return items.map(item => {
                    if (item.ImageTags?.Primary) {
                        item.imageUrl = `${base}/Items/${item.Id}/Images/Primary?maxHeight=300&tag=${item.ImageTags.Primary}`;
                    }
                    return item;
                });
            } catch (error) {
                const err: any = error;
                // Use parameterized logging to prevent format string injection
                console.error('Error fetching user history from Jellyfin: status=%s', err?.response?.status, err?.response?.data ?? err?.message ?? err);
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
                const base = await JellyfinService.getBaseUrl(serverUrl);
                if (!base) {
                    console.warn('getOwnedIds: No Jellyfin base URL configured');
                    return new Set();
                }
                const headers: any = JellyfinService.getHeaders(accessToken);

                // Fetch the user's libraries and aggregate items similarly to getItems logic
                let libs: any[] = [];
                try {
                    libs = (await this.getLibraries(accessToken, serverUrl)) || [];
                } catch (e) {
                    console.warn('Failed to fetch libraries for ownedId extraction', e);
                    libs = [];
                }
                const pools = libs.length ? await Promise.all(libs.map(l => {
                    const url = validateRequestUrl(`${base}/Users/${userId}/Items`);
                    return axios.get<any>(url, { headers, params: { ParentId: l.Id, Recursive: true, IncludeItemTypes: 'Movie,Series', Fields: 'ProviderIds,ProductionYear,Name,PremiereDate' }, timeout: 15000 }).then(r => r.data.Items || []).catch(() => []);
                })) : [];
                const items = (pools || []).flat();

                const owned = new Set<string>();
                const normalize = (s: string) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^the|^a/, '').trim();

                for (const it of items) {
                    // Try provider IDs first
                    const providerIds = it?.ProviderIds || it?.ProviderId || {};
                    const tmdb = providerIds?.Tmdb ?? providerIds?.TMDB ?? providerIds?.tmdb ?? null;
                    if (tmdb) {
                        owned.add(`tmdb:${String(tmdb)}`);
                    }

                    const title = it?.Name || it?.Title || it?.name || '';
                    const year = it?.ProductionYear || (it?.PremiereDate ? String(it.PremiereDate).substring(0,4) : '') || '';
                    if (title) {
                        const key = `titleyear:${normalize(title)}::${String(year || '')}`;
                        owned.add(key);
                    }
                }

                return owned;
            } catch (e) {
                const err: any = e;
                console.error('Failed to compute owned IDs from Jellyfin:', err?.response?.status, err?.response?.data ?? err?.message ?? err);
                return new Set();
            }
        }
}
