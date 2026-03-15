import axios from 'axios';
import type { JellyfinItem, JellyfinLibrary, WeeklyWatchlist } from '../types';

// Use VITE_API_URL environment variable if set (for production with Cloudflare),
// otherwise fall back to relative /api (for development with Vite proxy)
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

const apiClient = axios.create({
    baseURL: BASE_URL,
});

// Response interceptor: session expiry is handled server-side.
// A 401 here means the session is genuinely expired or invalid — redirect to login.
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('jellyfin_token');
            localStorage.removeItem('jellyfin_user');
            localStorage.removeItem('jellyfin_server');
            localStorage.removeItem('jellyfin_isAdmin');
            sessionStorage.removeItem('jellyfin_password'); // legacy cleanup
            window.location.reload();
        }
        return Promise.reject(error);
    }
);

function authHeaders() {
    const token = localStorage.getItem('jellyfin_token');
    const server = localStorage.getItem('jellyfin_server');
    const headers: Record<string, string> = {};
    // Only send the bearer token and the Jellyfin server URL.
    // Identity (username, user ID, admin status) is derived server-side from the
    // verified token via authMiddleware — never trusted from client-supplied headers.
    if (token) headers['x-access-token'] = token;
    if (server) headers['x-jellyfin-url'] = server;
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

export const getRecommendations = async (
    targetItemId: string,
    libraryId: string,
    options?: { type?: string; genre?: string; mood?: string; refresh?: boolean; yearFrom?: number; yearTo?: number }
): Promise<JellyfinItem[]> => {
    const params: Record<string, string> = { targetItemId, libraryId };
    if (options?.type) params.type = options.type;
    if (options?.genre) params.genre = options.genre;
    if (options?.mood) params.mood = options.mood;
    if (options?.yearFrom !== undefined) params.yearFrom = String(options.yearFrom);
    if (options?.yearTo !== undefined) params.yearTo = String(options.yearTo);
    if (options?.refresh) params.refresh = 'true';
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


export const postSystemSetup = async (payload: { jellyfinUrl?: string; jellyseerrUrl?: string; jellyseerrApiKey?: string; tmdbApiKey?: string; geminiApiKey?: string; aiProvider?: string; openrouterApiKey?: string; aiModel?: string }) => {
    const response = await apiClient.post('/system/setup', payload);
    return response.data;
};

export const postSystemVerify = async (payload: { jellyfinUrl?: string; jellyseerrUrl?: string; jellyseerrApiKey?: string; tmdbApiKey?: string; geminiApiKey?: string; openrouterApiKey?: string }) => {
    const response = await apiClient.post('/system/verify', payload);
    return response.data;
};

export const getSystemSetupDefaults = async (): Promise<{ jellyfinUrl?: string | null; jellyseerrUrl?: string | null; jellyseerrApiKey?: string | null; tmdbApiKey?: string | null; geminiApiKey?: string | null; aiProvider?: string | null; openrouterApiKey?: string | null; aiModel?: string | null }> => {
    const response = await apiClient.get('/system/setup-defaults');
    return response.data;
};

export const getSystemConfigEditor = async (): Promise<{ ok: boolean; config: { jellyfinUrl: string; jellyseerrUrl: string; jellyseerrApiKey: string; tmdbApiKey: string; geminiApiKey: string; aiProvider: string; openrouterApiKey: string; aiModel: string; isConfigured: boolean } }> => {
    const response = await apiClient.get('/system/config-editor', authHeaders());
    return response.data;
};

export const putSystemConfigEditor = async (payload: { jellyfinUrl?: string; jellyseerrUrl?: string; jellyseerrApiKey?: string; tmdbApiKey?: string; geminiApiKey?: string; aiProvider?: string; openrouterApiKey?: string; aiModel?: string }) => {
    const response = await apiClient.put('/system/config-editor', payload, authHeaders());
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
    genres?: string[];
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

export const unblockItem = async (mediaId: number, action: 'watchlist' | 'jellyseerr' | 'watched' | 'remove'): Promise<void> => {
    await apiClient.post(`/blocked/${mediaId}/unblock`, { action }, authHeaders());
};

export const keepBlocked = async (mediaId: number, type: 'soft' | 'permanent'): Promise<void> => {
    await apiClient.post(`/blocked/${mediaId}/keep-blocked`, { type }, authHeaders());
};

export const testRedemption = async (): Promise<RedemptionCandidatesResponse> => {
    const response = await apiClient.post('/blocked/test-redemption', {}, authHeaders());
    return response.data;
};

// Admin APIs
export interface UserStatistics {
    username: string;
    createdAt: string;
    lastActivity: string;
    isActive: boolean;
    stats: {
        watched: number;
        watchlist: number;
        blocked: number;
        total: number;
    };
    aiFeatures: {
        weeklyPicks: {
            generatedAt: string;
            daysOld: number;
        } | null;
        redemptionCandidates: {
            generatedAt: string;
            daysOld: number;
        } | null;
    };
}

export interface UserStatisticsResponse {
    users: UserStatistics[];
    summary: {
        total: number;
        active: number;
        inactive: number;
    };
}

export const getUserStatistics = async (): Promise<UserStatisticsResponse> => {
    const response = await apiClient.get('/admin/users', authHeaders());
    return response.data;
};

export const postChangePassword = async (payload: { newPassword: string; confirmPassword: string }) => {
    const response = await apiClient.post('/user/change-password', payload, authHeaders());
    return response.data;
};

export const getMe = async (): Promise<{ id: number; username: string; isAdmin: boolean }> => {
    const response = await apiClient.get('/auth/me', authHeaders());
    return response.data;
};
