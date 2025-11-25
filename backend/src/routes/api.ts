import { Router, Request, Response } from 'express';
import { Recommender } from '../recommender';
import { JellyfinService } from '../jellyfin';
import { JellyfinItem, JellyfinAuthResponse, LoginResponse } from '../types'; // Updated import
import { getUserData, updateMediaStatus, getFullWatchlist, removeFromWatchlist } from '../services/data';
import prisma from '../services/data';
import { GeminiService } from '../services/gemini';
import { TasteService } from '../services/taste';
import { requestMediaByTmdb, search as jellySearch } from '../services/jellyseerr';
import ConfigService from '../services/config';
import path from 'path';
import fs from 'fs';
import importService from '../services/import';
import { exportUserData } from '../services/export';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AuthService } from '../authService';
import { sanitizeUrl, validateRequestUrl, validateSafeUrl } from '../utils/ssrf-protection';
import { 
  validateUserAction, 
  validateRecommendationRequest, 
  validateJellyfinSync,
  validateConfigUpdate,
  validateMediaRequest
} from '../middleware/validators';

const router = Router();
// Simple in-memory buffer cache for recommendation buffers (per user+type+genre)
const BufferCache: Map<string, any[]> = new Map();
const jellyfinService = new JellyfinService();

// Image Proxy Endpoint - Routes images through backend to avoid 403 from external Jellyseerr
router.get('/proxy/image', async (req, res) => {
    try {
        const path = req.query.path as string;
        const type = (req.query.type as string) || 'poster';
        
        if (!path) {
            return res.status(400).json({ error: 'Missing path parameter' });
        }

        // Get Jellyseerr config (supports dynamic runtime config)
        const config = await ConfigService.getConfig();
        const jellyseerrUrl = config.jellyseerrUrl;
        
        if (!jellyseerrUrl) {
            return res.status(503).json({ error: 'Jellyseerr URL not configured' });
        }

        // Handle two cases: 
        // 1. Absolute URLs (http://...) - proxy them directly
        // 2. Relative paths (/xxx.jpg) - construct Jellyseerr URL
        let imageUrl: string;
        
        if (path.startsWith('http://') || path.startsWith('https://')) {
            // Already an absolute URL - proxy it directly
            imageUrl = path;
        } else {
            // Relative path - construct from Jellyseerr base
            // Note: Use jellyseerrUrl directly since it's already validated in config
            const baseUrl = jellyseerrUrl;

            // Select appropriate image resolution based on type
            let upstreamPrefix = '/imageproxy/tmdb/t/p/w300_and_h450_face'; // Default: Poster
            if (type === 'backdrop') {
                upstreamPrefix = '/imageproxy/tmdb/t/p/w1920_and_h800_multi_faces'; // Backdrop (landscape)
            }

            // Construct full image URL
            imageUrl = `${baseUrl}${upstreamPrefix}${path}`;
        }
        
        // SSRF Protection: Validate the full URL before making request
        const validatedUrl = validateRequestUrl(imageUrl);
        
        // Fetch image from Jellyseerr with API key if available
        const headers: any = {};
        if (config.jellyseerrApiKey) {
            headers['X-Api-Key'] = config.jellyseerrApiKey;
        }

        // codeql[js/request-forgery] - User-configured URL for image proxy, validated by validateSafeUrl
        const response = await axios.get(validateSafeUrl(validatedUrl), {
            responseType: 'arraybuffer',
            headers,
            timeout: 10000
        });

        // Set appropriate headers
        const contentType = response.headers['content-type'] || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
        
        // Send image data
        res.send(response.data);
    } catch (error: any) {
        console.error('Image proxy error:', error?.message || error);
        
        // Return appropriate error status
        if (error?.response?.status) {
            res.status(error.response.status).json({ 
                error: `Failed to fetch image: ${error.response.status}` 
            });
        } else {
            res.status(500).json({ error: 'Failed to fetch image' });
        }
    }
});

