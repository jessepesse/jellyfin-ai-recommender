/**
 * Settings routes - Import/Export functionality
 */

import { Router, Request, Response } from 'express';
import importService from '../services/import';
import { exportUserData } from '../services/export';

const router = Router();

/**
 * GET /settings/import/progress/:username - SSE endpoint for import progress
 */
router.get('/import/progress/:username', (req, res) => {
    const { username } = req.params;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    console.log(`[SSE] Client connected for import progress: ${username}`);
    
    const initialProgress = importService.getProgress(username);
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
 */
router.post('/import', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] as string;
        const userName = req.headers['x-user-name'] as string;
        const token = req.headers['x-access-token'] as string | undefined;
        
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const payload = req.body;
        let parsed: any = payload;
        if (payload && typeof payload.jsonContent === 'string') {
            try {
                parsed = JSON.parse(payload.jsonContent);
            } catch (e) {
                return res.status(400).json({ error: 'Invalid JSON in jsonContent' });
            }
        }

        const username = userName || userId;
        
        const itemCount = 
            (Array.isArray(parsed?.data?.movies) ? parsed.data.movies.length : 0) +
            (Array.isArray(parsed?.data?.series) ? parsed.data.series.length : 0) +
            (Array.isArray(parsed?.data?.watchlist?.movies) ? parsed.data.watchlist.movies.length : 0) +
            (Array.isArray(parsed?.data?.watchlist?.series) ? parsed.data.watchlist.series.length : 0);

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
 * GET /settings/export - Export current database to JSON
 */
router.get('/export', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] as string;
        const userName = req.headers['x-user-name'] as string;
        const token = req.headers['x-access-token'] as string | undefined;
        
        if (!userId || !token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const username = userName || userId;
        console.log(`[Export] Exporting data for user: ${username}`);
        const exportData = await exportUserData(username);

        const filename = `jellyfin-backup-${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        res.json(exportData);
    } catch (e) {
        console.error('Export failed', e);
        res.status(500).json({ error: 'Export failed', message: String(((e as any)?.message) || e) });
    }
});

export default router;
