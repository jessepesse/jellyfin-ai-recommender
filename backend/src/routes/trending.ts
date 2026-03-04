import { Router, Request, Response } from 'express';
import { TrendingService } from '../services/trending';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

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
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

        // Delegate to TrendingService which handles caching and fetching
        const result = await TrendingService.getTrending(req.user.username);

        return res.json(result);
    } catch (e: any) {
        console.error('[Trending] Error:', e?.message || e);
        return res.status(500).json({ error: 'Failed to fetch trending' });
    }
});

export default router;