// Standard mapper to normalize varied backend shapes to frontend contract
function toFrontendItem(item: any) {
    if (!item) return null;
    const tmdbRaw = item.tmdbId ?? item.tmdb_id ?? item.id ?? item.tmdb ?? item.tmdbId;
    const tmdbId = tmdbRaw !== undefined && tmdbRaw !== null ? Number(tmdbRaw) : null;
    const title = item.title || item.name || item.Title || '';
    const overview = item.overview ?? item.plot ?? item.synopsis ?? null;
    const mediaTypeRaw = item.mediaType ?? item.media_type ?? item.type ?? item.MediaType ?? 'movie';
    const mediaType = typeof mediaTypeRaw === 'string' ? mediaTypeRaw.toLowerCase() : 'movie';
    const releaseYear = item.releaseYear ?? (item.releaseDate ? String(item.releaseDate).substring(0,4) : (item.firstAirDate ? String(item.firstAirDate).substring(0,4) : '')) ?? '';
    // Poster resolution: Prefer local cached image, fallback to source URL
    let posterUrl: string | null = null;
    if (item.posterUrl) {
        // If posterUrl starts with /images/, convert to /api/images/ (backend serves cached images)
        if (item.posterUrl.startsWith('/images/')) {
            const filename = item.posterUrl.replace('/images/', '');
            posterUrl = `/api/images/${filename}`;
        } 
        // If posterUrl is already a proxy URL, use it
        else if (item.posterUrl.startsWith('/api/proxy/image') || item.posterUrl.startsWith('/api/images/')) {
            posterUrl = item.posterUrl;
        }
        // Otherwise, construct proxy URL
        else {
            posterUrl = `/api/proxy/image?type=poster&path=${encodeURIComponent(item.posterUrl)}`;
        }
    } 
    // Fallback to posterSourceUrl if posterUrl is missing
    else if (item.posterSourceUrl) {
        posterUrl = item.posterSourceUrl.startsWith('/api/proxy/image') 
            ? item.posterSourceUrl 
            : `/api/proxy/image?type=poster&path=${encodeURIComponent(item.posterSourceUrl)}`;
    }
    // Last resort: try legacy fields
    else {
        const posterSource = item.poster_path || item.poster || item.poster_url;
        if (posterSource) {
            posterUrl = `/api/proxy/image?type=poster&path=${encodeURIComponent(posterSource)}`;
        }
    }
    
    const voteAverage = item.voteAverage ?? item.vote_average ?? item.rating ?? 0;
    
    // Backdrop resolution: Prefer local cached image, fallback to source URL
    let backdropUrl: string | null = null;
    if (item.backdropUrl) {
        // If backdropUrl starts with /images/, convert to /api/images/ (backend serves cached images)
        if (item.backdropUrl.startsWith('/images/')) {
            const filename = item.backdropUrl.replace('/images/', '');
            backdropUrl = `/api/images/${filename}`;
        }
        // If backdropUrl is already a proxy URL, use it
        else if (item.backdropUrl.startsWith('/api/proxy/image') || item.backdropUrl.startsWith('/api/images/')) {
            backdropUrl = item.backdropUrl;
        }
        // Otherwise, construct proxy URL
        else {
            backdropUrl = `/api/proxy/image?type=backdrop&path=${encodeURIComponent(item.backdropUrl)}`;
        }
    }
    // Fallback to backdropSourceUrl if backdropUrl is missing
    else if (item.backdropSourceUrl) {
        backdropUrl = item.backdropSourceUrl.startsWith('/api/proxy/image')
            ? item.backdropSourceUrl
            : `/api/proxy/image?type=backdrop&path=${encodeURIComponent(item.backdropSourceUrl)}`;
    }
    // Last resort: try legacy fields
    else {
        const backdropSource = item.backdrop_path || item.backdrop || item.backdrop_url;
        if (backdropSource) {
            backdropUrl = `/api/proxy/image?type=backdrop&path=${encodeURIComponent(backdropSource)}`;
        }
    }
    return {
        tmdbId,
        title,
        overview,
        mediaType: mediaType === 'tv' ? 'tv' : 'movie',
        releaseYear: releaseYear || '',
        posterUrl,
        voteAverage: voteAverage === undefined || voteAverage === null ? 0 : Number(voteAverage),
        backdropUrl: backdropUrl || null,
    };
}

// NOTE: User authentication is handled by /api/auth routes in `routes/auth.ts`.

