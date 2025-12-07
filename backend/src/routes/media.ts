/**
 * Media routes - Images serving and debug endpoints
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { JellyfinService } from '../jellyfin';
import { sanitizeUrl } from '../utils/ssrf-protection';

const router = Router();
const jellyfinService = new JellyfinService();

/**
 * GET /images/:filename - Serve locally cached images
 */
router.get('/images/:filename', (req: Request, res: Response) => {
    const { filename } = req.params;
    
    // Security: Validate filename to prevent directory traversal
    if (!filename || !/^(movie|tv)_\d+_(poster|backdrop)\.(jpg|png)$/.test(filename)) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const imagePath = path.join('/app/images', filename);
    
    if (!fs.existsSync(imagePath)) {
        return res.status(404).json({ error: 'Image not found' });
    }
    
    res.sendFile(imagePath);
});

/**
 * GET /debug/jellyfin - Debug endpoint to inspect raw Jellyfin watched history
 */
router.get('/debug/jellyfin', async (req, res) => {
    const accessToken = req.headers['x-access-token'] as string;
    const userId = req.headers['x-user-id'] as string;
    const jellyfinServerRaw = req.headers['x-jellyfin-url'] as string | undefined;
    const jellyfinServer = jellyfinServerRaw ? sanitizeUrl(jellyfinServerRaw) : undefined;

    if (!accessToken || !userId) {
        return res.status(401).json({ error: 'Unauthorized: Access token or User ID missing' });
    }

    try {
        console.log('[Debug] Fetching Jellyfin watched history for inspection...');
        const history = await jellyfinService.getUserHistory(userId, accessToken, 5, jellyfinServer);
        
        res.json({
            message: 'First 5 watched items from Jellyfin',
            count: history.length,
            items: history.slice(0, 5).map((item: any) => ({
                Name: item.Name,
                Type: item.Type,
                ProductionYear: item.ProductionYear,
                PremiereDate: item.PremiereDate,
                ProviderIds: item.ProviderIds,
                UserData: item.UserData,
                PlayedPercentage: item.UserData?.PlayedPercentage,
                Played: item.UserData?.Played,
                LastPlayedDate: item.UserData?.LastPlayedDate,
                Genres: item.Genres,
                CommunityRating: item.CommunityRating,
                _rawFields: Object.keys(item)
            }))
        });
    } catch (error) {
        console.error('Error in debug endpoint:', error);
        res.status(500).json({ error: 'Failed to fetch debug data' });
    }
});

export default router;
