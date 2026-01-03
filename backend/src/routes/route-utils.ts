/**
 * Shared utilities for API route handlers
 * Contains common mappers and helper functions
 */

import { FrontendItem } from '../types';

// Input type for items that can be converted to FrontendItem
// Handles various sources: Jellyseerr, Prisma DB, Jellyfin, etc.
export interface ToFrontendItemInput {
    tmdbId?: number | string | null;
    tmdb_id?: number | string | null;
    id?: number | string | null;
    tmdb?: number | string | null;
    title?: string;
    name?: string;
    Title?: string;
    overview?: string | null;
    plot?: string | null;
    synopsis?: string | null;
    mediaType?: string;
    media_type?: string;
    type?: string;
    MediaType?: string;
    releaseYear?: string;
    releaseDate?: string;
    firstAirDate?: string;
    posterUrl?: string | null;
    posterSourceUrl?: string | null;
    poster_path?: string | null;
    poster?: string | null;
    poster_url?: string | null;
    backdropUrl?: string | null;
    backdropSourceUrl?: string | null;
    backdrop_path?: string | null;
    backdrop?: string | null;
    backdrop_url?: string | null;
    voteAverage?: number | null;
    vote_average?: number | null;
    rating?: number | null;
    reason?: string;
    genres?: string[];
}

/**
 * Standard mapper to normalize varied backend shapes to frontend contract
 */
export function toFrontendItem(item: ToFrontendItemInput | null | undefined): FrontendItem | null {
    if (!item) return null;

    const tmdbRaw = item.tmdbId ?? item.tmdb_id ?? item.id ?? item.tmdb ?? item.tmdbId;
    const tmdbId = tmdbRaw !== undefined && tmdbRaw !== null ? Number(tmdbRaw) : null;

    // Return null if tmdbId is not valid - FrontendItem requires a number
    if (tmdbId === null || !Number.isFinite(tmdbId)) return null;

    const title = item.title || item.name || item.Title || '';
    const overview = item.overview ?? item.plot ?? item.synopsis ?? undefined;
    const mediaTypeRaw = item.mediaType ?? item.media_type ?? item.type ?? item.MediaType ?? 'movie';
    const mediaType = typeof mediaTypeRaw === 'string' ? mediaTypeRaw.toLowerCase() : 'movie';
    const releaseYear = item.releaseYear ??
        (item.releaseDate ? String(item.releaseDate).substring(0, 4) :
            (item.firstAirDate ? String(item.firstAirDate).substring(0, 4) : '')) ?? '';

    // Poster resolution: Prefer local cached image, fallback to source URL
    let posterUrl: string | null = null;
    if (item.posterUrl) {
        // If posterUrl starts with /images/, convert to /api/images/ (backend serves cached images)
        if (item.posterUrl.startsWith('/images/')) {
            const filename = item.posterUrl.replace('/images/', '');
            posterUrl = `/api/images/${filename}`;
        }
        // If posterUrl is already a proxy URL, use it
        else if (item.posterUrl.startsWith('/api/proxy/image') || item.posterUrl.startsWith('/api/images/')) {
            posterUrl = item.posterUrl;
        }
        // Otherwise, construct proxy URL
        else {
            posterUrl = `/api/proxy/image?type=poster&path=${encodeURIComponent(item.posterUrl)}`;
        }
    }
    // Fallback to posterSourceUrl if posterUrl is missing
    else if (item.posterSourceUrl) {
        posterUrl = item.posterSourceUrl.startsWith('/api/proxy/image')
            ? item.posterSourceUrl
            : `/api/proxy/image?type=poster&path=${encodeURIComponent(item.posterSourceUrl)}`;
    }
    // Last resort: try legacy fields
    else {
        const posterSource = item.poster_path || item.poster || item.poster_url;
        if (posterSource) {
            posterUrl = `/api/proxy/image?type=poster&path=${encodeURIComponent(posterSource)}`;
        }
    }

    const voteAverage = item.voteAverage ?? item.vote_average ?? item.rating ?? 0;

    // Backdrop resolution: Prefer local cached image, fallback to source URL
    let backdropUrl: string | null = null;
    if (item.backdropUrl) {
        // If backdropUrl starts with /images/, convert to /api/images/ (backend serves cached images)
        if (item.backdropUrl.startsWith('/images/')) {
            const filename = item.backdropUrl.replace('/images/', '');
            backdropUrl = `/api/images/${filename}`;
        }
        // If backdropUrl is already a proxy URL, use it
        else if (item.backdropUrl.startsWith('/api/proxy/image') || item.backdropUrl.startsWith('/api/images/')) {
            backdropUrl = item.backdropUrl;
        }
        // Otherwise, construct proxy URL
        else {
            backdropUrl = `/api/proxy/image?type=backdrop&path=${encodeURIComponent(item.backdropUrl)}`;
        }
    }
    // Fallback to backdropSourceUrl if backdropUrl is missing
    else if (item.backdropSourceUrl) {
        backdropUrl = item.backdropSourceUrl.startsWith('/api/proxy/image')
            ? item.backdropSourceUrl
            : `/api/proxy/image?type=backdrop&path=${encodeURIComponent(item.backdropSourceUrl)}`;
    }
    // Last resort: try legacy fields
    else {
        const backdropSource = item.backdrop_path || item.backdrop || item.backdrop_url;
        if (backdropSource) {
            backdropUrl = `/api/proxy/image?type=backdrop&path=${encodeURIComponent(backdropSource)}`;
        }
    }

    return {
        tmdbId,
        title,
        overview,
        mediaType: mediaType === 'tv' ? 'tv' : 'movie',
        releaseYear: releaseYear || '',
        posterUrl: posterUrl || undefined,
        voteAverage: voteAverage === undefined || voteAverage === null ? 0 : Number(voteAverage),
        backdropUrl: backdropUrl || undefined,
        genres: item.genres || [],
    } as any;
}

/**
 * Extract auth headers from request
 */
export function getAuthHeaders(req: { headers: Record<string, any> }): {
    accessToken: string | undefined;
    userId: string | undefined;
    userName: string | undefined;
} {
    return {
        accessToken: req.headers['x-access-token'] as string | undefined,
        userId: req.headers['x-user-id'] as string | undefined,
        userName: req.headers['x-user-name'] as string | undefined,
    };
}