// Debug endpoint to inspect raw Jellyfin watched history
router.get('/debug/jellyfin', async (req, res) => {
    const accessToken = req.headers['x-access-token'] as string;
    const userId = req.headers['x-user-id'] as string;
    // SSRF Protection: Validate user-controlled URL from header at entry point
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

// Endpoint to get user views (libraries)
router.get('/libraries', async (req, res) => {
    const accessToken = req.headers['x-access-token'] as string; // Assuming token in header
    // SSRF Protection: Validate user-controlled URL from header at entry point
    const jellyfinServerRaw = req.headers['x-jellyfin-url'] as string | undefined;
    const jellyfinServer = jellyfinServerRaw ? sanitizeUrl(jellyfinServerRaw) : undefined;

    if (!accessToken) {
        return res.status(401).json({ error: 'Unauthorized: Access token missing' });
    }

    try {
        const libraries = await jellyfinService.getLibraries(accessToken, jellyfinServer);
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
    // SSRF Protection: Validate user-controlled URL from header at entry point
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
        // DEBUG: Log first item to see what data structure looks like
        if (list && list.length > 0) {
            console.log('[Watchlist API] First item from getFullWatchlist:', JSON.stringify(list[0], null, 2));
        }
        // Normalize to frontend contract for safety
        const mapped = (list || []).map(i => toFrontendItem(i)).filter((x: any) => x && x.tmdbId);
        // DEBUG: Log first mapped item to see what toFrontendItem returns
        if (mapped && mapped.length > 0) {
            console.log('[Watchlist API] First mapped item:', JSON.stringify(mapped[0], null, 2));
        }
        res.json(mapped);
    } catch (e) {
        console.error('Failed to fetch user watchlist', e);
        res.status(500).json({ error: 'Failed to fetch watchlist' });
    }
});

// Search endpoint backed by Jellyseerr
router.get('/search', async (req, res) => {
    try {
        const q = req.query.query as string | undefined;
        const userName = req.headers['x-user-name'] as string;
        const userId = req.headers['x-user-id'] as string;
        
        if (!q) return res.status(400).json({ error: 'Missing query parameter' });
        
        const results = await jellySearch(q);
        
        // Map to standardized frontend shape using helper
        let mapped = (results || []).map(r => toFrontendItem(r)).filter((x: any) => x && x.tmdbId);
        
        // Filter out items already tracked by this user (watched, watchlist, or blocked)
        if (userName || userId) {
            const userData = await getUserData(userName || userId);
            const existingIds = new Set<number>([
                ...(userData.watchedIds || []),
                ...(userData.watchlistIds || []),
                ...(userData.blockedIds || [])
            ]);
            
            const beforeCount = mapped.length;
            mapped = mapped.filter((item: any) => !existingIds.has(item.tmdbId));
            
            console.debug(`[Search] Filtered ${beforeCount - mapped.length} existing items for user ${userName || userId} (${mapped.length} remaining)`);
        }
        
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
    // SSRF Protection: Validate user-controlled URL from header at entry point
    const jellyfinServerRaw = req.headers['x-jellyfin-url'] as string | undefined;
    const jellyfinServer = jellyfinServerRaw ? sanitizeUrl(jellyfinServerRaw) : undefined;

    // Log incoming auth headers (masked) to help debug 401s during development
    try {
        const masked = accessToken ? `${String(accessToken).slice(0, 8)}...(${String(accessToken).length})` : 'none';
        const serverInfo = jellyfinServer ? `${jellyfinServer}` : 'none';
        // Use debug-level logging and avoid printing full query/payloads to prevent leaking sensitive data
        console.debug(`[Request] /api/recommendations - x-access-token: ${masked}, x-user-id: ${userId || 'none'}, x-user-name: ${userName || 'none'}, x-jellyfin-url: ${serverInfo}, query-keys: ${Object.keys(req.query).join(',')}`);
    } catch (e) {
        console.warn('Failed to log incoming headers for /recommendations', e);
    }

    if (!accessToken || !userId) {
        return res.status(401).json({ error: 'Unauthorized: Access token or User ID missing' });
    }

    try {
        // Fetch items from the given library, or from all libraries if none specified
        let items: JellyfinItem[] = [];
        if (libraryId) {
            items = await jellyfinService.getItems(userId, accessToken, libraryId as string, undefined, jellyfinServer);
        } else {
            // no library specified: fetch all libraries and aggregate items (user-history mode)
            let libs: any[] = [];
            try {
                libs = (await jellyfinService.getLibraries(accessToken, jellyfinServer)) || [];
            } catch (e) {
                console.warn('Failed to fetch libraries for aggregation, continuing with empty list', e);
                libs = [];
            }
            const pools = libs.length ? await Promise.all(libs.map(l => jellyfinService.getItems(userId, accessToken, l.Id, undefined, jellyfinServer))) : [];
            items = (pools || []).flat();
        }

        // Load user's lists from the new Prisma-based service (returns ID arrays)
        const userData = await getUserData(userName || userId);

        // Fetch user's real watch history from Jellyfin and pass into Gemini prompt for parity
        let history = await jellyfinService.getUserHistory(userId, accessToken, undefined, jellyfinServer);
        if (!Array.isArray(history)) {
            console.warn('getUserHistory returned non-array, defaulting to empty array', history);
            history = [];
        }

        // Extract TMDB IDs from Jellyfin history (from ProviderIds.Tmdb field)
        const { extractTmdbIds } = await import('../services/jellyfin-normalizer');
        const historyTmdbIds = extractTmdbIds(history);
        console.debug(`[Jellyfin] Extracted ${historyTmdbIds.length} TMDB IDs from ${history.length} watched items`);

        // Build owned-id sets for fast "Do I own this?" checks
        // Use JellyfinService helper we added to compute owned TMDBs and title-year keys
        const ownedSet = await jellyfinService.getOwnedIds(userId, accessToken, jellyfinServer);

        // Collect exclusions: titles (for prompting) and numeric TMDB ids (for strict filtering)
        const watchedTitles = (history || []).map((h: any) => {
            const name = h.Name || h.title || h.name || '';
            const year = h.ProductionYear || (h.PremiereDate ? String(h.PremiereDate).substring(0, 4) : '');
            return year ? `${name} (${year})` : name;
        }).filter(Boolean);

        const watchlistEntries = await getFullWatchlist(userName || userId);
        const watchlistTitles = (watchlistEntries || []).map((w: any) => (w.title || '').trim()).filter(Boolean);

        // Map blocked IDs to titles via local media DB when possible
        let blockedTitles: string[] = [];
        if (Array.isArray(userData.blockedIds) && userData.blockedIds.length) {
            try {
                const blockedMedia = await prisma.media.findMany({ where: { tmdbId: { in: userData.blockedIds.map((i: any) => Number(i)).filter(Boolean) } } });
                blockedTitles = blockedMedia.map(m => (m.title || '').trim()).filter(Boolean);
            } catch (e) {
                console.warn('Failed to resolve blockedIds to titles', e);
            }
        }

        const libraryTitles = (items || []).map(it => `${(it as any).Name || (it as any).Title || (it as any).name || ''}${(it as any).ProductionYear ? ` (${(it as any).ProductionYear})` : ''}`.trim()).filter(Boolean);

        const allExclusionArray = Array.from(new Set([...(watchedTitles || []), ...(watchlistTitles || []), ...(blockedTitles || []), ...(libraryTitles || [])]));

        // Build numeric exclusion set (TMDB ids) from userData, ownedSet, and Jellyfin history
        const excludedIds = new Set<number>();
        
        // Add TMDB IDs from Jellyfin watch history (PRIMARY SOURCE)
        historyTmdbIds.forEach(id => excludedIds.add(id));
        
        // Add watched/watchlist/blocked ids from DB
        (userData.watchedIds || []).forEach((id: any) => { const n = Number(id); if (Number.isFinite(n)) excludedIds.add(n); });
        (userData.watchlistIds || []).forEach((id: any) => { const n = Number(id); if (Number.isFinite(n)) excludedIds.add(n); });
        (userData.blockedIds || []).forEach((id: any) => { const n = Number(id); if (Number.isFinite(n)) excludedIds.add(n); });
        
        // Add owned TMDB ids from ownedSet
        for (const s of Array.from(ownedSet || [])) {
            if (typeof s === 'string' && s.startsWith('tmdb:')) {
                const num = Number(s.split(':')[1]);
                if (Number.isFinite(num)) excludedIds.add(num);
            }
        }
        
        console.debug(`[Exclusions] Total excluded TMDB IDs: ${excludedIds.size} (${historyTmdbIds.length} from history, ${userData.watchedIds?.length || 0} from DB watched, ${userData.watchlistIds?.length || 0} from watchlist, ${userData.blockedIds?.length || 0} blocked)`);

        // Prepare filters
        const filters = { type: type as string | undefined, genre: genre as string | undefined };

        const { searchAndEnrich } = await (async () => await import('../services/jellyseerr'))();

        // Buffer-based fetch: try to keep a per-user/type/genre buffer of recommendations
        const TARGET_COUNT = 10;
        const BATCH_SIZE = 30; // request 30 items per Gemini call
        const MAX_ATTEMPTS = 3;

        const likedItems = [ ...(history || []), ...(watchlistEntries || []) ];
        const dislikedItems = Array.isArray(userData.blockedIds) ? userData.blockedIds : [];

        const cacheKey = `buffer_${userName || userId}_${filters.type || 'any'}_${filters.genre || 'any'}`;
        let buffer = BufferCache.get(cacheKey) || [];

        let attempts = 0;
        while ((buffer.length < TARGET_COUNT) && attempts < MAX_ATTEMPTS) {
            attempts++;
            console.debug(`[Buffer] Attempt ${attempts}/${MAX_ATTEMPTS} — buffer has ${buffer.length}/${TARGET_COUNT}`);

            // Ensure we have a taste profile (may be empty). Trigger update in background if missing.
            let tasteProfile = await TasteService.getProfile(userName || userId, (filters.type === 'tv') ? 'tv' : 'movie');
            if (!tasteProfile || tasteProfile.length < 10) {
                // Fire-and-forget update so next time profile will be fresher
                TasteService.triggerUpdate(userName || userId, (filters.type === 'tv') ? 'tv' : 'movie', accessToken, userId);
            }

            // Build exclusion table for prompt (Title | Year)
            const exclusionTable = allExclusionArray.map(t => {
                // Try to extract year in parentheses
                const m = t.match(/\((\d{4})\)$/);
                const year = m ? m[1] : '';
                const title = m ? t.replace(/\s*\(\d{4}\)$/, '') : t;
                return `| ${title.trim()} | ${year} |`;
            }).join('\n');

            // Ask Gemini for a batch of recommendations using profile + exclusions
            let rawRecs: any[] = [];
            try {
                rawRecs = await GeminiService.getRecommendations(
                    userName || userId,
                    { ...userData, jellyfin_history: history } as any,
                    likedItems,
                    dislikedItems,
                    { type: filters.type, genre: filters.genre },
                    tasteProfile,
                    exclusionTable
                );
            } catch (e) {
                console.error('Gemini batch fetch failed', e);
                rawRecs = [];
            }

            try {
                const sampleCount = Array.isArray(rawRecs) ? Math.min(5, rawRecs.length) : 0;
                const sample = (Array.isArray(rawRecs) ? rawRecs.slice(0, sampleCount).map(r => ({ title: r.title || r.name || '<unknown>', year: r.release_year || r.releaseYear || '' })) : []);
                console.debug(`[Gemini] Batch returned ${Array.isArray(rawRecs) ? rawRecs.length : 0} items. Sample:`, sample);
            } catch (logErr) {
                // ignore logging errors
            }

            if (!Array.isArray(rawRecs)) rawRecs = [];

            for (const rec of rawRecs) {
                if (buffer.length >= TARGET_COUNT) break;
                try {
                    if (!rec || !rec.title) continue;
                    const recTitle = String(rec.title).trim();
                    if (!recTitle) continue;

                    // Enrich & verify
                    const enriched = await searchAndEnrich(recTitle, rec.media_type, rec.release_year);
                    if (!enriched) {
                        console.warn('Enrichment failed for candidate from Gemini:', { title: recTitle, year: rec.release_year, media_type: rec.media_type });
                        continue;
                    }
                    if (!enriched) continue;
                    const tmdb = enriched.tmdb_id ? Number(enriched.tmdb_id) : null;
                    if (!tmdb || !Number.isFinite(tmdb)) continue;

                    // Skip if excluded or already owned
                    if (excludedIds.has(tmdb)) continue;
                    if (Array.from(ownedSet || []).some(s => typeof s === 'string' && s === `tmdb:${tmdb}`)) continue;

                    // Skip duplicates in buffer
                    if (buffer.find(b => Number(b.tmdb_id) === tmdb)) continue;

                    buffer.push(enriched);
                    excludedIds.add(tmdb);
                } catch (e) {
                    console.error('Error processing candidate', rec, e);
                    continue;
                }
            }
        }

        // Serve top TARGET_COUNT and persist remaining back into cache
        const responseItems = buffer.slice(0, TARGET_COUNT);
        const remaining = buffer.slice(TARGET_COUNT);
        BufferCache.set(cacheKey, remaining);

        // Trigger a background profile refresh to keep tastes up-to-date
        TasteService.triggerUpdate(userName || userId, (filters.type === 'tv') ? 'tv' : 'movie', accessToken, userId);

        // Normalize and present final result items to frontend contract
        const validItems = (responseItems || []).slice(0, TARGET_COUNT).map(d => toFrontendItem(d)).filter((x: any) => x && x.tmdbId);
        // Audit the final array going to the frontend
        try {
            // Debug: do not log item details in production logs to avoid exposing metadata
            console.debug(`[API Response] Sending ${validItems.length} items.`);
        } catch (logErr) {
            console.warn('Failed to log final API response sample', logErr);
        }
        res.json(validItems);
    } catch (error) {
        console.error('Error generating recommendations:', error);
        res.status(500).json({ error: 'An unexpected error occurred while generating recommendations' });
    }
});

// Actions: watched / watchlist / block
router.post('/actions/watched', validateUserAction, async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'] as string;
        const userName = req.headers['x-user-name'] as string;
        const payload = req.body;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        if (!payload || !payload.item) return res.status(400).json({ error: 'Missing item in body' });

        const username = userName || userId;
        const token = req.headers['x-access-token'] as string | undefined;
        await updateMediaStatus(username, payload.item as any, 'WATCHED', token);
        res.json({ ok: true });
    } catch (e) {
        console.error('Failed to add watched item', e);
        res.status(500).json({ error: 'Failed to add watched item' });
    }
});

router.post('/actions/watchlist', validateUserAction, async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'] as string;
        const userName = req.headers['x-user-name'] as string;
        const payload = req.body;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        if (!payload || !payload.item) return res.status(400).json({ error: 'Missing item in body' });

        const username = userName || userId;
        const token = req.headers['x-access-token'] as string | undefined;
        await updateMediaStatus(username, payload.item as any, 'WATCHLIST', token);
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

router.post('/actions/block', validateUserAction, async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'] as string;
        const userName = req.headers['x-user-name'] as string;
        const payload = req.body;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        if (!payload || !payload.item) return res.status(400).json({ error: 'Missing item in body' });

        const username = userName || userId;
        const token = req.headers['x-access-token'] as string | undefined;
        await updateMediaStatus(username, payload.item as any, 'BLOCKED', token);
        res.json({ ok: true });
    } catch (e) {
        console.error('Failed to block item', e);
        res.status(500).json({ error: 'Failed to block item' });
    }
});

