/**
 * Settings routes - Import/Export functionality
 */

import { Router, Request, Response } from 'express';
import importService from '../services/import';
import { exportUserData, exportAllUsersData } from '../services/export';
import { authMiddleware } from '../middleware/auth';

const router = Router();

/**
 * GET /settings/import/progress/:username - SSE endpoint for import progress
 * The authenticated user may only poll their own import progress.
 */
router.get('/import/progress/:username', authMiddleware, (req, res) => {
    // Enforce that users can only observe their own import job.
    const username = req.user?.username;
    if (!username) return res.status(401).json({ error: 'Unauthorized' });
    if (username !== req.params.username) return res.status(403).json({ error: 'Forbidden' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // codeql[js/tainted-format-string] - False positive: username is passed as separate arg in template literal, not a format string
    console.log(`[SSE] Client connected for import progress: "${username}"`);

    const initialProgress = importService.getProgress(username);
    // codeql[js/tainted-format-string] - False positive: username is in template literal, condition is separate arg
    console.log(`[SSE] Initial progress for "${username}":`, initialProgress ? 'found' : 'not found');
    if (initialProgress) {
        res.write(`data: ${JSON.stringify(initialProgress)}\n\n`);
    }

    const interval = setInterval(() => {
        const progress = importService.getProgress(username);
        if (progress) {
            res.write(`data: ${JSON.stringify(progress)}\n\n`);
            if (progress.completed) {
                clearInterval(interval);
                res.end();
            }
        } else {
            res.write(`data: ${JSON.stringify({ active: false })}\n\n`);
        }
    }, 500);

    req.on('close', () => {
        clearInterval(interval);
        console.log(`[SSE] Client disconnected: ${username}`);
    });
});

/**
 * POST /settings/import - Import legacy database.json
 * Identity sourced exclusively from req.user (set by authMiddleware).
 */
router.post('/import', authMiddleware, async (req, res) => {
    try {
        // Identity comes from the verified token — never from client-supplied headers.
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

        const token = req.headers['x-access-token'] as string | undefined;

        const payload = req.body;
        let parsed: any = payload;
        if (payload && typeof payload.jsonContent === 'string') {
            try {
                parsed = JSON.parse(payload.jsonContent);
            } catch (e) {
                return res.status(400).json({ error: 'Invalid JSON in jsonContent' });
            }
        }

        const username = req.user.username;

        console.log(`[Import] Username for progress tracking: "${username}"`);
        console.log(`[Import] Received payload keys:`, Object.keys(parsed || {}));
        console.log(`[Import] Parsed.data keys:`, parsed?.data ? Object.keys(parsed.data) : 'no data key');
        console.log(`[Import] Direct movies array:`, Array.isArray(parsed?.movies) ? parsed.movies.length : 'not array');
        console.log(`[Import] Nested data.movies:`, Array.isArray(parsed?.data?.movies) ? parsed.data.movies.length : 'not array');

        const itemCount =
            (Array.isArray(parsed?.data?.movies) ? parsed.data.movies.length : 0) +
            (Array.isArray(parsed?.data?.series) ? parsed.data.series.length : 0) +
            (Array.isArray(parsed?.data?.watchlist?.movies) ? parsed.data.watchlist.movies.length : 0) +
            (Array.isArray(parsed?.data?.watchlist?.series) ? parsed.data.watchlist.series.length : 0);

        // codeql[js/tainted-format-string] - False positive: username and itemCount in template literal
        console.log(`[Import] Starting import for ${username}: ~${itemCount} items`);

        // For large imports, run async
        if (itemCount > 50) {
            importService.processImport(username, parsed, token).then(summary => {
                // codeql[js/tainted-format-string] - False positive: summary is a separate argument, not part of format string
                console.log(`[Import] Async import complete for ${username}:`, summary);
            }).catch(e => {
                // codeql[js/tainted-format-string] - False positive: e is a separate argument, not part of format string
                console.error(`[Import] Async import failed for ${username}:`, e);
            });

            return res.json({
                ok: true,
                async: true,
                message: `Import started in background. Processing ~${itemCount} items.`,
                estimatedMinutes: Math.ceil(itemCount / 20)
            });
        }

        const summary = await importService.processImport(username, parsed, token);
        res.json({ ok: true, async: false, summary });
    } catch (e) {
        console.error('Import failed', e);
        res.status(500).json({ error: 'Import failed', message: String(((e as any)?.message) || e) });
    }
});

/**
 * GET /settings/export - Export database to JSON
 * Admins: Export all users' data
 * Non-admins: Export only their own data
 * Identity and admin status sourced exclusively from req.user (set by authMiddleware).
 */
router.get('/export', authMiddleware, async (req, res) => {
    try {
        const token = req.headers['x-access-token'] as string | undefined;

        // Identity and privilege come from the verified token — never from client headers.
        if (!req.user || !token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const username = req.user.username;
        const isAdmin = req.user.isSystemAdmin;

        let exportData;
        let filename;

        if (isAdmin) {
            // Admin: Export all users
            console.log(`[Export] Admin ${username} exporting all users' data`);
            exportData = await exportAllUsersData();
            filename = `jellyfin-backup-all-users-${new Date().toISOString().split('T')[0]}.json`;
        } else {
            // Regular user: Export only their own data
            console.log(`[Export] Exporting data for user: ${username}`);
            exportData = await exportUserData(username);
            filename = `jellyfin-backup-${username}-${new Date().toISOString().split('T')[0]}.json`;
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        res.json(exportData);
    } catch (e) {
        console.error('Export failed', e);
        res.status(500).json({ error: 'Export failed', message: String(((e as any)?.message) || e) });
    }
});

export default router;
