import axios from 'axios';
import type { JellyfinItem, JellyfinLibrary, WeeklyWatchlist } from '../types';

// HARDCODE: Always use relative path /api
// This ensures requests go to the current origin + /api
// Docker/Nginx (or Vite proxy) will handle routing to the backend.
const BASE_URL = '/api';

const apiClient = axios.create({
    baseURL: BASE_URL,
});

// Track if we're currently refreshing to avoid multiple simultaneous refresh attempts
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function onTokenRefreshed(token: string) {
    refreshSubscribers.forEach(callback => callback(token));
    refreshSubscribers = [];
}

function addRefreshSubscriber(callback: (token: string) => void) {
    refreshSubscribers.push(callback);
}

// Response interceptor to handle 401 errors and token refresh
apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // If error is 401 and we haven't tried refreshing yet
        if (error.response?.status === 401 && !originalRequest._retry) {
            if (isRefreshing) {
                // Wait for the ongoing refresh to complete
                return new Promise((resolve) => {
                    addRefreshSubscriber((token: string) => {
                        originalRequest.headers['x-access-token'] = token;
                        resolve(apiClient(originalRequest));
                    });
                });
            }

            originalRequest._retry = true;
            isRefreshing = true;

            try {
                // Attempt to refresh the token by re-authenticating
                const storedUser = localStorage.getItem('jellyfin_user');
                const storedServer = localStorage.getItem('jellyfin_server');
                const jellyfinPassword = sessionStorage.getItem('jellyfin_password');

                if (storedUser && storedServer && jellyfinPassword) {
                    const user = JSON.parse(storedUser);
                    const response = await axios.post(`${BASE_URL}/auth/login`, {
                        username: user.name,
                        password: jellyfinPassword,
                        serverUrl: storedServer,
                    });

                    if (response.data.success && response.data.jellyfinAuth) {
                        const newToken = response.data.jellyfinAuth.AccessToken;
                        localStorage.setItem('jellyfin_token', newToken);

                        // Update original request with new token
                        originalRequest.headers['x-access-token'] = newToken;

                        // Notify all waiting requests
                        onTokenRefreshed(newToken);
                        isRefreshing = false;

                        // Retry the original request
                        return apiClient(originalRequest);
                    }
                }

                // If refresh failed, force logout
                isRefreshing = false;

                // Clear all auth data
                localStorage.removeItem('jellyfin_token');
                localStorage.removeItem('jellyfin_user');
                localStorage.removeItem('jellyfin_server');
                localStorage.removeItem('jellyfin_isAdmin');
                sessionStorage.removeItem('jellyfin_password');

                // Redirect to login by reloading the page
                // This will trigger AuthContext to show login screen
                window.location.reload();

                return Promise.reject(error);
            } catch (refreshError) {
                isRefreshing = false;

                // Clear all auth data
                localStorage.removeItem('jellyfin_token');
                localStorage.removeItem('jellyfin_user');
                localStorage.removeItem('jellyfin_server');
                localStorage.removeItem('jellyfin_isAdmin');
                sessionStorage.removeItem('jellyfin_password');

                // Redirect to login by reloading the page
                window.location.reload();

                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);

function authHeaders() {
    const token = localStorage.getItem('jellyfin_token');
    const user = localStorage.getItem('jellyfin_user');
    const server = localStorage.getItem('jellyfin_server');
    const headers: Record<string, string> = {};
    if (token) headers['x-access-token'] = token;
    if (server) headers['x-jellyfin-url'] = server;
    if (user) {
        try {
            const parsed = JSON.parse(user);
            if (parsed.id) headers['x-user-id'] = parsed.id;
            if (parsed.name) headers['x-user-name'] = parsed.name;
        } catch {
            // ignore
        }
    }
    return { headers };
}

export const getLibraries = async (): Promise<JellyfinLibrary[]> => {
    const response = await apiClient.get('/libraries', authHeaders());
    return response.data;
};

export const getItems = async (libraryId: string, searchTerm?: string): Promise<JellyfinItem[]> => {
    const response = await apiClient.get('/items', { params: { libraryId, searchTerm }, ...authHeaders() });
    return response.data;
};

export const getRecommendations = async (targetItemId: string, libraryId: string, options?: { type?: string; genre?: string; mood?: string }): Promise<JellyfinItem[]> => {
    const params: Record<string, string> = { targetItemId, libraryId };
    if (options?.type) params.type = options.type;
    if (options?.genre) params.genre = options.genre;
    if (options?.mood) params.mood = options.mood;
    const response = await apiClient.get('/recommendations', { params, ...authHeaders() });
    return response.data;
};

export const getUserWatchlist = async (): Promise<JellyfinItem[]> => {
    const response = await apiClient.get('/user/watchlist', authHeaders());
    return response.data;
};

export const searchJellyseerr = async (query: string): Promise<JellyfinItem[]> => {
    const response = await apiClient.get('/search', { params: { query }, ...authHeaders() });
    return response.data;
};

export const postRemoveFromWatchlist = async (item: Pick<JellyfinItem, 'tmdbId' | 'title'> & Partial<JellyfinItem>) => {
    const response = await apiClient.post('/actions/watchlist/remove', { item }, authHeaders());
    return response.data;
};

export const postActionWatched = async (item: Pick<JellyfinItem, 'tmdbId' | 'title'> & Partial<JellyfinItem>) => {
    const response = await apiClient.post('/actions/watched', { item }, authHeaders());
    return response.data;
};

export const postActionWatchlist = async (item: Pick<JellyfinItem, 'tmdbId' | 'title'> & Partial<JellyfinItem>) => {
    const response = await apiClient.post('/actions/watchlist', { item }, authHeaders());
    return response.data;
};

export const postActionBlock = async (item: Pick<JellyfinItem, 'tmdbId' | 'title'> & Partial<JellyfinItem>) => {
    const response = await apiClient.post('/actions/block', { item }, authHeaders());
    return response.data;
};

export const postJellyseerrRequest = async (mediaId: number, mediaType: 'movie' | 'tv' = 'movie') => {
    const response = await apiClient.post('/jellyseerr/request', { mediaId, mediaType }, authHeaders());
    return response.data;
};

export const postSettingsImport = async (jsonPayload: Record<string, unknown> | string) => {
    // Accept either an object or a raw string. Backend will parse if provided as jsonContent string.
    const body = typeof jsonPayload === 'string' ? { jsonContent: jsonPayload } : jsonPayload;
    const response = await apiClient.post('/settings/import', body, authHeaders());
    return response.data;
};

export const getSettingsExport = async (): Promise<Blob> => {
    const response = await apiClient.get('/settings/export', {
        ...authHeaders(),
        responseType: 'blob'
    });
    return response.data;
};

export const getSystemStatus = async (): Promise<{ configured: boolean }> => {
    const response = await apiClient.get('/system/status');
    return response.data;
};


export const postSystemSetup = async (payload: { jellyfinUrl?: string; jellyseerrUrl?: string; jellyseerrApiKey?: string; tmdbApiKey?: string; geminiApiKey?: string; geminiModel?: string }) => {
    const response = await apiClient.post('/system/setup', payload);
    return response.data;
};

export const postSystemVerify = async (payload: { jellyfinUrl?: string; jellyseerrUrl?: string; jellyseerrApiKey?: string; tmdbApiKey?: string; geminiApiKey?: string }) => {
    const response = await apiClient.post('/system/verify', payload);
    return response.data;
};

export const getSystemSetupDefaults = async (): Promise<{ jellyfinUrl?: string | null; jellyseerrUrl?: string | null; jellyseerrApiKey?: string | null; tmdbApiKey?: string | null; geminiApiKey?: string | null; geminiModel?: string | null }> => {
    const response = await apiClient.get('/system/setup-defaults');
    return response.data;
};

export const getSystemConfigEditor = async (): Promise<{ ok: boolean; config: { jellyfinUrl: string; jellyseerrUrl: string; jellyseerrApiKey: string; tmdbApiKey: string; geminiApiKey: string; geminiModel: string; isConfigured: boolean } }> => {
    const response = await apiClient.get('/system/config-editor');
    return response.data;
};

export const putSystemConfigEditor = async (payload: { jellyfinUrl?: string; jellyseerrUrl?: string; jellyseerrApiKey?: string; tmdbApiKey?: string; geminiApiKey?: string; geminiModel?: string }) => {
    const response = await apiClient.put('/system/config-editor', payload);
    return response.data;
};


export const getWeeklyWatchlist = async (): Promise<WeeklyWatchlist | null> => {
    const response = await apiClient.get('/weekly-watchlist', authHeaders());
    return response.data.data;
};

export const refreshWeeklyWatchlist = async (): Promise<WeeklyWatchlist> => {
    const response = await apiClient.post('/weekly-watchlist/refresh', {}, authHeaders());
    return response.data.data;
};

export interface TrendingItem {
    id: number;
    title?: string;
    name?: string;
    overview: string;
    posterPath: string | null;
    backdropPath: string | null;
    mediaType: 'movie' | 'tv';
    releaseDate?: string;
    firstAirDate?: string;
    voteAverage: number;
}

export interface TrendingResponse {
    movies: TrendingItem[];
    tvShows: TrendingItem[];
}

export const getTrending = async (): Promise<TrendingResponse> => {
    const response = await apiClient.get('/trending', authHeaders());
    return response.data;
};

// ============================================================================
// Blocked Content & Redemption API
// ============================================================================

export interface BlockedResponse {
    movies: JellyfinItem[];
    tvShows: JellyfinItem[];
    total: number;
}

export interface RedemptionCandidate {
    media: JellyfinItem;
    blockedAt: string;
    appealText: string;
    confidence: number;
    reasons: string[];
}

export interface RedemptionCandidatesResponse {
    candidates: RedemptionCandidate[];
    count: number;
}

export const getBlockedItems = async (): Promise<BlockedResponse> => {
    const response = await apiClient.get('/blocked', authHeaders());
    return response.data;
};

export const getRedemptionCandidates = async (): Promise<RedemptionCandidatesResponse> => {
    const response = await apiClient.get('/blocked/redemption-candidates', authHeaders());
    return response.data;
};

export const unblockItem = async (mediaId: number, action: 'watchlist' | 'jellyseerr' | 'watched'): Promise<void> => {
    await apiClient.post(`/blocked/${mediaId}/unblock`, { action }, authHeaders());
};

export const keepBlocked = async (mediaId: number, type: 'soft' | 'permanent'): Promise<void> => {
    await apiClient.post(`/blocked/${mediaId}/keep-blocked`, { type }, authHeaders());
};

export const testRedemption = async (): Promise<RedemptionCandidatesResponse> => {
    const response = await apiClient.post('/blocked/test-redemption', {}, authHeaders());
    return response.data;
};
