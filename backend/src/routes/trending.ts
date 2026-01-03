/**
 * Trending API Routes
 * Fetches trending content from Jellyseerr and filters out already-requested items
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import ConfigService from '../services/config';
import { validateBaseUrl } from '../utils/ssrf-protection';
import { shouldFilterStatus, filterByJellyseerrStatus } from '../services/jellyseerr-status';
import { prisma } from '../db';
import { CacheService } from '../services/cache';
import { getGenreName } from '../services/tmdb-genres';

const router = Router();

interface TrendingItem {
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

/**
 * GET /api/trending
 * Returns filtered trending movies and TV shows
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const username = (req.query.username as string) || (req.headers['x-user-name'] as string);
        if (!username) {
            return res.status(401).json({ error: 'Unauthorized - username required' });
        }

        // Check cache first
        const cacheKey = `trending_${username}`;
        const cached = CacheService.get<{ movies: TrendingItem[]; tvShows: TrendingItem[] }>('api', cacheKey);
        if (cached) {
            return res.json(cached);
        }

        // Get Jellyseerr client
        const cfg = await ConfigService.getConfig();
        const rawBase = cfg?.jellyseerrUrl ? String(cfg.jellyseerrUrl) : (process.env.JELLYSEERR_URL || '');
        const rawKey = cfg?.jellyseerrApiKey ? String(cfg.jellyseerrApiKey) : (process.env.JELLYSEERR_API_KEY || '');

        if (!rawBase || !rawKey) {
            return res.status(503).json({ error: 'Jellyseerr not configured' });
        }

        const base = validateBaseUrl(rawBase);
        console.log(`[Trending] Using Jellyseerr URL: ${base}`);
        const client = axios.create({
            baseURL: base,
            headers: { 'X-Api-Key': rawKey.trim() },
            timeout: 15000,
        });

        // Fetch multiple pages of trending content (5 pages = 100 items)
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

        console.log(`[Trending] Total fetched: ${allMovies.length} movies, ${allTvShows.length} TV before mapping`);

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
            return res.status(404).json({ error: 'User not found' });
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

        console.log(`[Trending] DB Filtered: ${rawMovies.length} → ${movies.length} movies, ${rawTvShows.length} → ${tvShows.length} TV`);

        // Deep filter by Jellyseerr status (fetches status for each item)
        // We do this in parallel for movies and TV to save time
        const [filteredMovies, filteredTvShows] = await Promise.all([
            filterByJellyseerrStatus(movies, 'movie'),
            filterByJellyseerrStatus(tvShows, 'tv')
        ]);

        movies = filteredMovies;
        tvShows = filteredTvShows;

        console.log(`[Trending] Final Filtered: ${filteredMovies.length} movies, ${filteredTvShows.length} TV`);

        const result = { movies, tvShows };

        // Cache for 10 minutes
        CacheService.set('api', cacheKey, result, 600);

        return res.json(result);
    } catch (e: any) {
        console.error('[Trending] Error:', e?.message || e);
        return res.status(500).json({ error: 'Failed to fetch trending' });
    }
});

export default router;
