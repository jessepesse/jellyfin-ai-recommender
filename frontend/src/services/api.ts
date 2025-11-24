import axios from 'axios';
import type { JellyfinItem, JellyfinLibrary } from '../types';

// Use relative path for production (Nginx proxy) or VITE_BACKEND_URL for dev override
// In production: Nginx proxies /api to backend container
// In development: Vite dev server proxies /api to http://localhost:3001
const BASE_URL = import.meta.env.VITE_BACKEND_URL 
    ? import.meta.env.VITE_BACKEND_URL + '/api'
    : '/api';

const apiClient = axios.create({
    baseURL: BASE_URL,
});

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
        } catch (e) {
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

export const getRecommendations = async (targetItemId: string, libraryId: string, options?: { type?: string; genre?: string }): Promise<JellyfinItem[]> => {
    const params: any = { targetItemId, libraryId };
    if (options?.type) params.type = options.type;
    if (options?.genre) params.genre = options.genre;
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

export const postRemoveFromWatchlist = async (item: any) => {
    const response = await apiClient.post('/actions/watchlist/remove', { item }, authHeaders());
    return response.data;
};

export const postActionWatched = async (item: any) => {
    const response = await apiClient.post('/actions/watched', { item }, authHeaders());
    return response.data;
};

export const postActionWatchlist = async (item: any) => {
    const response = await apiClient.post('/actions/watchlist', { item }, authHeaders());
    return response.data;
};

export const postActionBlock = async (item: any) => {
    const response = await apiClient.post('/actions/block', { item }, authHeaders());
    return response.data;
};

export const postJellyseerrRequest = async (mediaId: number, mediaType: 'movie' | 'tv' = 'movie') => {
    const response = await apiClient.post('/jellyseerr/request', { mediaId, mediaType }, authHeaders());
    return response.data;
};

export const postSettingsImport = async (jsonPayload: any) => {
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

export const postSystemSetup = async (payload: { jellyfinUrl?: string; jellyseerrUrl?: string; jellyseerrApiKey?: string; geminiApiKey?: string; geminiModel?: string }) => {
    const response = await apiClient.post('/system/setup', payload);
    return response.data;
};

export const postSystemVerify = async (payload: { jellyfinUrl?: string; jellyseerrUrl?: string; jellyseerrApiKey?: string; geminiApiKey?: string }) => {
    const response = await apiClient.post('/system/verify', payload);
    return response.data;
};

export const getSystemSetupDefaults = async (): Promise<{ jellyfinUrl?: string | null; jellyseerrUrl?: string | null; jellyseerrApiKey?: string | null; geminiApiKey?: string | null; geminiModel?: string | null }> => {
    const response = await apiClient.get('/system/setup-defaults');
    return response.data;
};

export const getSystemConfigEditor = async (): Promise<{ ok: boolean; config: { jellyfinUrl: string; jellyseerrUrl: string; jellyseerrApiKey: string; geminiApiKey: string; geminiModel: string; isConfigured: boolean } }> => {
    const response = await apiClient.get('/system/config-editor');
    return response.data;
};

export const putSystemConfigEditor = async (payload: { jellyfinUrl?: string; jellyseerrUrl?: string; jellyseerrApiKey?: string; geminiApiKey?: string; geminiModel?: string }) => {
    const response = await apiClient.put('/system/config-editor', payload);
    return response.data;
};
