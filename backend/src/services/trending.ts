
import axios from 'axios';
import ConfigService from './config';
import { validateBaseUrl } from '../utils/ssrf-protection';
import { filterByJellyseerrStatus } from './jellyseerr-status';
import { prisma } from '../db';
import { CacheService } from './cache';
import { getGenreName } from './tmdb-genres';

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
    mediaInfo?: {
        status: number;
    } | null;
    genres: string[];
}

export class TrendingService {
    private static readonly CACHE_TTL = 600; // 10 minutes

    /**
     * Get trending items for a user
     * Checks cache first, then fetches if missing
     */
    static async getTrending(username: string): Promise<{ movies: TrendingItem[]; tvShows: TrendingItem[] }> {
        const cacheKey = `trending_${username}`;
        const cached = CacheService.get<{ movies: TrendingItem[]; tvShows: TrendingItem[] }>('api', cacheKey);

        if (cached) {
            return cached;
        }

        return this.fetchAndCacheTrending(username);
    }

    /**
     * Force refresh the trending cache for a user
     * Typically called in background after user actions
     */
    static async refreshCache(username: string): Promise<void> {
        try {
            console.log(`[Trending] Refreshing cache for ${username}...`);
            await this.fetchAndCacheTrending(username);
            console.log(`[Trending] Cache refreshed for ${username}`);
        } catch (error) {
            console.error(`[Trending] Failed to refresh cache for ${username}:`, error);
        }
    }

    /**
     * Internal method to fetch from Jellyseerr, filter, and cache
     */
    private static async fetchAndCacheTrending(username: string): Promise<{ movies: TrendingItem[]; tvShows: TrendingItem[] }> {
        // Get Jellyseerr client
        const cfg = await ConfigService.getConfig();
        const rawBase = cfg?.jellyseerrUrl ? String(cfg.jellyseerrUrl) : (process.env.JELLYSEERR_URL || '');
        const rawKey = cfg?.jellyseerrApiKey ? String(cfg.jellyseerrApiKey) : (process.env.JELLYSEERR_API_KEY || '');

        if (!rawBase || !rawKey) {
            throw new Error('Jellyseerr not configured');
        }

        const base = validateBaseUrl(rawBase);
        const client = axios.create({
            baseURL: base,
            headers: { 'X-Api-Key': rawKey.trim() },
            timeout: 15000,
        });

        // Fetch multiple pages of trending content
        const PAGES_TO_FETCH = 5;
        const pagePromises = [];

        for (let page = 1; page <= PAGES_TO_FETCH; page++) {
            pagePromises.push(
                client.get(`/api/v1/discover/trending?page=${page}`)
                    .then(res => res)
                    .catch(() => ({ data: { results: [] } }))
            );
        }

        const responses = await Promise.all(pagePromises);

        // Collect all results
        let allMovies: any[] = [];
        let allTvShows: any[] = [];

        responses.forEach((res) => {
            const items = res.data?.results || [];
            items.forEach((item: any) => {
                if (item.mediaType === 'movie') {
                    allMovies.push(item);
                } else if (item.mediaType === 'tv') {
                    allTvShows.push(item);
                }
            });
        });

        // Map to TrendingItem
        const rawMovies: TrendingItem[] = allMovies.map((m: any) => ({
            id: m.id,
            title: m.title,
            overview: m.overview,
            posterPath: m.posterPath,
            backdropPath: m.backdropPath,
            mediaType: 'movie' as const,
            releaseDate: m.releaseDate,
            voteAverage: m.voteAverage,
            mediaInfo: m.mediaInfo,
            genres: (m.genreIds || m.genre_ids || []).map((id: number) => getGenreName(id, 'movie')).filter(Boolean),
        }));

        const rawTvShows: TrendingItem[] = allTvShows.map((t: any) => ({
            id: t.id,
            name: t.name,
            overview: t.overview,
            posterPath: t.posterPath,
            backdropPath: t.backdropPath,
            mediaType: 'tv' as const,
            firstAirDate: t.firstAirDate,
            voteAverage: t.voteAverage,
            mediaInfo: t.mediaInfo,
            genres: (t.genreIds || t.genre_ids || []).map((id: number) => getGenreName(id, 'tv')).filter(Boolean),
        }));

        // Get user's excluded TMDB IDs from database
        const user = await prisma.user.findFirst({ where: { username } });
        if (!user) {
            throw new Error('User not found');
        }

        const userMedia = await prisma.userMedia.findMany({
            where: { userId: user.id },
            include: { media: { select: { tmdbId: true } } },
        });
        const excludedTmdbIds = new Set(userMedia.map(um => um.media.tmdbId));

        // Initial simple filter (DB only)
        const filterByDb = (item: TrendingItem): boolean => {
            return !excludedTmdbIds.has(item.id);
        };

        let movies = rawMovies.filter(filterByDb);
        let tvShows = rawTvShows.filter(filterByDb);

        // Deep filter by Jellyseerr status
        const [filteredMovies, filteredTvShows] = await Promise.all([
            filterByJellyseerrStatus(movies, 'movie'),
            filterByJellyseerrStatus(tvShows, 'tv')
        ]);

        const result = { movies: filteredMovies, tvShows: filteredTvShows };

        // Cache result
        const cacheKey = `trending_${username}`;
        CacheService.set('api', cacheKey, result, this.CACHE_TTL);

        return result;
    }
}
