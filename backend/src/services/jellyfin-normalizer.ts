// Helper to normalize Jellyfin items to our internal format
import { JellyfinItem } from '../types';

export interface NormalizedItem {
    tmdbId: number | null;
    title: string;
    mediaType: 'movie' | 'tv';
    releaseYear: string;
    genres?: string[];
    rating?: number;
    overview?: string;
}

/**
 * Normalize a Jellyfin item to extract key fields including TMDB ID
 */
export function normalizeJellyfinItem(item: any): NormalizedItem | null {
    if (!item) return null;

    // Extract TMDB ID from ProviderIds
    const tmdbRaw = item.ProviderIds?.Tmdb ?? item.ProviderIds?.tmdb ?? null;
    const tmdbId = tmdbRaw ? Number(tmdbRaw) : null;

    // Get title
    const title = item.Name || item.Title || item.name || '';
    if (!title) return null;

    // Determine media type
    let mediaType: 'movie' | 'tv' = 'movie';
    if (item.Type === 'Series' || item.type === 'Series' || item.SeriesName) {
        mediaType = 'tv';
    }

    // Get release year
    let releaseYear = '';
    if (item.ProductionYear) {
        releaseYear = String(item.ProductionYear);
    } else if (item.PremiereDate) {
        releaseYear = String(item.PremiereDate).substring(0, 4);
    }

    // Extract genres
    const genres = Array.isArray(item.Genres) ? item.Genres : undefined;

    // Extract rating
    const rating = item.CommunityRating ? Number(item.CommunityRating) : undefined;

    // Extract overview
    const overview = item.Overview || undefined;

    return {
        tmdbId,
        title,
        mediaType,
        releaseYear,
        genres,
        rating,
        overview
    };
}

/**
 * Extract TMDB IDs from Jellyfin history items
 */
export function extractTmdbIds(items: any[]): number[] {
    return items
        .map(item => {
            const tmdbRaw = item.ProviderIds?.Tmdb ?? item.ProviderIds?.tmdb ?? null;
            return tmdbRaw ? Number(tmdbRaw) : null;
        })
        .filter((id): id is number => id !== null && Number.isFinite(id));
}