// Jellyseerr request
router.post('/jellyseerr/request', validateMediaRequest, async (req: Request, res: Response) => {
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

// System config/status endpoints for first-run setup
router.get('/system/status', async (req, res) => {
    try {
        const cfg = await ConfigService.getConfig();
        const configured = !!cfg && !!cfg.isConfigured;
        res.json({ configured });
    } catch (e) {
        console.error('Failed to read system config status', e);
        res.status(500).json({ error: 'Failed to read system config status' });
    }
});

// GET /api/system/setup-defaults
// Returns values to pre-fill the Setup Wizard. Environment variables take
// precedence over DB values for convenience when operators populate .env.
router.get('/system/setup-defaults', async (req, res) => {
    try {
        // Load DB-backed config (may include nulls). We'll overlay env vars on top.
        const dbCfg = await ConfigService.getConfig();

        const defaults = {
            jellyfinUrl: process.env.JELLYFIN_URL || (dbCfg && dbCfg.jellyfinUrl) || null,
            jellyseerrUrl: process.env.JELLYSEERR_URL || (dbCfg && dbCfg.jellyseerrUrl) || null,
            jellyseerrApiKey: process.env.JELLYSEERR_API_KEY || (dbCfg && dbCfg.jellyseerrApiKey) || null,
            geminiApiKey: process.env.GEMINI_API_KEY || (dbCfg && dbCfg.geminiApiKey) || null,
            geminiModel: process.env.GEMINI_MODEL || (dbCfg && dbCfg.geminiModel) || 'gemini-2.5-flash-lite',
        };

        res.json(defaults);
    } catch (e) {
        console.error('Failed to fetch setup defaults', e);
        res.status(500).json({ error: 'Failed to fetch setup defaults' });
    }
});

// POST /api/system/verify
// Verifies connectivity to Jellyfin, Jellyseerr and Gemini using provided values.
router.post('/system/verify', async (req, res) => {
    try {
        const payload = req.body || {};
        const jellyfinUrlRaw = payload.jellyfinUrl as string | undefined;
        const jellyseerrUrlRaw = payload.jellyseerrUrl as string | undefined;
        const jellyseerrApiKey = payload.jellyseerrApiKey as string | undefined;
        const geminiApiKey = payload.geminiApiKey as string | undefined;

        // Jellyfin check
        const jellyfinCheck = (async () => {
            try {
                const base = sanitizeUrl(jellyfinUrlRaw);
                if (!base) return { ok: false, message: 'No Jellyfin URL provided or invalid' };
                const url = validateRequestUrl(`${base}/System/Info/Public`);
                // SSRF Protection: Explicit validation immediately before axios call breaks CodeQL taint flow
                // codeql[js/request-forgery] - User-configured Jellyfin URL for health check, validated by validateSafeUrl
                const resp = await axios.get(validateSafeUrl(url), { timeout: 8000 });
                if (resp.status === 200) {
                    const ver = (resp.data && (resp.data.Version || resp.data.ServerVersion || resp.data.version)) || '';
                    return { ok: true, message: ver ? `Connected to ${ver}` : 'Connected' };
                }
                return { ok: false, message: `HTTP ${resp.status}` };
            } catch (e: any) {
                const msg = e?.response ? `${e.response.status} ${e.response.statusText || ''}`.trim() : (e?.message || String(e));
                return { ok: false, message: msg };
            }
        })();

        // Jellyseerr check
        const jellyseerrCheck = (async () => {
            try {
                const base = sanitizeUrl(jellyseerrUrlRaw);
                if (!base) return { ok: false, message: 'No Jellyseerr URL provided or invalid' };
                const url = validateRequestUrl(`${base}/api/v1/status`);
                const headers: any = {};
                if (jellyseerrApiKey) headers['X-Api-Key'] = String(jellyseerrApiKey);
                // SSRF Protection: Explicit validation immediately before axios call breaks CodeQL taint flow
                // codeql[js/request-forgery] - User-configured Jellyseerr URL for health check, validated by validateSafeUrl
                const resp = await axios.get(validateSafeUrl(url), { headers, timeout: 8000 });
                if (resp.status === 200) {
                    const info = resp.data?.status || resp.data?.message || 'OK';
                    return { ok: true, message: String(info) };
                }
                return { ok: false, message: `HTTP ${resp.status}` };
            } catch (e: any) {
                const msg = e?.response ? `${e.response.status} ${e.response.statusText || ''}`.trim() : (e?.message || String(e));
                return { ok: false, message: msg };
            }
        })();

        // Gemini check
        const geminiCheck = (async () => {
            try {
                if (!geminiApiKey) return { ok: false, message: 'No Gemini API key provided' };
                // Try to construct SDK client similar to runtime
                let client: any;
                try {
                    client = new (GoogleGenerativeAI as any)({ apiKey: String(geminiApiKey) });
                } catch (inner) {
                    try { client = new (GoogleGenerativeAI as any)(String(geminiApiKey)); } catch (i2) { throw i2; }
                }

                // Try a lightweight call if available (list models) to validate key
                try {
                    if (typeof client.listModels === 'function') {
                        await client.listModels({ pageSize: 1 });
                    } else if (typeof client.models?.list === 'function') {
                        await client.models.list({ pageSize: 1 });
                    } else {
                        // Best-effort: if client constructed, treat as provisionally OK
                    }
                } catch (callErr: any) {
                    const msg = callErr?.response?.data || callErr?.message || String(callErr);
                    return { ok: false, message: String(msg) };
                }

                return { ok: true, message: 'OK' };
            } catch (e: any) {
                const msg = e?.response ? (e.response.data || `${e.response.status} ${e.response.statusText || ''}`) : (e?.message || String(e));
                return { ok: false, message: String(msg) };
            }
        })();

        const [jRes, jsRes, gRes] = await Promise.all([jellyfinCheck, jellyseerrCheck, geminiCheck]);

        res.json({ jellyfin: jRes, jellyseerr: jsRes, gemini: gRes });
    } catch (err: any) {
        console.error('Verification endpoint error', err);
        res.status(500).json({ error: 'Verification failed', detail: String(err?.message || err) });
    }
});

// DEBUG: expose full system config for local testing only when caller provides x-debug: 1
router.get('/system/config', async (req, res) => {
    try {
        const debugHeader = req.headers['x-debug'];
        if (!debugHeader || String(debugHeader) !== '1') return res.status(403).json({ error: 'Forbidden' });
        const cfg = await ConfigService.getConfig();
        // Return full config (do not enable in production)
        res.json({ ok: true, config: cfg });
    } catch (e) {
        console.error('Failed to read system config', e);
        res.status(500).json({ error: 'Failed to read system config' });
    }
});

router.post('/system/setup', async (req, res) => {
    try {
        const payload = req.body || {};
        // Accept keys: jellyfinUrl, jellyseerrUrl, jellyseerrApiKey, geminiApiKey, geminiModel
        const allowed: any = {
            jellyfinUrl: payload.jellyfinUrl,
            jellyseerrUrl: payload.jellyseerrUrl,
            jellyseerrApiKey: payload.jellyseerrApiKey,
            geminiApiKey: payload.geminiApiKey,
            geminiModel: payload.geminiModel,
        };
        const result = await ConfigService.saveConfig(allowed);
        res.json({ ok: true, result });
    } catch (e) {
        console.error('Failed to save system config', e);
        res.status(500).json({ error: 'Failed to save system config' });
    }
});

// GET /api/system/config-editor - Fetch config with masked API keys for Settings UI
router.get('/system/config-editor', async (req, res) => {
    try {
        const cfg = await ConfigService.getConfig();
        
        // Mask API keys for security (show only last 4 characters)
        const maskApiKey = (key: string | null | undefined): string => {
            if (!key) return '';
            if (key.length <= 8) return '********';
            return `${'*'.repeat(key.length - 4)}${key.slice(-4)}`;
        };

        const masked = {
            jellyfinUrl: cfg.jellyfinUrl || '',
            jellyseerrUrl: cfg.jellyseerrUrl || '',
            jellyseerrApiKey: maskApiKey(cfg.jellyseerrApiKey),
            geminiApiKey: maskApiKey(cfg.geminiApiKey),
            geminiModel: cfg.geminiModel || 'gemini-2.5-flash-lite',
            isConfigured: cfg.isConfigured || false,
        };

        res.json({ ok: true, config: masked });
    } catch (e) {
        console.error('Failed to fetch config for editor', e);
        res.status(500).json({ error: 'Failed to fetch configuration' });
    }
});

// PUT /api/system/config-editor - Update config from Settings UI
router.put('/system/config-editor', validateConfigUpdate, async (req: Request, res: Response) => {
    try {
        const payload = req.body || {};
        
        // Get current config to check for masked values
        const currentConfig = await ConfigService.getConfig();
        
        // Helper to detect if a value is masked (contains only asterisks + up to 4 chars)
        const isMasked = (value: string | null | undefined): boolean => {
            if (!value) return false;
            // Check if it's all asterisks or asterisks followed by last 4 chars
            return /^\*+[^\*]{0,4}$/.test(value) || value === '********';
        };

        // Build update payload, ignoring masked placeholder values
        const updatePayload: any = {
            jellyfinUrl: payload.jellyfinUrl || null,
            jellyseerrUrl: payload.jellyseerrUrl || null,
            geminiModel: payload.geminiModel || 'gemini-2.5-flash-lite',
        };

        // Only update API keys if they're not masked
        if (payload.jellyseerrApiKey && !isMasked(payload.jellyseerrApiKey)) {
            updatePayload.jellyseerrApiKey = payload.jellyseerrApiKey;
        } else if (currentConfig.jellyseerrApiKey) {
            // Keep existing key
            updatePayload.jellyseerrApiKey = currentConfig.jellyseerrApiKey;
        }

        if (payload.geminiApiKey && !isMasked(payload.geminiApiKey)) {
            updatePayload.geminiApiKey = payload.geminiApiKey;
        } else if (currentConfig.geminiApiKey) {
            // Keep existing key
            updatePayload.geminiApiKey = currentConfig.geminiApiKey;
        }

        // Check if Jellyseerr URL changed (triggers image re-download)
        const jellyseerrUrlChanged = updatePayload.jellyseerrUrl && 
            updatePayload.jellyseerrUrl !== currentConfig.jellyseerrUrl;

        const result = await ConfigService.saveConfig(updatePayload);
        
        // If Jellyseerr URL changed, queue image re-download
        // Note: Actual migration happens in next metadata backfill or can be triggered manually
        // via: npm run db:migrate-images
        if (jellyseerrUrlChanged) {
            console.log('[ConfigEditor] Jellyseerr URL changed. Run `npm run db:migrate-images` to re-download images from new source.');
            res.json({ 
                ok: true, 
                message: 'Configuration updated. To re-download images from new Jellyseerr URL, run: npm run db:migrate-images',
                jellyseerrUrlChanged: true
            });
        } else {
            res.json({ ok: true, message: 'Configuration updated successfully' });
        }
    } catch (e) {
        console.error('Failed to update config', e);
        res.status(500).json({ error: 'Failed to update configuration' });
    }
});

// SSE endpoint for import progress
router.get('/settings/import/progress/:username', (req, res) => {
    const { username } = req.params;
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
    
    console.log(`[SSE] Client connected for import progress: ${username}`);
    
    // Send initial progress
    const initialProgress = importService.getProgress(username);
    if (initialProgress) {
        res.write(`data: ${JSON.stringify(initialProgress)}\n\n`);
    }
    
    // Poll and send updates every 500ms
    const interval = setInterval(() => {
        const progress = importService.getProgress(username);
        if (progress) {
            res.write(`data: ${JSON.stringify(progress)}\n\n`);
            
            // Close connection when complete
            if (progress.completed) {
                clearInterval(interval);
                res.end();
            }
        } else {
            // No active import, send inactive status
            res.write(`data: ${JSON.stringify({ active: false })}\n\n`);
        }
    }, 500);
    
    // Cleanup on client disconnect
    req.on('close', () => {
        clearInterval(interval);
        console.log(`[SSE] Client disconnected: ${username}`);
    });
});

// Import legacy database.json payload into Prisma non-destructively
router.post('/settings/import', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] as string;
        const userName = req.headers['x-user-name'] as string;
        const token = req.headers['x-access-token'] as string | undefined;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        // Accept either raw parsed object or a wrapper { jsonContent: '...' }
        const payload = req.body;
        let parsed: any = payload;
        if (payload && typeof payload.jsonContent === 'string') {
            try {
                parsed = JSON.parse(payload.jsonContent);
            } catch (e) {
                return res.status(400).json({ error: 'Invalid JSON in jsonContent' });
            }
        }

        const username = (userName || userId);
        
        // Count items to estimate time
        const itemCount = 
            (Array.isArray(parsed?.data?.movies) ? parsed.data.movies.length : 0) +
            (Array.isArray(parsed?.data?.series) ? parsed.data.series.length : 0) +
            (Array.isArray(parsed?.data?.watchlist?.movies) ? parsed.data.watchlist.movies.length : 0) +
            (Array.isArray(parsed?.data?.watchlist?.series) ? parsed.data.watchlist.series.length : 0);

        console.log(`[Import] Starting import for ${username}: ~${itemCount} items`);

        // For large imports (>50 items), run async and return immediately
        if (itemCount > 50) {
            // Start async import (don't await)
            importService.processImport(username, parsed, token).then(summary => {
                // codeql[js/log-injection] - username is from authenticated session, summary is typed object from processImport
                console.log(`[Import] Async import complete for ${username}:`, summary);
            }).catch(e => {
                // codeql[js/log-injection] - username is from authenticated session, not user-controlled input
                console.error(`[Import] Async import failed for ${username}:`, e);
            });
            
            // Return immediately
            return res.json({ 
                ok: true, 
                async: true,
                message: `Import started in background. Processing ~${itemCount} items. Check logs for progress.`,
                estimatedMinutes: Math.ceil(itemCount / 20) // ~20 items/minute estimate
            });
        }

        // For small imports, process synchronously
        const summary = await importService.processImport(username, parsed, token);
        res.json({ ok: true, async: false, summary });
    } catch (e) {
        console.error('Import failed', e);
        res.status(500).json({ error: 'Import failed', message: String(((e as any)?.message) || e) });
    }
});

