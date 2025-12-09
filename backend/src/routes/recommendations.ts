/**
 * Recommendations routes - AI-powered recommendations and search
 */

import { Router, Request, Response } from 'express';
import { JellyfinService, JellyfinAuthError } from '../jellyfin';
import { JellyfinItem, FrontendItem, UserData, MediaItemInput, RecommendationCandidate } from '../types';
import { getUserData, getFullWatchlist } from '../services/data';
import prisma from '../services/data';
import { GeminiService } from '../services/gemini';
import { TasteService } from '../services/taste';
import { search as jellySearch, Enriched } from '../services/jellyseerr';
import { CacheService } from '../services/cache';
import { sanitizeUrl } from '../utils/ssrf-protection';
import { toFrontendItem } from './route-utils';

const router = Router();
const jellyfinService = new JellyfinService();

/**
 * GET /search - Search for media via Jellyseerr
 */
router.get('/search', async (req, res) => {
    try {
        const q = req.query.query as string | undefined;
        const userName = req.headers['x-user-name'] as string;
        const userId = req.headers['x-user-id'] as string;

        if (!q) return res.status(400).json({ error: 'Missing query parameter' });

        const results = await jellySearch(q);
        let mapped = (results || []).map(r => toFrontendItem(r)).filter((x): x is FrontendItem => x !== null && x.tmdbId !== null);

        // Filter out items already tracked by this user
        if (userName || userId) {
            const userData = await getUserData(userName || userId);
            const existingIds = new Set<number>([
                ...(userData.watchedIds || []),
                ...(userData.watchlistIds || []),
                ...(userData.blockedIds || [])
            ]);
            const beforeCount = mapped.length;
            mapped = mapped.filter((item: FrontendItem) => item.tmdbId !== null && !existingIds.has(item.tmdbId));
            console.debug(`[Search] Filtered ${beforeCount - mapped.length} existing items (${mapped.length} remaining)`);
        }

        res.json(mapped);
    } catch (e) {
        console.error('Search failed', e);
        res.status(500).json({ error: 'Search failed' });
    }
});

/**
 * GET /recommendations - AI-powered recommendations with buffer system
 */
