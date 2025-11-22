import axios from 'axios';
import type { JellyfinItem, JellyfinLibrary } from '../types';

const apiClient = axios.create({
    baseURL: (import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001') + '/api',
});

function authHeaders() {
    const token = localStorage.getItem('jellyfin_token');
    const user = localStorage.getItem('jellyfin_user');
    const headers: Record<string, string> = {};
    if (token) headers['x-access-token'] = token;
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
