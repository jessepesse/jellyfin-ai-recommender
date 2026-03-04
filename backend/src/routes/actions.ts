/**
 * Actions routes - User actions (watched, watchlist, block) and Jellyseerr requests
 */

import { Router, Request, Response } from 'express';
import { updateMediaStatus, removeFromWatchlist } from '../services/data';
import { requestMediaByTmdb } from '../services/jellyseerr';
import { validateUserAction, validateMediaRequest } from '../middleware/validators';
import { authMiddleware } from '../middleware/auth';
import { CacheService } from '../services/cache';
import { TrendingService } from '../services/trending';

const router = Router();
router.use(authMiddleware);

/**
 * POST /actions/watched - Mark item as watched
 */
router.post('/watched', validateUserAction, async (req: Request, res: Response) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const payload = req.body;

        if (!payload || !payload.item) return res.status(400).json({ error: 'Missing item in body' });

        const token = req.headers['x-access-token'] as string | undefined;
        await updateMediaStatus(req.user.username, payload.item as any, 'WATCHED', token);

        // Invalidate trending cache so this item disappears
        CacheService.del('api', `trending_${req.user.username}`);

        res.json({ ok: true });
    } catch (e) {
        console.error('Failed to add watched item', e);
        res.status(500).json({ error: 'Failed to add watched item' });
    }
});

/**
 * POST /actions/watchlist - Add item to watchlist
 */
router.post('/watchlist', validateUserAction, async (req: Request, res: Response) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const payload = req.body;

        if (!payload || !payload.item) return res.status(400).json({ error: 'Missing item in body' });

        const token = req.headers['x-access-token'] as string | undefined;
        await updateMediaStatus(req.user.username, payload.item as any, 'WATCHLIST', token);

        // Invalidate trending cache
        CacheService.del('api', `trending_${req.user.username}`);

        res.json({ ok: true });
    } catch (e) {
        console.error('Failed to add watchlist item', e);
        res.status(500).json({ error: 'Failed to add watchlist item' });
    }
});

/**
 * POST /actions/watchlist/remove - Remove item from watchlist
 */
router.post('/watchlist/remove', async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const payload = req.body;

        if (!payload || !payload.item) return res.status(400).json({ error: 'Missing item in body' });

        const ok = await removeFromWatchlist(req.user.username, payload.item as any);

        // Invalidate trending cache (item might need to reappear if it was filtered out by watchlist status)
        if (ok) {
            CacheService.del('api', `trending_${req.user.username}`);

            // Background refresh
            TrendingService.refreshCache(req.user.username).catch(err => console.error('Background refresh failed', err));

            return res.json({ ok: true });
        }
        return res.status(500).json({ error: 'Failed to remove from watchlist' });
    } catch (e) {
        console.error('Failed to remove watchlist item', e);
        res.status(500).json({ error: 'Failed to remove watchlist item' });
    }
});

/**
 * POST /actions/block - Block item from recommendations
 */
router.post('/block', validateUserAction, async (req: Request, res: Response) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const payload = req.body;

        if (!payload || !payload.item) return res.status(400).json({ error: 'Missing item in body' });

        const token = req.headers['x-access-token'] as string | undefined;
        await updateMediaStatus(req.user.username, payload.item as any, 'BLOCKED', token);

        // Invalidate trending cache
        CacheService.del('api', `trending_${req.user.username}`);

        // Background refresh
        TrendingService.refreshCache(req.user.username).catch(err => console.error('Background refresh failed', err));

        res.json({ ok: true });
    } catch (e) {
        console.error('Failed to block item', e);
        res.status(500).json({ error: 'Failed to block item' });
    }
});

/**
 * POST /jellyseerr/request - Request media via Jellyseerr
 */
router.post('/request', validateMediaRequest, async (req: Request, res: Response) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const payload = req.body;

        const mediaId = payload?.mediaId ?? payload?.tmdbId;
        const mediaType = payload?.mediaType ?? 'movie';

        if (!mediaId) return res.status(400).json({ error: 'Missing mediaId/tmdbId in body' });

        const result = await requestMediaByTmdb(Number(mediaId), (mediaType === 'tv' ? 'tv' : 'movie'));
        res.json({ ok: true, result });
    } catch (e) {
        console.error('Failed to request via Jellyseerr', e);
        res.status(500).json({ error: 'Request failed' });
    }
});

export default router;
