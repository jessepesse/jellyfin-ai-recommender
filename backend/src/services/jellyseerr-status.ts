/**
 * Jellyseerr Status Service
 * Checks request status for TMDB IDs and filters out already-requested content
 */

import axios from 'axios';
import ConfigService from './config';
import { validateBaseUrl } from '../utils/ssrf-protection';
import { CacheService } from './cache';

// Jellyseerr media status codes
export enum JellyseerrStatus {
    UNKNOWN = 1,
    PENDING = 2,      // Pyydetty
    PROCESSING = 3,   // Ladataan
    PARTIALLY_AVAILABLE = 4,
    AVAILABLE = 5,    // Kirjastossa
}

// Statuses that should be filtered out (already requested or available)
const FILTER_STATUSES = [
    JellyseerrStatus.PENDING,
    JellyseerrStatus.PROCESSING,
    JellyseerrStatus.AVAILABLE,
];

interface JellyseerrMediaInfo {
    id: number;
    status: number;
    mediaType: 'movie' | 'tv';
    tmdbId: number;
}

/**
 * Get Jellyseerr client
 */
async function getClient(): Promise<import('axios').AxiosInstance | null> {
    try {
        const cfg = await ConfigService.getConfig();
        const rawBase = cfg?.jellyseerrUrl ? String(cfg.jellyseerrUrl) : (process.env.JELLYSEERR_URL || '');
        const rawKey = cfg?.jellyseerrApiKey ? String(cfg.jellyseerrApiKey) : (process.env.JELLYSEERR_API_KEY || '');

        if (!rawBase || !rawKey) {
            return null;
        }

        const base = validateBaseUrl(rawBase);
        const key = rawKey.trim();

        return axios.create({
            baseURL: base,
            headers: { 'X-Api-Key': key },
            timeout: 10000,
        });
    } catch (e) {
        console.warn('[Jellyseerr Status] Client creation failed:', (e as Error).message);
        return null;
    }
}

/**
 * Get Jellyseerr status for a single TMDB ID
 */
export async function getJellyseerrStatus(
    tmdbId: number,
    mediaType: 'movie' | 'tv'
): Promise<number | null> {
    const cacheKey = `jellyseerr_status_${mediaType}_${tmdbId}`;
    const cached = CacheService.get<number | null>('jellyseerr', cacheKey);
    if (cached !== undefined) return cached;

    try {
        const client = await getClient();
        if (!client) return null;

        const endpoint = mediaType === 'movie' ? `/api/v1/movie/${tmdbId}` : `/api/v1/tv/${tmdbId}`;
        const response = await client.get(endpoint);

        const status = response.data?.mediaInfo?.status ?? null;
        CacheService.set('jellyseerr', cacheKey, status, 300); // Cache 5 minutes
        return status;
    } catch (e: any) {
        // 404 means not in Jellyseerr database (never requested)
        if (e?.response?.status === 404) {
            CacheService.set('jellyseerr', cacheKey, null, 300);
            return null;
        }
        console.debug(`[Jellyseerr Status] Failed to get status for ${mediaType}/${tmdbId}:`, e?.message);
        return null;
    }
}

/**
 * Get Jellyseerr statuses for multiple TMDB IDs (batch)
 * Returns Map<tmdbId, status>
 */
export async function getJellyseerrStatuses(
    tmdbIds: number[],
    mediaType: 'movie' | 'tv'
): Promise<Map<number, number | null>> {
    const statuses = new Map<number, number | null>();

    // Process in parallel with concurrency limit
    const BATCH_SIZE = 10;
    for (let i = 0; i < tmdbIds.length; i += BATCH_SIZE) {
        const batch = tmdbIds.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
            batch.map(id => getJellyseerrStatus(id, mediaType).then(status => ({ id, status })))
        );
        results.forEach(r => statuses.set(r.id, r.status));
    }

    return statuses;
}

/**
 * Filter out items that have already been requested in Jellyseerr
 * Filters status 2 (pending), 3 (processing), 5 (available)
 */
export async function filterByJellyseerrStatus<T extends { id: number }>(
    items: T[],
    mediaType: 'movie' | 'tv'
): Promise<T[]> {
    if (items.length === 0) return items;

    const tmdbIds = items.map(item => item.id);
    const statuses = await getJellyseerrStatuses(tmdbIds, mediaType);

    const filtered = items.filter(item => {
        const status = statuses.get(item.id);
        // Keep if no status (never requested) or status not in filter list
        return status === null || !FILTER_STATUSES.includes(status as JellyseerrStatus);
    });

    const removedCount = items.length - filtered.length;
    if (removedCount > 0) {
        console.log(`[Jellyseerr Status] Filtered ${removedCount} ${mediaType}(s) with request status`);
    }

    return filtered;
}

/**
 * Check if a single item should be filtered
 */
export function shouldFilterStatus(status: number | null | undefined): boolean {
    if (status === null || status === undefined) return false;
    return FILTER_STATUSES.includes(status);
}
