/**
 * Weekly Watchlist API Routes
 * Provides endpoints for retrieving and refreshing pre-generated recommendations
 */

import { Router } from 'express';
import { WeeklyWatchlistService } from '../services/weekly-watchlist';
import prisma from '../db';

const router = Router();

/**
 * @swagger
 * /api/weekly-watchlist:
 *   get:
 *     summary: Get user's weekly watchlist
 *     description: Returns pre-generated movie and TV recommendations for the current week
 *     tags: [Weekly Watchlist]
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: Username to get watchlist for
 *     responses:
 *       200:
 *         description: Weekly watchlist data
 *       404:
 *         description: No watchlist found (not generated yet)
 */
router.get('/', async (req, res) => {
    try {
        console.log('[WeeklyWatchlist] GET request. Query:', req.query, 'Headers[x-user-name]:', req.headers['x-user-name']);

        const username = (req.query.username as string) || (req.headers['x-user-name'] as string);
        if (!username) {
            console.error('[WeeklyWatchlist] Username missing');
            return res.status(400).json({ error: 'Username required (query param or x-user-name header)' });
        }

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) {
            console.error(`[WeeklyWatchlist] User not found: ${username}`);
            return res.status(404).json({ error: 'User not found' });
        }

        const watchlist = await WeeklyWatchlistService.getForUser(user.id);

        if (!watchlist) {
            return res.status(404).json({
                error: 'No weekly watchlist found',
                message: 'Your weekly recommendations are being generated. Please check back soon.'
            });
        }

        // Filter out items the user has already interacted with (watched, watchlist, blocked)
        const userInteractions = await prisma.userMedia.findMany({
            where: { userId: user.id },
            include: { media: { select: { tmdbId: true } } }
        });
        const interactedTmdbIds = new Set(userInteractions.map(i => i.media.tmdbId));

        const filteredMovies = (watchlist.movies as { tmdbId: number }[]).filter(
            (m: { tmdbId: number }) => !interactedTmdbIds.has(m.tmdbId)
        );
        const filteredTvShows = (watchlist.tvShows as { tmdbId: number }[]).filter(
            (t: { tmdbId: number }) => !interactedTmdbIds.has(t.tmdbId)
        );

        return res.json({
            success: true,
            data: {
                movies: filteredMovies,
                tvShows: filteredTvShows,
                tasteProfile: watchlist.tasteProfile,
                generatedAt: watchlist.generatedAt,
                weekStart: watchlist.weekStart,
                weekEnd: watchlist.weekEnd,
            }
        });
    } catch (error: any) {
        console.error('[Weekly Watchlist API] Error:', error?.message || error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/weekly-watchlist/refresh:
 *   post:
 *     summary: Refresh weekly watchlist
 *     description: Force regenerate the weekly watchlist for a user
 *     tags: [Weekly Watchlist]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 description: Username to refresh watchlist for
 *     responses:
 *       200:
 *         description: Watchlist regenerated successfully
 *       400:
 *         description: Invalid request
 */
router.post('/refresh', async (req, res) => {
    try {
        const username = req.body.username || (req.headers['x-user-name'] as string);
        if (!username) {
            return res.status(400).json({ error: 'Username required' });
        }

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        console.log(`[Weekly Watchlist API] Refreshing for user ${username}`);

        const result = await WeeklyWatchlistService.generateForUser(user.id);

        return res.json({
            success: true,
            message: 'Weekly watchlist regenerated',
            data: {
                movies: result.movies,
                tvShows: result.tvShows,
                tasteProfile: result.tasteProfile,
                weekStart: result.weekStart,
                weekEnd: result.weekEnd,
                generatedAt: result.generatedAt,
            }
        });
    } catch (error: any) {
        console.error('[Weekly Watchlist API] Refresh error:', error?.message || error);
        return res.status(500).json({ error: 'Failed to regenerate watchlist' });
    }
});

/**
 * @swagger
 * /api/weekly-watchlist/status:
 *   get:
 *     summary: Check watchlist status
 *     description: Check if a user has a current weekly watchlist
 *     tags: [Weekly Watchlist]
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Status information
 */
router.get('/status', async (req, res) => {
    try {
        const username = (req.query.username as string) || (req.headers['x-user-name'] as string);
        if (!username) {
            return res.status(400).json({ error: 'Username required' });
        }

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const watchlist = await WeeklyWatchlistService.getForUser(user.id);

        return res.json({
            exists: !!watchlist,
            generatedAt: watchlist?.generatedAt || null,
            weekStart: watchlist?.weekStart || null,
            weekEnd: watchlist?.weekEnd || null,
            movieCount: watchlist?.movies?.length || 0,
            tvShowCount: watchlist?.tvShows?.length || 0,
        });
    } catch (error: any) {
        console.error('[Weekly Watchlist API] Status error:', error?.message || error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