router.get('/recommendations', async (req, res) => {
    const { libraryId, type, genre, mood } = req.query;
    const accessToken = req.headers['x-access-token'] as string;
    const userId = req.headers['x-user-id'] as string;
    const userName = req.headers['x-user-name'] as string;
    const jellyfinServerRaw = req.headers['x-jellyfin-url'] as string | undefined;
    const jellyfinServer = jellyfinServerRaw ? sanitizeUrl(jellyfinServerRaw) : undefined;

    if (!accessToken || !userId) {
        return res.status(401).json({ error: 'Unauthorized: Access token or User ID missing' });
    }

    try {
        // Fetch items from library or all libraries
        let items: JellyfinItem[] = [];
        if (libraryId) {
            items = await jellyfinService.getItems(userId, accessToken, libraryId as string, undefined, jellyfinServer);
        } else {
            let libs: any[] = [];
            try {
                libs = (await jellyfinService.getLibraries(accessToken, jellyfinServer)) || [];
            } catch (e) {
                console.warn('Failed to fetch libraries', e);
                libs = [];
            }
            const pools = libs.length ? await Promise.all(libs.map(l => jellyfinService.getItems(userId, accessToken, l.Id, undefined, jellyfinServer))) : [];
            items = (pools || []).flat();
        }

        const userData = await getUserData(userName || userId);
        let history = await jellyfinService.getUserHistory(userId, accessToken, undefined, jellyfinServer);
        if (!Array.isArray(history)) history = [];

        const { extractTmdbIds } = await import('../services/jellyfin-normalizer');
        const historyTmdbIds = extractTmdbIds(history);

        const ownedSet = await jellyfinService.getOwnedIds(userId, accessToken, jellyfinServer);

        // Build exclusion lists
        const watchedTitles = (history || []).map((h: any) => {
            const name = h.Name || h.title || h.name || '';
            const year = h.ProductionYear || (h.PremiereDate ? String(h.PremiereDate).substring(0, 4) : '');
            return year ? `${name} (${year})` : name;
        }).filter(Boolean);

        const watchlistEntries = await getFullWatchlist(userName || userId);
        const watchlistTitles = (watchlistEntries || []).map((w: any) => (w.title || '').trim()).filter(Boolean);

        let blockedTitles: string[] = [];
        if (Array.isArray(userData.blockedIds) && userData.blockedIds.length) {
            try {
                const blockedMedia = await prisma.media.findMany({ where: { tmdbId: { in: userData.blockedIds.map((i: any) => Number(i)).filter(Boolean) } } });
                blockedTitles = blockedMedia.map(m => (m.title || '').trim()).filter(Boolean);
            } catch (e) {
                console.warn('Failed to resolve blockedIds to titles', e);
            }
        }

        const libraryTitles = (items || []).map(it => `${(it as any).Name || (it as any).Title || ''}${(it as any).ProductionYear ? ` (${(it as any).ProductionYear})` : ''}`.trim()).filter(Boolean);
        const allExclusionArray = Array.from(new Set([...watchedTitles, ...watchlistTitles, ...blockedTitles, ...libraryTitles]));

        // Build numeric exclusion set
        const excludedIds = new Set<number>();
        historyTmdbIds.forEach(id => excludedIds.add(id));
        (userData.watchedIds || []).forEach((id: any) => { const n = Number(id); if (Number.isFinite(n)) excludedIds.add(n); });
        (userData.watchlistIds || []).forEach((id: any) => { const n = Number(id); if (Number.isFinite(n)) excludedIds.add(n); });
        (userData.blockedIds || []).forEach((id: any) => { const n = Number(id); if (Number.isFinite(n)) excludedIds.add(n); });

        for (const s of Array.from(ownedSet || [])) {
            if (typeof s === 'string' && s.startsWith('tmdb:')) {
                const num = Number(s.split(':')[1]);
                if (Number.isFinite(num)) excludedIds.add(num);
            }
        }

        const filters = { type: type as string | undefined, genre: genre as string | undefined, mood: req.query.mood as string | undefined };
        const { searchAndEnrich } = await (async () => await import('../services/jellyseerr'))();

        // Buffer-based fetch
        const TARGET_COUNT = 10;
        const MAX_ATTEMPTS = 3;

        const jellyfinToMediaInput = (item: JellyfinItem): MediaItemInput => ({
            tmdbId: item.ProviderIds?.Tmdb ?? item.ProviderIds?.tmdb,
            title: item.Name,
            name: item.Name,
            mediaType: item.Type?.toLowerCase() === 'series' ? 'tv' : 'movie',
            releaseYear: item.ProductionYear ? String(item.ProductionYear) : (item.PremiereDate ? String(item.PremiereDate).substring(0, 4) : undefined),
            voteAverage: item.CommunityRating,
            overview: item.Overview,
        });

        const likedItems: MediaItemInput[] = [
            ...(history || []).map(jellyfinToMediaInput),
            ...(watchlistEntries || []).map(w => ({
                tmdbId: w.tmdbId,
                title: w.title,
                mediaType: w.mediaType,
                releaseYear: w.releaseYear,
                posterUrl: w.posterUrl,
                overview: w.overview,
                voteAverage: w.voteAverage,
            } as MediaItemInput))
        ];
        const dislikedItems: MediaItemInput[] = Array.isArray(userData.blockedIds)
            ? userData.blockedIds.map(id => ({ tmdbId: id } as MediaItemInput))
            : [];

        const cacheKey = `${userName || userId}_${filters.type || 'any'}_${filters.genre || 'any'}_${filters.mood || 'any'}`;
        let buffer = CacheService.get<Enriched[]>('recommendations', cacheKey) || [];

        let attempts = 0;
        while ((buffer.length < TARGET_COUNT) && attempts < MAX_ATTEMPTS) {
            attempts++;
            console.debug(`[Buffer] Attempt ${attempts}/${MAX_ATTEMPTS} — buffer has ${buffer.length}/${TARGET_COUNT}`);

            let tasteProfile = await TasteService.getProfile(userName || userId, (filters.type === 'tv') ? 'tv' : 'movie');
            if (!tasteProfile || tasteProfile.length < 10) {
                TasteService.triggerUpdate(userName || userId, (filters.type === 'tv') ? 'tv' : 'movie', accessToken, userId);
            }

            const exclusionTable = allExclusionArray.map(t => {
                const m = t.match(/\((\d{4})\)$/);
                const year = m ? m[1] : '';
                const title = m ? t.replace(/\s*\(\d{4}\)$/, '') : t;
                return `| ${title.trim()} | ${year} |`;
            }).join('\n');

            let rawRecs: RecommendationCandidate[] = [];
            try {
                rawRecs = await GeminiService.getRecommendations(
                    userName || userId,
                    { ...userData, jellyfin_history: history } as UserData,
                    likedItems,
                    dislikedItems,
                    { type: filters.type, genre: filters.genre, mood: filters.mood },
                    tasteProfile,
                    exclusionTable
                );
            } catch (e) {
                console.error('Gemini batch fetch failed', e);
                rawRecs = [];
            }

            if (!Array.isArray(rawRecs)) rawRecs = [];
            console.log(`[Gemini] Received ${rawRecs.length} raw candidates from AI.`);

            for (const rec of rawRecs) {
                if (buffer.length >= TARGET_COUNT) break;
                try {
                    if (!rec || !rec.title) continue;
                    const recTitle = String(rec.title).trim();
                    if (!recTitle) continue;

                    const enriched = await searchAndEnrich(recTitle, rec.media_type, rec.release_year);
                    if (!enriched) {
                        console.log(`[Filter] DROP: "${recTitle}" (${rec.release_year}) - Verification Failed`);
                        continue;
                    }
                    const tmdb = enriched.tmdb_id ? Number(enriched.tmdb_id) : null;
                    if (!tmdb || !Number.isFinite(tmdb)) continue;

                    if (excludedIds.has(tmdb)) {
                        console.log(`[Filter] DROP: "${recTitle}" (TMDB:${tmdb}) - Already in Library/History`);
                        continue;
                    }
                    if (buffer.find(b => Number(b.tmdb_id) === tmdb)) continue;

                    console.log(`[Filter] ACCEPT: "${recTitle}" (TMDB:${tmdb}, ${rec.release_year})`);
                    buffer.push(enriched);
                    excludedIds.add(tmdb);
                } catch (e) {
                    console.error('Error processing candidate', rec, e);
                }
            }
        }

        const responseItems = buffer.slice(0, TARGET_COUNT);
        const remaining = buffer.slice(TARGET_COUNT);
        CacheService.set('recommendations', cacheKey, remaining);

        TasteService.triggerUpdate(userName || userId, (filters.type === 'tv') ? 'tv' : 'movie', accessToken, userId);

        const validItems = responseItems.map(d => toFrontendItem(d)).filter((x): x is FrontendItem => x !== null && x.tmdbId !== null);
        res.json(validItems);
    } catch (error) {
        // Propagate 401 to frontend for token refresh
        if (error instanceof JellyfinAuthError) {
            return res.status(401).json({ error: error.message, code: 'TOKEN_EXPIRED' });
        }
        console.error('Error generating recommendations:', error);
        res.status(500).json({ error: 'An unexpected error occurred while generating recommendations' });
    }
});

export default router;
