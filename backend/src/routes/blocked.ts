/**
 * Blocked Content API Routes
 * Manages blocked content and redemption candidates
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { AdvocateService } from '../services/advocate';

const router = Router();

/**
 * @swagger
 * /api/blocked:
 *   get:
 *     summary: Get all blocked content for user
 *     tags: [Blocked]
 *     responses:
 *       200:
 *         description: Blocked content separated by type
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const username = req.headers['x-user-name'] as string;
        if (!username) {
            return res.status(401).json({ error: 'Username required' });
        }

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const blockedMedia = await prisma.userMedia.findMany({
            where: {
                userId: user.id,
                status: 'BLOCKED'
            },
            include: {
                media: true
            },
            orderBy: {
                updatedAt: 'desc'
            }
        });

        // Separate by media type and transform to frontend format
        const movies = blockedMedia
            .filter(um => um.media.mediaType === 'movie')
            .map(um => ({
                ...um.media,
                // Ensure we use local cached images, not source URLs
                posterUrl: um.media.posterUrl || um.media.posterSourceUrl,
                backdropUrl: um.media.backdropUrl || um.media.backdropSourceUrl
            }));

        const tvShows = blockedMedia
            .filter(um => um.media.mediaType === 'tv')
            .map(um => ({
                ...um.media,
                // Ensure we use local cached images, not source URLs
                posterUrl: um.media.posterUrl || um.media.posterSourceUrl,
                backdropUrl: um.media.backdropUrl || um.media.backdropSourceUrl
            }));

        res.json({
            movies,
            tvShows,
            total: blockedMedia.length
        });
    } catch (error: any) {
        console.error('[Blocked API] Error:', error?.message || error);
        res.status(500).json({ error: 'Failed to fetch blocked content' });
    }
});

/**
 * @swagger
 * /api/blocked/redemption-candidates:
 *   get:
 *     summary: Get AI-recommended redemption candidates
 *     tags: [Blocked]
 *     responses:
 *       200:
 *         description: List of redemption candidates with AI appeals
 */
router.get('/redemption-candidates', async (req: Request, res: Response) => {
    try {
        const username = req.headers['x-user-name'] as string;
        if (!username) {
            return res.status(401).json({ error: 'Username required' });
        }

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        console.log(`[Blocked API] Getting redemption candidates for ${username}`);
        const candidates = await AdvocateService.getRedemptionCandidates(user.id);

        res.json({
            candidates,
            count: candidates.length
        });
    } catch (error: any) {
        console.error('[Blocked API] Redemption error:', error?.message || error);
        res.status(500).json({ error: 'Failed to find redemption candidates' });
    }
});

/**
 * @swagger
 * /api/blocked/{id}/unblock:
 *   post:
 *     summary: Unblock content and optionally perform action
 *     tags: [Blocked]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [watchlist, jellyseerr, watched]
 *     responses:
 *       200:
 *         description: Content unblocked successfully
 */
router.post('/:id/unblock', async (req: Request, res: Response) => {
    try {
        const username = req.headers['x-user-name'] as string;
        if (!username) {
            return res.status(401).json({ error: 'Username required' });
        }

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const tmdbId = parseInt(req.params.id);
        const { action } = req.body; // 'watchlist' | 'jellyseerr' | 'watched'

        // Find the media by tmdbId first
        const media = await prisma.media.findFirst({
            where: { tmdbId }
        });

        if (!media) {
            return res.status(404).json({ error: 'Media not found' });
        }

        // Find the blocked item
        const userMedia = await prisma.userMedia.findFirst({
            where: {
                userId: user.id,
                mediaId: media.id,
                status: 'BLOCKED'
            }
        });

        if (!userMedia) {
            return res.status(404).json({ error: 'Blocked item not found' });
        }

        // Determine new status based on action
        let newStatus: 'WATCHLIST' | 'WATCHED' = 'WATCHLIST';
        if (action === 'watched') {
            newStatus = 'WATCHED';
        }

        // Update status (unblock)
        await prisma.userMedia.update({
            where: { id: userMedia.id },
            data: {
                status: newStatus,
                blockedAt: null,
                permanentBlock: false,
                softBlockUntil: null
            }
        });

        console.log(`[Blocked API] Unblocked media ${tmdbId} for ${username}, action: ${action}`);

        // TODO: If action === 'jellyseerr', make Jellyseerr request
        // This would require Jellyseerr integration which we can add later

        res.json({
            success: true,
            message: `Content unblocked and ${action === 'watched' ? 'marked as watched' : 'added to watchlist'}`,
            newStatus
        });
    } catch (error: any) {
        console.error('[Blocked API] Unblock error:', error?.message || error);
        res.status(500).json({ error: 'Failed to unblock content' });
    }
});

/**
 * @swagger
 * /api/blocked/{id}/keep-blocked:
 *   post:
 *     summary: Keep content blocked (soft or permanent)
 *     tags: [Blocked]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [soft, permanent]
 *     responses:
 *       200:
 *         description: Block status updated
 */
router.post('/:id/keep-blocked', async (req: Request, res: Response) => {
    try {
        const username = req.headers['x-user-name'] as string;
        if (!username) {
            return res.status(401).json({ error: 'Username required' });
        }

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const tmdbId = parseInt(req.params.id);
        const { type } = req.body; // 'soft' | 'permanent'

        // Find the media by tmdbId first
        const media = await prisma.media.findFirst({
            where: { tmdbId }
        });

        if (!media) {
            return res.status(404).json({ error: 'Media not found' });
        }

        const userMedia = await prisma.userMedia.findFirst({
            where: {
                userId: user.id,
                mediaId: media.id,
                status: 'BLOCKED'
            }
        });

        if (!userMedia) {
            return res.status(404).json({ error: 'Blocked item not found' });
        }

        // Update block type
        const updateData: any = {};

        if (type === 'permanent') {
            updateData.permanentBlock = true;
            updateData.softBlockUntil = null;
        } else {
            // Soft block for 6 months
            const sixMonthsFromNow = new Date();
            sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
            updateData.softBlockUntil = sixMonthsFromNow;
            updateData.permanentBlock = false;
        }

        await prisma.userMedia.update({
            where: { id: userMedia.id },
            data: updateData
        });

        console.log(`[Blocked API] Kept media ${tmdbId} blocked (${type}) for ${username}`);

        res.json({
            success: true,
            message: type === 'permanent'
                ? 'Content permanently blocked'
                : 'Content blocked for 6 months',
            blockType: type
        });
    } catch (error: any) {
        console.error('[Blocked API] Keep blocked error:', error?.message || error);
        res.status(500).json({ error: 'Failed to update block status' });
    }
});

/**
 * @swagger
 * /api/blocked/test-redemption:
 *   post:
 *     summary: Manually trigger redemption analysis (DEV ONLY)
 *     tags: [Blocked]
 *     responses:
 *       200:
 *         description: Redemption analysis triggered
 */
router.post('/test-redemption', async (req: Request, res: Response) => {
    try {
        const username = req.headers['x-user-name'] as string;
        if (!username) {
            return res.status(401).json({ error: 'Username required' });
        }

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        console.log(`[Blocked API] TEST: Triggering redemption analysis for ${username}`);
        const candidates = await AdvocateService.generateAndSaveRedemptionCandidates(user.id);

        res.json({
            success: true,
            message: 'Redemption analysis completed',
            candidates,
            count: candidates.length
        });
    } catch (error: any) {
        console.error('[Blocked API] Test redemption error:', error?.message || error);
        res.status(500).json({ error: 'Failed to run redemption analysis' });
    }
});

export default router;
