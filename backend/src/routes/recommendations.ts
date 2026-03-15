/**
 * Recommendations routes - AI-powered recommendations and search
 */

import { Router, Request, Response } from 'express';
import { JellyfinService, JellyfinAuthError } from '../jellyfin';
import { JellyfinItem, FrontendItem, MediaItemInput } from '../types';
import { getUserData, getFullWatchlist } from '../services/data';
import prisma from '../services/data';
import { GeminiService } from '../services/gemini';
import { TasteService } from '../services/taste';
import { search as jellySearch, Enriched, getFullDetails } from '../services/jellyseerr';
import { extractTmdbIds } from '../services/jellyfin-normalizer';
import { CacheService } from '../services/cache';
import { sanitizeUrl } from '../utils/ssrf-protection';
import { toFrontendItem } from './route-utils';
import { getAnchorItems, collectCandidateIds, MOOD_KEYWORDS } from '../services/anchor-recommendations';
import { authMiddleware } from '../middleware/auth';
import pLimit from 'p-limit';
import { discoverMovies, discoverTV } from '../services/tmdb-discover';
import { genreNamesToIds, getGenreName } from '../services/tmdb-genres';
import {
    extractYear,
    filterViewCacheByExclusions,
    hasMoodSignal,
    isYearInRange,
    matchesSelectedGenres,
    shouldGenerateWhenViewCacheMiss,
    shouldIncludeTmdbId,
    MIN_FILTER_YEAR,
    MAX_FILTER_YEAR,
} from '../services/recommendations-pipeline';

/**
 * Interleave items so that the same primary genre doesn't appear consecutively.
 * Unlike the weekly-picks hard cap, this keeps ALL items — it just reorders them
 * for visual variety when no genre filter is active.
 */
function interleaveByGenre(items: FrontendItem[]): FrontendItem[] {
    if (items.length <= 2) return items;

    // Group items by primary genre
    const buckets = new Map<string, FrontendItem[]>();
    for (const item of items) {
        const primary = (item.genres && item.genres[0]) || 'Unknown';
        if (!buckets.has(primary)) buckets.set(primary, []);
        buckets.get(primary)!.push(item);
    }

    // Round-robin from largest bucket first
    const sorted = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);
    const result: FrontendItem[] = [];
    let lastGenre = '';

    while (result.length < items.length) {
        let placed = false;
        for (const [genre, bucket] of sorted) {
            if (bucket.length === 0) continue;
            if (genre === lastGenre && sorted.some(([g, b]) => g !== lastGenre && b.length > 0)) continue;
            result.push(bucket.shift()!);
            lastGenre = genre;
            placed = true;
            break;
        }
        // If only one genre remains, just drain it
        if (!placed) {
            for (const [, bucket] of sorted) {
                while (bucket.length > 0) result.push(bucket.shift()!);
            }
        }
    }

    return result;
}

const router = Router();
const jellyfinService = new JellyfinService();

/**
 * GET /search - Search for media via Jellyseerr
 * Identity sourced exclusively from req.user (set by authMiddleware).
 */
