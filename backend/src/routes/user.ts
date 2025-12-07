/**
 * User routes - User data, libraries, items, and watchlist
 */

import { Router, Request, Response } from 'express';
import { JellyfinService, JellyfinAuthError } from '../jellyfin';
import { FrontendItem } from '../types';
import { getFullWatchlist } from '../services/data';
import { sanitizeUrl } from '../utils/ssrf-protection';
import { toFrontendItem } from './route-utils';

const router = Router();
const jellyfinService = new JellyfinService();

/**
 * GET /libraries - Get Jellyfin libraries
 */
router.get('/libraries', async (req, res) => {
    const accessToken = req.headers['x-access-token'] as string;
    const jellyfinServerRaw = req.headers['x-jellyfin-url'] as string | undefined;
    const jellyfinServer = jellyfinServerRaw ? sanitizeUrl(jellyfinServerRaw) : undefined;

    if (!accessToken) {
        return res.status(401).json({ error: 'Unauthorized: Access token missing' });
    }

    try {
        const libraries = await jellyfinService.getLibraries(accessToken, jellyfinServer);
        res.json(libraries);
    } catch (error) {
        // Propagate 401 to frontend for token refresh
        if (error instanceof JellyfinAuthError) {
            return res.status(401).json({ error: error.message, code: 'TOKEN_EXPIRED' });
        }
        console.error('Error fetching Jellyfin libraries:', error);
        res.status(500).json({ error: 'An unexpected error occurred while fetching libraries' });
    }
});

/**
 * GET /items - Get items from a specific Jellyfin library
 */
router.get('/items', async (req, res) => {
    const { libraryId, searchTerm } = req.query;
    const accessToken = req.headers['x-access-token'] as string;
    const userId = req.headers['x-user-id'] as string;
    const jellyfinServerRaw = req.headers['x-jellyfin-url'] as string | undefined;
    const jellyfinServer = jellyfinServerRaw ? sanitizeUrl(jellyfinServerRaw) : undefined;

    if (!accessToken || !userId) {
        return res.status(401).json({ error: 'Unauthorized: Access token or User ID missing' });
    }
    if (!libraryId) {
        return res.status(400).json({ error: 'Missing required query parameter: libraryId' });
    }

    try {
        const items = await jellyfinService.getItems(userId, accessToken, libraryId as string, searchTerm as string | undefined, jellyfinServer);
        res.json(items);
    } catch (error) {
        // Propagate 401 to frontend for token refresh
        if (error instanceof JellyfinAuthError) {
            return res.status(401).json({ error: error.message, code: 'TOKEN_EXPIRED' });
        }
        console.error('Error fetching Jellyfin items:', error);
        res.status(500).json({ error: 'An unexpected error occurred while fetching items' });
    }
});

/**
 * GET /user/watchlist - Get user's watchlist
 */
router.get('/watchlist', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] as string;
        const userName = req.headers['x-user-name'] as string;
        
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        
        const username = userName || userId;
        const list = await getFullWatchlist(username);
        
        const mapped = (list || []).map(i => toFrontendItem(i)).filter((x): x is FrontendItem => x !== null && x.tmdbId !== null);
        res.json(mapped);
    } catch (e) {
        console.error('Failed to fetch user watchlist', e);
        res.status(500).json({ error: 'Failed to fetch watchlist' });
    }
});

export default router;
