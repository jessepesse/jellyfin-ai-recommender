/**
 * Sync routes - Jellyfin history synchronization
 */

import { Router, Request, Response } from 'express';
import { sanitizeUrl } from '../utils/ssrf-protection';
import { validateJellyfinSync } from '../middleware/validators';
import { authMiddleware } from '../middleware/auth';
import { JellyfinAuthError } from '../jellyfin';

const router = Router();
router.use(authMiddleware);

/**
 * POST /sync/jellyfin - Sync watch history from Jellyfin
 */
router.post('/jellyfin', validateJellyfinSync, async (req: Request, res: Response) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

        const accessToken = (req.user?.jellyfinToken ?? req.headers['x-access-token']) as string;
        const jellyfinUrlRaw = req.headers['x-jellyfin-url'] as string | undefined;
        const jellyfinUrl = jellyfinUrlRaw ? sanitizeUrl(jellyfinUrlRaw) : undefined;

        if (!accessToken) {
            return res.status(401).json({ error: 'Unauthorized - Missing access token' });
        }

        const jellyfinUserId = req.user.jellyfinUserId || '';
        console.log(`[API] Starting Jellyfin sync for user: ${req.user.username}`);

        const { syncHistory } = await import('../services/sync');
        const result = await syncHistory(jellyfinUserId, req.user.username, accessToken, jellyfinUrl);

        console.log(`[API] Sync complete: ${result.new} new, ${result.skipped} skipped, ${result.failed} failed`);

        res.json({
            success: true,
            total: result.total,
            new: result.new,
            skipped: result.skipped,
            failed: result.failed,
            errors: result.errors,
        });
    } catch (e: any) {
        // Propagate 401 to frontend for token refresh
        if (e instanceof JellyfinAuthError) {
            return res.status(401).json({ error: e.message, code: 'TOKEN_EXPIRED' });
        }
        console.error('[API] Sync failed:', e);
        res.status(500).json({
            success: false,
            error: 'Sync failed',
            message: e?.message || String(e)
        });
    }
});

export default router;
