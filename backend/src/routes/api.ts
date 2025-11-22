import { Router } from 'express';
import { Recommender } from '../recommender';
import { JellyfinService } from '../jellyfin';
import { JellyfinItem, JellyfinAuthResponse, LoginResponse } from '../types'; // Updated import
import { getUserData, updateMediaStatus, getFullWatchlist, removeFromWatchlist } from '../services/data';
import { GeminiService } from '../services/gemini';
import { requestMediaByTmdb, search as jellySearch } from '../services/jellyseerr';

const router = Router();
const jellyfinService = new JellyfinService();

// NOTE: User authentication is handled by /api/auth routes in `routes/auth.ts`.

// Endpoint to get user views (libraries)
router.get('/libraries', async (req, res) => {
    const accessToken = req.headers['x-access-token'] as string; // Assuming token in header

    if (!accessToken) {
        return res.status(401).json({ error: 'Unauthorized: Access token missing' });
    }

    try {
        const libraries = await jellyfinService.getLibraries(accessToken);
        res.json(libraries);
    } catch (error) {
        console.error('Error fetching Jellyfin libraries:', error);
        res.status(500).json({ error: 'An unexpected error occurred while fetching libraries' });
    }
});

// Endpoint to get items (movies, series) from a specific library
router.get('/items', async (req, res) => {
    const { libraryId, searchTerm } = req.query;
    const accessToken = req.headers['x-access-token'] as string;
    const userId = req.headers['x-user-id'] as string;

    if (!accessToken || !userId) {
        return res.status(401).json({ error: 'Unauthorized: Access token or User ID missing' });
    }
    if (!libraryId) {
        return res.status(400).json({ error: 'Missing required query parameter: libraryId' });
    }

    try {
        const items = await jellyfinService.getItems(userId, accessToken, libraryId as string, searchTerm as string | undefined);
        res.json(items);
    } catch (error) {
        console.error('Error fetching Jellyfin items:', error);
        res.status(500).json({ error: 'An unexpected error occurred while fetching items' });
    }
});

// User watchlist (Prisma-backed)
router.get('/user/watchlist', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] as string;
        const userName = req.headers['x-user-name'] as string;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        const username = userName || userId;
        const list = await getFullWatchlist(username);
        res.json(list);
    } catch (e) {
        console.error('Failed to fetch user watchlist', e);
        res.status(500).json({ error: 'Failed to fetch watchlist' });
    }
});