// Export current database state to legacy JSON format
router.get('/settings/export', async (req, res) => {
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

        // Set headers for file download
        const filename = `jellyfin-backup-${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        res.json(exportData);
    } catch (e) {
        console.error('Export failed', e);
        res.status(500).json({ error: 'Export failed', message: String(((e as any)?.message) || e) });
    }
});

// POST /api/sync/jellyfin - Sync watch history from Jellyfin to local database
router.post('/sync/jellyfin', validateJellyfinSync, async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'] as string;
        const userName = req.headers['x-user-name'] as string;
        const accessToken = req.headers['x-access-token'] as string;
        // SSRF Protection: Validate user-controlled URL from header at entry point
        const jellyfinUrlRaw = req.headers['x-jellyfin-url'] as string | undefined;
        const jellyfinUrl = jellyfinUrlRaw ? sanitizeUrl(jellyfinUrlRaw) : undefined;

        if (!userId || !userName || !accessToken) {
            return res.status(401).json({ error: 'Unauthorized - Missing auth headers' });
        }

        console.log(`[API] Starting Jellyfin sync for user: ${userName}`);

        // Dynamic import to avoid circular dependencies
        const { syncHistory } = await import('../services/sync');
        
        const result = await syncHistory(userId, userName, accessToken, jellyfinUrl);

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
        console.error('[API] Sync failed:', e);
        res.status(500).json({ 
            success: false,
            error: 'Sync failed', 
            message: e?.message || String(e) 
        });
    }
});

// GET /api/images/:filename - Serve locally cached images
router.get('/images/:filename', (req: Request, res: Response) => {
    const { filename } = req.params;
    // Security: Validate filename to prevent directory traversal
    if (!filename || !/^movie_\d+_(poster|backdrop)\.(jpg|png)$/.test(filename)) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    const imagePath = path.join('/app/images', filename);
    
    // Check if file exists
    if (!fs.existsSync(imagePath)) {
        return res.status(404).json({ error: 'Image not found' });
    }
    
    // Serve the image file
    res.sendFile(imagePath);
});

export default router;