router.get('/search', authMiddleware, async (req, res) => {
    try {
        const q = req.query.query as string | undefined;
        // Identity comes from the verified token, not from client-supplied headers.
        const userName = req.user?.username;

        if (!q) return res.status(400).json({ error: 'Missing query parameter' });

        const results = await jellySearch(q);
        let mapped = (results || []).map(r => toFrontendItem(r)).filter((x): x is FrontendItem => x !== null && x.tmdbId !== null);

        // Filter out items already tracked by this user
        if (userName) {
            const userData = await getUserData(userName);
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
 * Identity sourced exclusively from req.user (set by authMiddleware).
 */
router.get('/recommendations', authMiddleware, async (req, res) => {
    const { libraryId, type, genre, mood, yearFrom, yearTo } = req.query;
    // x-access-token is still read for Jellyfin API calls (it IS the bearer credential).
    // Identity (username, Jellyfin user ID) comes from req.user — verified by authMiddleware.
    const accessToken = req.headers['x-access-token'] as string;
    const jellyfinServerRaw = req.headers['x-jellyfin-url'] as string | undefined;
    const jellyfinServer = jellyfinServerRaw ? sanitizeUrl(jellyfinServerRaw) : undefined;

    if (!accessToken || !req.user) {
        return res.status(401).json({ error: 'Unauthorized: Valid authentication required' });
    }

    // Derive identity from the verified token — never from client-supplied headers.
    const userId = req.user.jellyfinUserId ?? String(req.user.id);
    const userName = req.user.username;

    try {
        // Prevent browser caching for recommendations to ensure refresh works
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const rawYearFrom = Number(yearFrom);
        const rawYearTo = Number(yearTo);
        const hasYearFrom = Number.isFinite(rawYearFrom);
        const hasYearTo = Number.isFinite(rawYearTo);
        let selectedYearFrom = hasYearFrom ? Math.max(MIN_FILTER_YEAR, Math.min(MAX_FILTER_YEAR, rawYearFrom)) : undefined;
        let selectedYearTo = hasYearTo ? Math.max(MIN_FILTER_YEAR, Math.min(MAX_FILTER_YEAR, rawYearTo)) : undefined;
        if (selectedYearFrom !== undefined && selectedYearTo !== undefined && selectedYearFrom > selectedYearTo) {
            [selectedYearFrom, selectedYearTo] = [selectedYearTo, selectedYearFrom];
        }

        console.log(`[Recommendations] Request: type=${type} genre=${genre} mood=${mood} yearFrom=${selectedYearFrom ?? 'any'} yearTo=${selectedYearTo ?? 'any'} refresh=${req.query.refresh}`);

        // Fetch items from library or all libraries
        // NOTE: These Jellyfin API calls are optional - recommendations can work without them
        // using locally cached anchor items from the database
        let items: JellyfinItem[] = [];
        let history: any[] = [];
        let ownedSet: Set<string> = new Set();
        let jellyfinAvailable = true;

        // Try to fetch from Jellyfin, but don't fail if unavailable
        try {
            if (libraryId) {
                items = await jellyfinService.getItems(userId, accessToken, libraryId as string, undefined, jellyfinServer);
            } else {
                let libs: any[] = [];
                try {
                    libs = (await jellyfinService.getLibraries(accessToken, jellyfinServer)) || [];
                } catch (e) {
                    console.warn('Failed to fetch libraries (Jellyfin may be unreachable)', e);
                    libs = [];
                }
                const pools = libs.length ? await Promise.all(libs.map(l => jellyfinService.getItems(userId, accessToken, l.Id, undefined, jellyfinServer))) : [];
                items = (pools || []).flat();
            }
        } catch (e) {
            console.warn('[Recommendations] Jellyfin items fetch failed, using local data only:', e instanceof Error ? e.message : e);
            jellyfinAvailable = false;
        }

        const userData = await getUserData(userName || userId);

        // Try to fetch history from Jellyfin, but continue if it fails
        try {
            history = await jellyfinService.getUserHistory(userId, accessToken, undefined, jellyfinServer);
            if (!Array.isArray(history)) history = [];
        } catch (e) {
            console.warn('[Recommendations] Jellyfin history fetch failed, using local anchor data:', e instanceof Error ? e.message : e);
            history = [];
            jellyfinAvailable = false;
        }

        const historyTmdbIds = extractTmdbIds(history);

        // Try to get owned IDs, but continue if it fails
        try {
            ownedSet = await jellyfinService.getOwnedIds(userId, accessToken, jellyfinServer);
        } catch (e) {
            console.warn('[Recommendations] Jellyfin owned IDs fetch failed:', e instanceof Error ? e.message : e);
            ownedSet = new Set();
        }

        // Build exclusion lists
        const watchedTitles = (history || []).map((h: any) => {
            const name = h.Name || h.title || h.name || '';
            const year = h.ProductionYear || (h.PremiereDate ? String(h.PremiereDate).substring(0, 4) : '');
            return year ? `${name} (${year})` : name;
        }).filter(Boolean);

        const watchlistEntries = await getFullWatchlist(userName || userId);
        const watchlistTitles = (watchlistEntries || []).map((w: any) => (w.title || '').trim()).filter(Boolean);

        let blockedTitles: string[] = [];
        let blockedItems: Array<{ title: string; genres: string[] }> = [];
        if (Array.isArray(userData.blockedIds) && userData.blockedIds.length) {
            try {
                const blockedMedia = await prisma.media.findMany({
                    where: { tmdbId: { in: userData.blockedIds.map((i: any) => Number(i)).filter(Boolean) } },
                    select: { title: true, genres: true },
                });
                blockedTitles = blockedMedia.map(m => (m.title || '').trim()).filter(Boolean);
                blockedItems = blockedMedia.map(m => ({
                    title: (m.title || '').trim(),
                    genres: m.genres ? JSON.parse(m.genres) as string[] : [],
                })).filter(b => b.title);
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

        const filters = {
            type: type as string | undefined,
            genre: genre as string | undefined,
            mood: req.query.mood as string | undefined,
            yearFrom: selectedYearFrom,
            yearTo: selectedYearTo,
        };

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

        const cacheKey = `${userName || userId}_${filters.type || 'any'}_${filters.genre || 'any'}_${filters.mood || 'any'}_${filters.yearFrom || 'any'}_${filters.yearTo || 'any'}`;
        const viewCacheKey = `view_recs_${cacheKey}`;
        // Ensure strictly boolean check on string 'true'
        const forceRefresh = String(req.query.refresh).toLowerCase() === 'true';

        console.log(`[Recommendations] User=${userName} Refresh=${forceRefresh} CacheKey=${cacheKey}`);

        // Define buffer variable early so it can be cleared if forceRefresh is true
        let buffer: any[] = []; // Type will be properly assigned when fetching from cache or generating

        // --- VIEW CACHE LOGIC ---
        // If not forcing refresh, try to load from view cache first
        if (!forceRefresh) {
            const viewCached = CacheService.get<FrontendItem[]>('recommendations', viewCacheKey);
            const preFilterCount = Array.isArray(viewCached) ? viewCached.length : 0;
            const filteredViewCache = filterViewCacheByExclusions(viewCached, excludedIds);
            const shouldGenerate = shouldGenerateWhenViewCacheMiss(forceRefresh, filteredViewCache.length);

            if (preFilterCount > 0) {
                console.log(`[ViewCache] Serving ${filteredViewCache.length} items (filtered ${preFilterCount - filteredViewCache.length} acted-upon items)`);
            } else {
                // No cache exists - DO NOT auto-generate
                // Return empty array; user must click "Get Recommendations" to start generation
                console.log('[ViewCache] No view cache found - returning empty (user must click button to generate)');
            }

            if (!shouldGenerate) {
                if (filteredViewCache.length > 0) {
                    // Update cache with clean list to keep it fresh
                    CacheService.set('recommendations', viewCacheKey, filteredViewCache, 60 * 60 * 24); // 24h retention for view
                    return res.json(filteredViewCache);
                }
                // Cache is empty after filtering - DO NOT auto-generate
                // User must explicitly click "Get Recommendations" to fetch new items
                if (preFilterCount > 0) {
                    console.log('[ViewCache] Cache empty after filtering - returning empty (user must click button to generate)');
                }
                return res.json([]);
            }
        } else {
            console.log('[ViewCache] Force refresh requested - bypassing view cache');
            // Clear BOTH view cache AND the generation buffer to ensure we actually fetch new data
            CacheService.del('recommendations', viewCacheKey);
            CacheService.del('recommendations', cacheKey);
            buffer = []; // Ensure local buffer is empty too
        }

        // ... generation logic ...
        // Only fetch from cache if we didn't just clear it (or if we want to support partial implementation where clear happened async, but here sync)
        if (!forceRefresh) {
            buffer = CacheService.get<Enriched[]>('recommendations', cacheKey) || [];
        } else {
            // Already cleared and set to []
        }

        // --- ANCHOR-BASED CANDIDATE PRE-FETCH ---
        // Try to get candidates from user's enriched history first
        const mediaTypeFilter = filters.type === 'tv' ? 'tv' : filters.type === 'movie' ? 'movie' : undefined;
        const genreFilters = (filters.genre || '')
            .split(',')
            .map(g => g.trim())
            .filter(Boolean);
        const genreFilter = genreFilters.length > 0 ? genreFilters : undefined;
        const moodFilter = filters.mood || undefined;
        const anchors = await getAnchorItems(userName || userId, mediaTypeFilter, genreFilter, moodFilter, 10);

        if (anchors.length > 0 && buffer.length < TARGET_COUNT) {
            const anchorGenres = anchors.flatMap(a => a.genres).slice(0, 3);
            console.debug(`[Anchor] Found ${anchors.length} anchor items for ${userName || userId} (genres: ${anchorGenres.join(', ') || 'any'})`);
            const candidateIds = collectCandidateIds(anchors, excludedIds);
            console.debug(`[Anchor] Collected ${candidateIds.length} candidate IDs from anchors`);

            // Fetch details for candidates with bounded concurrency
            const candidateType: 'movie' | 'tv' = filters.type === 'tv' ? 'tv' : 'movie';
            const MAX_CANDIDATES_FOR_RANKING = 40;
            const MAX_CANDIDATE_FETCH = 80;
            const DETAIL_FETCH_CONCURRENCY = 8;

            // Phase 1: Collect all matching candidates with their details
            const candidatesForRanking: Array<{
                tmdbId: number;
                title: string;
                genres: string[];
                overview?: string;
                voteAverage?: number;
            }> = [];

            const candidateIdsToFetch = candidateIds.slice(0, MAX_CANDIDATE_FETCH);
            const limit = pLimit(DETAIL_FETCH_CONCURRENCY);

            const fetchedCandidates = await Promise.all(
                candidateIdsToFetch.map(tmdbId =>
                    limit(async () => {
                        // Check if already in any exclusion list BEFORE fetching details
                        if (excludedIds.has(tmdbId)) {
                            console.debug(`[Anchor] SKIP: "${tmdbId}" - already in exclusion list`);
                            return null;
                        }

                        try {
                            // getFullDetails now returns all basic Enriched fields (title, overview,
                            // voteAverage, posterUrl, etc.) from the same API call — no separate
                            // getMediaDetails() needed, halving Jellyseerr requests per candidate.
                            const fullDetails = await getFullDetails(tmdbId, candidateType);
                            if (!fullDetails) return null;

                            if (!isYearInRange(fullDetails.releaseDate, filters.yearFrom, filters.yearTo)) {
                                const releaseYear = extractYear(fullDetails.releaseDate);
                                console.debug(`[Anchor] SKIP: "${tmdbId}" - year ${releaseYear ?? 'unknown'} outside range ${filters.yearFrom ?? 'any'}-${filters.yearTo ?? 'any'}`);
                                return null;
                            }

                    // Filter by genre if specified
                    if (genreFilter && genreFilter.length > 0) {
                        const hasMatchingGenre = matchesSelectedGenres(fullDetails.genres, genreFilter);
                        if (!hasMatchingGenre) {
                            console.debug(`[Anchor] SKIP: "${tmdbId}" - genres [${fullDetails.genres.join(', ')}] don't match any of "${genreFilter.join(', ')}"`);
                            return null;
                        }
                    }

                            let moodMatched: boolean | null = null;
                            if (moodFilter && MOOD_KEYWORDS[moodFilter]) {
                                const moodKeywords = MOOD_KEYWORDS[moodFilter];
                                moodMatched = hasMoodSignal(fullDetails.keywords || [], fullDetails.overview, moodKeywords);
                            }

                            return {
                                tmdbId: fullDetails.tmdb_id,
                                title: fullDetails.title,
                                genres: fullDetails.genres,
                                overview: fullDetails.overview,
                                voteAverage: fullDetails.voteAverage,
                                moodMatched,
                            };
                        } catch {
                            // Skip failed fetches
                            return null;
                        }
                    })
                )
            );

            for (const candidate of fetchedCandidates) {
                if (!candidate) continue;
                if (candidatesForRanking.length >= MAX_CANDIDATES_FOR_RANKING) break;

                if (moodFilter && MOOD_KEYWORDS[moodFilter]) {
                    if (!candidate.moodMatched && candidatesForRanking.length >= 10) {
                        console.debug(`[Anchor] MOOD SKIP: "${candidate.title}" - no keywords match mood "${moodFilter}"`);
                        continue;
                    }
                    if (candidate.moodMatched) {
                        console.debug(`[Anchor] MOOD MATCH: "${candidate.title}" matches mood "${moodFilter}"`);
                    }
                }

                candidatesForRanking.push({
                    tmdbId: candidate.tmdbId,
                    title: candidate.title,
                    genres: candidate.genres,
                    overview: candidate.overview,
                    voteAverage: candidate.voteAverage,
                });
                console.debug(`[Anchor] CANDIDATE: "${candidate.title}" [${candidate.genres.slice(0, 2).join(', ')}] ⭐${candidate.voteAverage?.toFixed(1) || 'N/A'}`);
            }

            console.debug(`[Anchor] Collected ${candidatesForRanking.length} candidates for Gemini ranking`);

            // Phase 2: Send to Gemini for quality ranking
            if (candidatesForRanking.length > 0) {
                let tasteProfile = await TasteService.getProfile(userName || userId, candidateType);
                const recentFavorites = anchors.slice(0, 3).map(a => a.title);

                const rankedCandidates = await GeminiService.rankCandidates(
                    candidatesForRanking,
                    {
                        tasteProfile: tasteProfile || undefined,
                        recentFavorites,
                        requestedGenre: genreFilter?.join(', '),
                        requestedMood: filters.mood,
                        blockedItems: blockedItems.length > 0 ? blockedItems : undefined,
                    },
                    TARGET_COUNT - buffer.length
                );

                console.debug(`[Gemini Ranking] Mood="${filters.mood || 'none'}" Genre="${genreFilter?.join(', ') || 'none'}" - Approved ${rankedCandidates.length} items`);

                // Phase 3: Add Gemini-approved items to buffer
                for (const ranked of rankedCandidates) {
                    if (buffer.length >= TARGET_COUNT) break;
                    const candidate = candidatesForRanking.find(c => c.tmdbId === ranked.tmdbId);
                    if (!candidate) continue;

                    // getFullDetails is already cached from Phase 1 — no new network call
                    const fullDetails = await getFullDetails(ranked.tmdbId, candidateType);
                    if (fullDetails && fullDetails.tmdb_id && !buffer.find(b => Number(b.tmdb_id) === ranked.tmdbId)) {
                        buffer.push(fullDetails);
                        excludedIds.add(ranked.tmdbId);
                        console.log(`[Anchor+Gemini] ACCEPT: "${ranked.title}" - ${ranked.reason}`);
                    }
                }
            }

            console.debug(`[Anchor] Buffer now has ${buffer.length}/${TARGET_COUNT} items`);
        }
        // --- END ANCHOR-BASED PRE-FETCH ---

        let attempts = 0;
        while ((buffer.length < TARGET_COUNT) && attempts < MAX_ATTEMPTS) {
            attempts++;
            console.debug(`[Buffer] Attempt ${attempts}/${MAX_ATTEMPTS} — buffer has ${buffer.length}/${TARGET_COUNT}`);

            const candidateType: 'movie' | 'tv' = filters.type === 'tv' ? 'tv' : 'movie';
            let tasteProfile = await TasteService.getProfile(userName || userId, candidateType);
            if (!tasteProfile || tasteProfile.length < 10) {
                TasteService.triggerUpdate(userName || userId, candidateType, accessToken, userId);
            }

            const candidatePool = new Map<number, {
                tmdbId: number;
                title: string;
                genres: string[];
                overview?: string;
                voteAverage?: number;
            }>();

            const addCandidate = (candidate: {
                tmdbId: number;
                title: string;
                genres: string[];
                overview?: string;
                voteAverage?: number;
                releaseDate?: string;
            }) => {
                if (!candidate.tmdbId || !Number.isFinite(candidate.tmdbId)) return;
                if (!candidate.title || !candidate.title.trim()) return;
                if (!isYearInRange(candidate.releaseDate, filters.yearFrom, filters.yearTo)) return;
                const existingIds = new Set<number>([
                    ...Array.from(candidatePool.keys()),
                    ...buffer.map(b => Number(b.tmdb_id)).filter(n => Number.isFinite(n)),
                ]);
                if (!shouldIncludeTmdbId(candidate.tmdbId, excludedIds, existingIds)) return;
                if (!candidatePool.has(candidate.tmdbId)) candidatePool.set(candidate.tmdbId, candidate);
            };

            // Candidate source 1: Expanded anchor graph (candidate-first, no title generation)
            try {
                const fillAnchors = await getAnchorItems(userName || userId, candidateType, genreFilter, moodFilter, 15);
                const fillAnchorIds = collectCandidateIds(fillAnchors, excludedIds).slice(0, 100);
                const detailLimit = pLimit(8);
                await Promise.all(fillAnchorIds.map(tmdbId =>
                    detailLimit(async () => {
                        try {
                            const fullDetails = await getFullDetails(tmdbId, candidateType);
                            if (!fullDetails || !fullDetails.tmdb_id || excludedIds.has(fullDetails.tmdb_id)) return;
                            addCandidate({
                                tmdbId: fullDetails.tmdb_id,
                                title: fullDetails.title,
                                genres: fullDetails.genres || [],
                                overview: fullDetails.overview,
                                voteAverage: fullDetails.voteAverage,
                                releaseDate: fullDetails.releaseDate,
                            });
                        } catch {
                            // Ignore fetch failures here
                        }
                    })
                ));
            } catch (e) {
                console.warn('[Fill] Anchor candidate pool collection failed:', e instanceof Error ? e.message : e);
            }

            // Candidate source 2: TMDB Discover pool
            try {
                const discoverGenreIds = genreFilter && genreFilter.length > 0
                    ? genreNamesToIds(genreFilter, candidateType)
                    : [];
                const discoverVoteMin = attempts === 1 ? 7.0 : attempts === 2 ? 6.5 : 6.0;
                const discoverVoteCountMin = attempts === 1 ? 250 : attempts === 2 ? 100 : 50;
                const discoverPages = attempts === 1 ? 2 : attempts === 2 ? 3 : 4;

                if (candidateType === 'movie') {
                    const discovered = await discoverMovies({
                        with_genres: discoverGenreIds.length ? discoverGenreIds.join('|') : undefined,
                        primary_release_date_gte: filters.yearFrom ? `${filters.yearFrom}-01-01` : undefined,
                        primary_release_date_lte: filters.yearTo ? `${filters.yearTo}-12-31` : undefined,
                        vote_average_gte: discoverVoteMin,
                        vote_count_gte: discoverVoteCountMin,
                        sort_by: attempts === 1 ? 'vote_average.desc' : 'popularity.desc',
                    }, discoverPages);

                    for (const item of discovered) {
                        addCandidate({
                            tmdbId: item.id,
                            title: item.title || item.original_title || '',
                            genres: (item.genre_ids || []).map(id => getGenreName(id, 'movie')).filter((g): g is string => !!g),
                            overview: item.overview || undefined,
                            voteAverage: item.vote_average,
                            releaseDate: item.release_date,
                        });
                    }
                } else {
                    const discovered = await discoverTV({
                        with_genres: discoverGenreIds.length ? discoverGenreIds.join('|') : undefined,
                        first_air_date_gte: filters.yearFrom ? `${filters.yearFrom}-01-01` : undefined,
                        first_air_date_lte: filters.yearTo ? `${filters.yearTo}-12-31` : undefined,
                        vote_average_gte: discoverVoteMin,
                        vote_count_gte: discoverVoteCountMin,
                        sort_by: attempts === 1 ? 'vote_average.desc' : 'popularity.desc',
                    }, discoverPages);

                    for (const item of discovered) {
                        addCandidate({
                            tmdbId: item.id,
                            title: item.name || item.original_name || '',
                            genres: (item.genre_ids || []).map(id => getGenreName(id, 'tv')).filter((g): g is string => !!g),
                            overview: item.overview || undefined,
                            voteAverage: item.vote_average,
                            releaseDate: item.first_air_date,
                        });
                    }
                }
            } catch (e) {
                console.warn('[Fill] TMDB discover candidate pool collection failed:', e instanceof Error ? e.message : e);
            }

            const candidatesForRanking = Array.from(candidatePool.values());
            console.debug(`[Fill] Candidate pool has ${candidatesForRanking.length} items before AI ranking`);
            if (candidatesForRanking.length === 0) continue;

            const rankedCandidates = await GeminiService.rankCandidates(
                candidatesForRanking,
                {
                    tasteProfile: tasteProfile || undefined,
                    recentFavorites: likedItems.slice(0, 5).map(i => i.title || i.name || '').filter(Boolean),
                    requestedGenre: genreFilter?.join(', '),
                    requestedMood: filters.mood,
                    requestedYearRange: (filters.yearFrom || filters.yearTo) ? `${filters.yearFrom ?? 'any'}-${filters.yearTo ?? 'any'}` : undefined,
                    blockedItems: blockedItems.length > 0 ? blockedItems : undefined,
                },
                TARGET_COUNT - buffer.length
            );

            for (const ranked of rankedCandidates) {
                if (buffer.length >= TARGET_COUNT) break;
                try {
                    const details = await getFullDetails(ranked.tmdbId, candidateType);
                    if (!details || !details.tmdb_id) continue;
                    if (excludedIds.has(details.tmdb_id)) continue;
                    if (buffer.find(b => Number(b.tmdb_id) === details.tmdb_id)) continue;

                    buffer.push(details);
                    excludedIds.add(details.tmdb_id);
                    console.log(`[Fill+Gemini] ACCEPT: "${ranked.title}" - ${ranked.reason || 'candidate-first rank'}`);
                } catch {
                    // Skip details failures
                }
            }
        }

        // --- END GENERATION ---

        const responseItems = buffer.slice(0, TARGET_COUNT);
        const remaining = buffer.slice(TARGET_COUNT);

        // Update the generation buffer
        CacheService.set('recommendations', cacheKey, remaining);

        TasteService.triggerUpdate(userName || userId, (filters.type === 'tv') ? 'tv' : 'movie', accessToken, userId);

        let validItems = responseItems.map(d => toFrontendItem(d)).filter((x): x is FrontendItem => x !== null && x.tmdbId !== null);

        // When no genre filter is active, interleave results by genre for visual variety
        if (!genreFilter) {
            validItems = interleaveByGenre(validItems);
        }

        // Store the result in the VIEW cache
        console.log(`[ViewCache] Storing ${validItems.length} new items`);
        CacheService.set('recommendations', viewCacheKey, validItems, 60 * 60 * 24); // 24h retention

        console.log(`[Recommendations] Returning ${validItems.length} items (force-fresh: ${forceRefresh})`);
        // Remove ETag to prevent 304 Not Modified, ensuring the client always processes the new response
        res.removeHeader('ETag');

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