// Search endpoint backed by Jellyseerr
router.get('/search', async (req, res) => {
    try {
        const q = req.query.query as string | undefined;
        if (!q) return res.status(400).json({ error: 'Missing query parameter' });
        const results = await jellySearch(q);
        // Map to standardized frontend shape
        const mapped = (results || []).map(r => ({
            tmdbId: r.tmdb_id ? Number(r.tmdb_id) : null,
            title: r.title,
            posterUrl: r.posterUrl,
            mediaType: r.media_type || 'movie',
            releaseYear: r.releaseDate ? String(r.releaseDate).substring(0,4) : '',
            overview: r.overview,
        })).filter((x: any) => x.tmdbId !== null);
        res.json(mapped);
    } catch (e) {
        console.error('Search failed', e);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Enhanced /recommendations endpoint that integrates DataService + Gemini
router.get('/recommendations', async (req, res) => {
    const { targetItemId, libraryId, type, genre } = req.query;
    const accessToken = req.headers['x-access-token'] as string;
    const userId = req.headers['x-user-id'] as string;
    const userName = req.headers['x-user-name'] as string;

    if (!accessToken || !userId) {
        return res.status(401).json({ error: 'Unauthorized: Access token or User ID missing' });
    }

    try {
        // Fetch items from the given library, or from all libraries if none specified
        let items: JellyfinItem[] = [];
        if (libraryId) {
            items = await jellyfinService.getItems(userId, accessToken, libraryId as string);
        } else {
            // no library specified: fetch all libraries and aggregate items (user-history mode)
            let libs: any[] = [];
            try {
                libs = (await jellyfinService.getLibraries(accessToken)) || [];
            } catch (e) {
                console.warn('Failed to fetch libraries for aggregation, continuing with empty list', e);
                libs = [];
            }
            const pools = libs.length ? await Promise.all(libs.map(l => jellyfinService.getItems(userId, accessToken, l.Id))) : [];
            items = (pools || []).flat();
        }

        // Load user's lists from the new Prisma-based service (returns ID arrays)
        const userData = await getUserData(userName || userId);

        // Filter candidate pool: remove blacklisted and already watched items by tmdb id
        const blacklistIds = new Set((userData.blockedIds || []).filter(Boolean));
        const watchedIds = new Set((userData.watchedIds || []).filter(Boolean));

        // Map jellyfin items to candidate entries (include tmdb if present in user DB or item tag)
        const candidates = items.filter(item => {
            // If item has tmdb id in local metadata use it, otherwise keep (AI will try to enrich)
            const tmdb = (item as any).tmdb_id as number | undefined;
            if (tmdb && (blacklistIds.has(tmdb) || watchedIds.has(tmdb))) return false;
            // Note: legacy title-based filtering relied on the JSON DB. With Prisma we only filter by trusted tmdb IDs here.
            return true;
        });

        // Fetch user's real watch history from Jellyfin and pass into Gemini prompt for parity
        // Ensure history is always an array (defensive)
        let history = await jellyfinService.getUserHistory(userId, accessToken);
        if (!Array.isArray(history)) {
            console.warn('getUserHistory returned non-array, defaulting to empty array', history);
            history = [];
        }

        // Prepare filters
        const filters = { type: type as string | undefined, genre: genre as string | undefined };

        // Try Gemini first (if configured), otherwise fallback to heuristic recommender
        let recommendations = await GeminiService.getRecommendations(userName || userId, { ...userData, jellyfin_history: history } as any, candidates as any, filters);
        if (!recommendations) {
            console.warn('GeminiService.getRecommendations returned falsy value, defaulting to empty array');
            recommendations = [];
        }

        // Debug logging to help diagnose crashes where .map may be called on undefined
        console.log('Gemini Output (recommendations):', Array.isArray(recommendations) ? `array(${recommendations.length})` : typeof recommendations);

        // If Gemini returns nothing, use local heuristic recommender as fallback
        if (!recommendations || recommendations.length === 0) {
            const recommender = new Recommender(items);
            if (targetItemId) {
                // Item-to-item fallback
                recommendations = recommender.recommend(targetItemId as string).map(i => ({ title: i.Name || 'Unknown', media_type: 'movie', tmdb_id: (i as any).tmdb_id } as any));
            } else {
                // General recommendations based on user history / top-rated candidates
                const sorted = items
                    .filter(it => !(it as any).IsFolder)
                    .sort((a, b) => (b.CommunityRating ?? 0) - (a.CommunityRating ?? 0))
                    .slice(0, 10)
                    .map(i => ({ title: i.Name || 'Unknown', media_type: 'movie', tmdb_id: (i as any).tmdb_id } as any));
                recommendations = sorted;
            }
        }

        // Enrich recommendations via Jellyseerr (if available)
        const { searchAndEnrich } = await (async () => await import('../services/jellyseerr'))();
        const safeRecs = Array.isArray(recommendations) ? recommendations : [];
        // For each Gemini recommendation, run strict verification via Jellyseerr. Drop any that fail verification.
        const blockedIdsSet = new Set((userData.blockedIds || []).filter(Boolean));
        const watchedIdsSet = new Set((userData.watchedIds || []).filter(Boolean));
        const watchlistIdsSet = new Set((userData.watchlistIds || []).filter(Boolean));

        const verifiedPromises = safeRecs.map(async (rec: any) => {
            // Pass media_type and Gemini-provided release_year to enforce strict checks
            try {
                const meta = await searchAndEnrich(rec.title, rec.media_type, rec.release_year);
                if (!meta) return null; // failed strict verification, drop

                // Defensive: ensure enrichment doesn't reintroduce already-watched/blocked/watchlist items
                const tmdb = meta.tmdb_id ? Number(meta.tmdb_id) : null;
                if (tmdb) {
                    if (blockedIdsSet.has(tmdb) || watchedIdsSet.has(tmdb) || watchlistIdsSet.has(tmdb)) return null;
                }

                return {
                    title: rec.title,
                    media_type: meta.media_type || rec.media_type || 'movie',
                    tmdbId: tmdb,
                    posterUrl: meta.posterUrl,
                    overview: meta.overview,
                    releaseDate: meta.releaseDate,
                    reason: rec.reason,
                };
            } catch (e) {
                console.error('Verification/enrichment error for', rec.title, e);
                return null;
            }
        });

        const verified = (await Promise.all(verifiedPromises)).filter((i): i is any => i !== null);
        res.json(verified);
    } catch (error) {
        console.error('Error generating recommendations:', error);
        res.status(500).json({ error: 'An unexpected error occurred while generating recommendations' });
    }
});

// Actions: watched / watchlist / block
router.post('/actions/watched', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] as string;
        const userName = req.headers['x-user-name'] as string;
        const payload = req.body;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        if (!payload || !payload.item) return res.status(400).json({ error: 'Missing item in body' });

        const username = userName || userId;
        await updateMediaStatus(username, payload.item as any, 'WATCHED');
        res.json({ ok: true });
    } catch (e) {
        console.error('Failed to add watched item', e);
        res.status(500).json({ error: 'Failed to add watched item' });
    }
});

router.post('/actions/watchlist', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] as string;
        const userName = req.headers['x-user-name'] as string;
        const payload = req.body;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        if (!payload || !payload.item) return res.status(400).json({ error: 'Missing item in body' });

        const username = userName || userId;
        await updateMediaStatus(username, payload.item as any, 'WATCHLIST');
        res.json({ ok: true });
    } catch (e) {
        console.error('Failed to add watchlist item', e);
        res.status(500).json({ error: 'Failed to add watchlist item' });
    }
});

// Remove from watchlist
router.post('/actions/watchlist/remove', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] as string;
        const userName = req.headers['x-user-name'] as string;
        const payload = req.body;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        if (!payload || !payload.item) return res.status(400).json({ error: 'Missing item in body' });

        const username = userName || userId;
        const ok = await removeFromWatchlist(username, payload.item as any);
        if (ok) return res.json({ ok: true });
        return res.status(500).json({ error: 'Failed to remove from watchlist' });
    } catch (e) {
        console.error('Failed to remove watchlist item', e);
        res.status(500).json({ error: 'Failed to remove watchlist item' });
    }
});

router.post('/actions/block', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] as string;
        const userName = req.headers['x-user-name'] as string;
        const payload = req.body;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        if (!payload || !payload.item) return res.status(400).json({ error: 'Missing item in body' });

        const username = userName || userId;
        await updateMediaStatus(username, payload.item as any, 'BLOCKED');
        res.json({ ok: true });
    } catch (e) {
        console.error('Failed to block item', e);
        res.status(500).json({ error: 'Failed to block item' });
    }
});

// Jellyseerr request
router.post('/jellyseerr/request', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] as string;
        const payload = req.body;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        // Accept either { tmdbId } (legacy) or { mediaId, mediaType }
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
