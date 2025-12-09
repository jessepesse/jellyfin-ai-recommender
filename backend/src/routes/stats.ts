
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { JellyfinService, JellyfinAuthError } from '../jellyfin';
import { sanitizeUrl } from '../utils/ssrf-protection';
import { GeminiService } from '../services/gemini';

const router = Router();
const prisma = new PrismaClient();
const jellyfinService = new JellyfinService();

/**
 * GET /api/stats
 * Aggregates user statistics:
 * - Watched Movies/Series counts
 * - Total Watch Time
 * - Blocked Items count
 * - Genre Distribution
 */
router.get('/', async (req, res) => {
    const accessToken = req.headers['x-access-token'] as string;
    const userId = req.headers['x-user-id'] as string;
    const userName = req.headers['x-user-name'] as string;
    const jellyfinServerRaw = req.headers['x-jellyfin-url'] as string | undefined;
    const jellyfinServer = jellyfinServerRaw ? sanitizeUrl(jellyfinServerRaw) : undefined;

    if (!accessToken || !userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // 1. Fetch blocked count from local DB
        // User blocks are stored in UserMedia table linked to a local User record
        // We need to resolve the local User ID from the Jellyfin username/ID
        let blockedCount = 0;
        const lookupName = userName || userId;

        const localUser = await prisma.user.findUnique({
            where: { username: lookupName }
        });

        if (localUser) {
            blockedCount = await prisma.userMedia.count({
                where: {
                    userId: localUser.id,
                    status: 'BLOCKED'
                }
            });
        }

        // 2. Fetch User History from Jellyfin
        // Request a high limit to get accurate stats
        const history = await jellyfinService.getUserHistory(userId, accessToken, 2000, jellyfinServer);

        // 3. Aggregate Stats
        let movieCount = 0;
        const seriesIds = new Set<string>();
        const genreCounts: Record<string, number> = {};
        let totalTicks = 0;

        for (const item of history) {
            // Count Type
            if (item.Type === 'Movie') movieCount++;
            if (item.Type === 'Episode' && item.SeriesId) {
                seriesIds.add(item.SeriesId);
                // Also track genre for episodes if available, 
                // but usually episodes inherit genres from series. 
                // Jellyfin API `Episode` item might contain Genres if requested.
            }

            // Count Genres
            if (item.Genres && Array.isArray(item.Genres)) {
                for (const g of item.Genres) {
                    if (g) {
                        genreCounts[g] = (genreCounts[g] || 0) + 1;
                    }
                }
            }

            // Sum Duration
            if (item.RunTimeTicks) {
                totalTicks += item.RunTimeTicks;
            }
        }

        const seriesCount = seriesIds.size;

        // Convert Ticks to Hours
        // 1 tick = 100 nanoseconds => 10,000,000 ticks = 1 second
        const totalSeconds = totalTicks / 10000000;
        const totalHours = Math.round(totalSeconds / 3600);

        // Format Genre Data for Recharts (Array of objects)
        // Sort by count desc and take top 8
        const genreData = Object.entries(genreCounts)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 8);

        res.json({
            stats: {
                movies: movieCount,
                series: seriesCount,
                blocked: blockedCount,
                totalHours: totalHours
            },
            genres: genreData
        });

    } catch (error) {
        if (error instanceof JellyfinAuthError) {
            return res.status(401).json({ error: error.message, code: 'TOKEN_EXPIRED' });
        }
        console.error('Stats aggregation failed:', error);
        res.status(500).json({ error: `Failed to fetch stats: ${error instanceof Error ? error.message : String(error)}` });
    }
});

/**
 * GET /api/stats/profile
 * Generates an AI taste profile summary based on watch history.
 * Query: type = 'movie' | 'tv'
 */
router.get('/profile', async (req, res) => {
    const accessToken = req.headers['x-access-token'] as string;
    const userId = req.headers['x-user-id'] as string;
    const userName = req.headers['x-user-name'] as string;
    const jellyfinServerRaw = req.headers['x-jellyfin-url'] as string | undefined;
    const jellyfinServer = jellyfinServerRaw ? sanitizeUrl(jellyfinServerRaw) : undefined;
    const type = (req.query.type as string)?.toLowerCase() || 'movie';

    if (!accessToken || !userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Fetch User History (limit to recent 50 items for profile generation to save context)
        // We filter by specific type if possible, or just fetch all and filter locally
        const history = await jellyfinService.getUserHistory(userId, accessToken, 100, jellyfinServer);

        // Filter and Map to MediaItemInput
        const validItems = history
            .filter(item => {
                if (type === 'movie') return item.Type === 'Movie';
                if (type === 'tv' || type === 'series') return item.Type === 'Series' || (item.Type === 'Episode' && item.SeriesName);
                return false;
            })
            .map(item => ({
                title: item.SeriesName || item.Name, // Use SeriesName for episodes if available
                releaseYear: item.ProductionYear,
                mediaType: type === 'tv' || type === 'series' ? 'tv' : 'movie'
            }));

        // Deduplicate by title
        const uniqueItems = Array.from(new Map(validItems.map(item => [item.title, item])).values());

        if (uniqueItems.length === 0) {
            return res.json({ profile: `No watched ${type} history found to analyze.` });
        }

        const profile = await GeminiService.summarizeProfile(userName, uniqueItems, type === 'tv' ? 'tv' : 'movie');

        res.json({ profile });

    } catch (error) {
        console.error('Profile generation failed:', error);
        // Do not return 500, just return a fallback message so UI doesn't break
        res.json({ profile: 'Could not generate taste profile at this time.' });
    }
});

export default router;
