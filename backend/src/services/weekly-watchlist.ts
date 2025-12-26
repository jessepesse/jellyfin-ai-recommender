/**
 * Weekly Watchlist Service
 * Generates pre-computed personalized recommendations using:
 * 1. Gemini analyzes user's watch history
 * 2. Backend converts to TMDB Discover parameters
 * 3. TMDB Discover API returns candidates
 * 4. Gemini ranks and selects top 10
 */

import prisma from '../db';
import { GeminiService } from './gemini';
import { genreNamesToIds } from './tmdb-genres';
import { discoverMovies, discoverTV, keywordNamesToIds, TMDBMovie, TMDBTV } from './tmdb-discover';

interface WatchlistItem {
    tmdbId: number;
    title: string;
    posterUrl: string | null;
    overview: string;
}

interface GenerationResult {
    movies: WatchlistItem[];
    tvShows: WatchlistItem[];
    tasteProfile: string;
    weekStart: Date;
    weekEnd: Date;
    generatedAt: Date;
}

/**
 * Get the start of the current week (Monday 00:00)
 */
function getWeekStart(): Date {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    const monday = new Date(now.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
}

/**
 * Get the end of the current week (Sunday 23:59)
 */
function getWeekEnd(): Date {
    const weekStart = getWeekStart();
    const sunday = new Date(weekStart);
    sunday.setDate(sunday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return sunday;
}

export class WeeklyWatchlistService {

    /**
     * Get user's current weekly watchlist
     * Auto-regenerates if older than 7 days
     */
    static async getForUser(userId: number): Promise<{
        id: number;
        movies: WatchlistItem[];
        tvShows: WatchlistItem[];
        tasteProfile: string;
        generatedAt: Date;
        weekStart: Date;
        weekEnd: Date;
    } | null> {
        const now = new Date();

        // Try to get most recent watchlist
        const watchlist = await prisma.weeklyWatchlist.findFirst({
            where: { userId },
            orderBy: { generatedAt: 'desc' }
        });

        if (!watchlist) {
            console.log(`[Weekly Watchlist] No existing watchlist for user ${userId}, generating new one`);
            await this.generateForUser(userId);
            // Fetch the newly generated watchlist
            const newWatchlist = await prisma.weeklyWatchlist.findFirst({
                where: { userId },
                orderBy: { generatedAt: 'desc' }
            });
            if (!newWatchlist) return null;

            return {
                id: newWatchlist.id,
                movies: JSON.parse(newWatchlist.movies),
                tvShows: JSON.parse(newWatchlist.tvShows),
                tasteProfile: newWatchlist.tasteProfile,
                generatedAt: newWatchlist.generatedAt,
                weekStart: newWatchlist.weekStart,
                weekEnd: newWatchlist.weekEnd,
            };
        }

        // Check if watchlist is older than 7 days
        const daysSinceGeneration = (now.getTime() - watchlist.generatedAt.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceGeneration >= 7) {
            console.log(`[Weekly Watchlist] Watchlist for user ${userId} is ${daysSinceGeneration.toFixed(1)} days old, regenerating...`);
            await this.generateForUser(userId);
            // Fetch the newly generated watchlist
            const newWatchlist = await prisma.weeklyWatchlist.findFirst({
                where: { userId },
                orderBy: { generatedAt: 'desc' }
            });
            if (!newWatchlist) return null;

            return {
                id: newWatchlist.id,
                movies: JSON.parse(newWatchlist.movies),
                tvShows: JSON.parse(newWatchlist.tvShows),
                tasteProfile: newWatchlist.tasteProfile,
                generatedAt: newWatchlist.generatedAt,
                weekStart: newWatchlist.weekStart,
                weekEnd: newWatchlist.weekEnd,
            };
        }

        console.log(`[Weekly Watchlist] Found existing watchlist for user ${userId} (${daysSinceGeneration.toFixed(1)} days old)`);
        return {
            id: watchlist.id,
            movies: JSON.parse(watchlist.movies),
            tvShows: JSON.parse(watchlist.tvShows),
            tasteProfile: watchlist.tasteProfile,
            generatedAt: watchlist.generatedAt,
            weekStart: watchlist.weekStart,
            weekEnd: watchlist.weekEnd,
        };
    }

    /**
     * Generate weekly watchlist for a specific user
     */
    static async generateForUser(userId: number): Promise<GenerationResult> {
        console.log(`[Weekly Watchlist] Generating for user ${userId}`);

        // 1. Get user's complete watch history
        // 0. Get global exclusion list (Watched + Watchlist + Blocked)
        const allUserMedia = await prisma.userMedia.findMany({
            where: { userId },
            select: { media: { select: { tmdbId: true } } }
        });
        const excludedTmdbIds = new Set(allUserMedia.map(um => um.media.tmdbId));

        // 1. Get user's watch history + watchlist for taste analysis
        // Fetch all enriched items, sample SEPARATELY for movies and TV
        const allUserMediaForTaste = await prisma.userMedia.findMany({
            where: {
                userId,
                status: { in: ['WATCHED', 'WATCHLIST'] },
                media: { enrichedAt: { not: null } }
            },
            include: { media: true },
        });

        // Separate and shuffle movies and TV independently
        const allMovies = allUserMediaForTaste.filter(um => um.media.mediaType === 'movie');
        const allTV = allUserMediaForTaste.filter(um => um.media.mediaType === 'tv');

        // Fisher-Yates shuffle helper
        const shuffle = <T>(arr: T[]): T[] => {
            const result = [...arr];
            for (let i = result.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [result[i], result[j]] = [result[j], result[i]];
            }
            return result;
        };

        // Sample 50 movies and 50 TV shows
        const sampledMovies = shuffle(allMovies).slice(0, 50);
        const sampledTV = shuffle(allTV).slice(0, 50);

        console.log(`[Weekly Watchlist] Sampled ${sampledMovies.length}/${allMovies.length} movies, ${sampledTV.length}/${allTV.length} TV for taste analysis`);

        // Convert to taste analysis format
        const watchedMovies = sampledMovies.map(um => ({
            title: um.media.title,
            genres: um.media.genres ? JSON.parse(um.media.genres) : [],
            year: um.media.releaseYear ? parseInt(um.media.releaseYear) : undefined,
            rating: um.media.voteAverage ?? undefined,
        }));

        const watchedTV = sampledTV.map(um => ({
            title: um.media.title,
            genres: um.media.genres ? JSON.parse(um.media.genres) : [],
            year: um.media.releaseYear ? parseInt(um.media.releaseYear) : undefined,
            rating: um.media.voteAverage ?? undefined,
        }));

        // 2. Analyze taste with Gemini
        const movieTaste = await GeminiService.analyzeUserTaste(watchedMovies, 'movie');
        const tvTaste = await GeminiService.analyzeUserTaste(watchedTV, 'tv');

        console.log(`[Weekly Watchlist] Movie taste: ${movieTaste.genres.join(', ')}`);
        console.log(`[Weekly Watchlist] TV taste: ${tvTaste.genres.join(', ')}`);

        // 3. Build TMDB Discover parameters and fetch candidates
        let movieCandidates = await this.fetchCandidates(movieTaste, 'movie', excludedTmdbIds);
        let tvCandidates = await this.fetchCandidates(tvTaste, 'tv', excludedTmdbIds);

        // 3b. Filter out items already requested in Jellyseerr (status 2/3/5)
        const { filterByJellyseerrStatus } = await import('./jellyseerr-status');
        const movieCandidatesBeforeJellyseerr = movieCandidates.length;
        const tvCandidatesBeforeJellyseerr = tvCandidates.length;

        movieCandidates = await filterByJellyseerrStatus(movieCandidates, 'movie');
        tvCandidates = await filterByJellyseerrStatus(tvCandidates, 'tv');

        console.log(`[Weekly Watchlist] Jellyseerr filter: ${movieCandidatesBeforeJellyseerr} → ${movieCandidates.length} movies, ${tvCandidatesBeforeJellyseerr} → ${tvCandidates.length} TV`);

        // Get blocklist for Critic agent
        const blockedMedia = await prisma.userMedia.findMany({
            where: { userId, status: 'BLOCKED' },
            include: { media: { select: { tmdbId: true } } }
        });
        const blocklist = blockedMedia.map(bm => bm.media.tmdbId);
        console.log(`[Weekly Watchlist] Blocklist size: ${blocklist.length}`);

        // ==========================================
        // DUAL-AI SYSTEM: CURATOR → CRITIC
        // ==========================================

        // 4a. Format candidates for Curator (with genres)
        const movieCuratorInput = (movieCandidates as TMDBMovie[]).map((m: TMDBMovie) => ({
            tmdbId: m.id,
            title: m.title,
            overview: m.overview,
            genres: m.genre_ids?.map((id: number) => String(id)) || [],
            voteAverage: m.vote_average,
        }));

        const tvCuratorInput = (tvCandidates as TMDBTV[]).map((t: TMDBTV) => ({
            tmdbId: t.id,
            title: t.name,
            overview: t.overview,
            genres: t.genre_ids?.map((id: number) => String(id)) || [],
            voteAverage: t.vote_average,
        }));

        // 4b. CURATOR: Discovery agent selects TOP 30 candidates with reasons
        console.log(`[Weekly Watchlist] 🎬 Curator analyzing ${movieCuratorInput.length} movies...`);
        const curatorMovies = await GeminiService.curatorDiscover(
            movieCuratorInput,
            { tasteProfile: movieTaste.tasteProfile, genres: movieTaste.genres, keywords: movieTaste.keywords },
            30  // Select top 30, Critic will pick final 10
        );

        console.log(`[Weekly Watchlist] 📺 Curator analyzing ${tvCuratorInput.length} TV shows...`);
        const curatorTV = await GeminiService.curatorDiscover(
            tvCuratorInput,
            { tasteProfile: tvTaste.tasteProfile, genres: tvTaste.genres, keywords: tvTaste.keywords },
            30  // Select top 30, Critic will pick final 10
        );

        console.log(`[Weekly Watchlist] Curator selected: ${curatorMovies.length} movies, ${curatorTV.length} TV shows`);

        // 4c. CRITIC: Quality guardian selects TOP 10
        console.log(`[Weekly Watchlist] 🎯 Critic reviewing movies...`);
        const rankedMovies = await GeminiService.criticSelect(curatorMovies, blocklist, 10);

        console.log(`[Weekly Watchlist] 🎯 Critic reviewing TV shows...`);
        const rankedTV = await GeminiService.criticSelect(curatorTV, blocklist, 10);

        console.log(`[Weekly Watchlist] Critic approved: ${rankedMovies.length} movies, ${rankedTV.length} TV shows`);

        // 5. Build final lists with full details
        // 5. Build final lists with full details
        const movies: WatchlistItem[] = rankedMovies.slice(0, 10).map((r: { tmdbId: number; title: string }) => {
            let candidate = (movieCandidates as TMDBMovie[]).find((c: TMDBMovie) => c.id === Number(r.tmdbId));

            if (!candidate) {
                // Fallback: Try fuzzy title match
                candidate = (movieCandidates as TMDBMovie[]).find((c: TMDBMovie) =>
                    c.title.toLowerCase() === r.title.toLowerCase() ||
                    c.original_title.toLowerCase() === r.title.toLowerCase()
                );

                if (candidate) {
                    console.log(`[Weekly Watchlist] Recovered movie "${r.title}" via title match (ID: ${candidate.id})`);
                } else {
                    console.warn(`[Weekly Watchlist] Movie candidate not found for ID: ${r.tmdbId} Title: ${r.title}`);
                }
            }

            return {
                tmdbId: candidate?.id || Number(r.tmdbId),
                title: candidate?.title || r.title,
                posterUrl: candidate?.poster_path ? `https://image.tmdb.org/t/p/w500${candidate.poster_path}` : null,
                overview: candidate?.overview || '',
                voteAverage: candidate?.vote_average || 0,
                releaseDate: candidate?.release_date || null,
            };
        });

        const tvShows: WatchlistItem[] = rankedTV.slice(0, 10).map((r: { tmdbId: number; title: string }) => {
            let candidate = (tvCandidates as TMDBTV[]).find((c: TMDBTV) => c.id === Number(r.tmdbId));

            if (!candidate) {
                // Fallback: Try fuzzy title match
                candidate = (tvCandidates as TMDBTV[]).find((c: TMDBTV) =>
                    c.name.toLowerCase() === r.title.toLowerCase() ||
                    c.original_name.toLowerCase() === r.title.toLowerCase()
                );

                if (candidate) {
                    console.log(`[Weekly Watchlist] Recovered TV show "${r.title}" via title match (ID: ${candidate.id})`);
                } else {
                    console.warn(`[Weekly Watchlist] TV candidate not found for ID: ${r.tmdbId} Title: ${r.title}`);
                }
            }

            return {
                tmdbId: candidate?.id || Number(r.tmdbId),
                title: candidate?.name || r.title,
                posterUrl: candidate?.poster_path ? `https://image.tmdb.org/t/p/w500${candidate.poster_path}` : null,
                overview: candidate?.overview || '',
                voteAverage: candidate?.vote_average || 0,
                releaseDate: candidate?.first_air_date || null,
            };
        });

        // 6. Save to database
        const weekStart = getWeekStart();
        const weekEnd = getWeekEnd();
        const tasteProfile = movieTaste.tasteProfile; // Use movie taste for main profile

        await prisma.weeklyWatchlist.upsert({
            where: { userId_weekStart: { userId, weekStart } },
            update: {
                movies: JSON.stringify(movies),
                tvShows: JSON.stringify(tvShows),
                tasteProfile,
                generatedAt: new Date(),
                weekEnd,
            },
            create: {
                userId,
                movies: JSON.stringify(movies),
                tvShows: JSON.stringify(tvShows),
                tasteProfile,
                weekStart,
                weekEnd,
            },
        });

        console.log(`[Weekly Watchlist] Generated ${movies.length} movies, ${tvShows.length} TV shows for user ${userId}`);

        return {
            movies,
            tvShows,
            tasteProfile,
            weekStart,
            weekEnd,
            generatedAt: new Date()
        };
    }

    /**
     * Fetch candidates from TMDB Discover based on taste analysis
     */
    private static async fetchCandidates(
        taste: {
            genres: string[];
            keywords: string[];
            yearRange: [number, number] | null;
            minRating: number;
        },
        mediaType: 'movie' | 'tv',
        excludeIds: Set<number>
    ): Promise<(TMDBMovie | TMDBTV)[]> {
        // Convert genre names to IDs
        const genreIds = genreNamesToIds(taste.genres, mediaType);

        // Convert keyword names to IDs (we now have 6 keywords)
        const keywordIds = await keywordNamesToIds(taste.keywords);
        console.log(`[Weekly Watchlist] Got ${keywordIds.length} valid keyword IDs from ${taste.keywords.length} keywords`);

        const baseParams: Parameters<typeof discoverMovies>[0] = {
            with_genres: genreIds.join('|'), // OR logic for broader results
            vote_average_gte: taste.minRating,
            vote_count_gte: 100, // Ensure some popularity
            sort_by: 'vote_average.desc',
        };

        if (taste.yearRange) {
            if (mediaType === 'movie') {
                baseParams.primary_release_date_gte = `${taste.yearRange[0]}-01-01`;
                baseParams.primary_release_date_lte = `${taste.yearRange[1]}-12-31`;
            } else {
                baseParams.first_air_date_gte = `${taste.yearRange[0]}-01-01`;
                baseParams.first_air_date_lte = `${taste.yearRange[1]}-12-31`;
            }
        }

        // Create keyword pairs for multiple searches
        // With 6 keywords [A, B, C, D, E, F]: pairs = [A+B, C+D, E+F]
        const keywordPairs: number[][] = [];
        for (let i = 0; i < keywordIds.length - 1; i += 2) {
            keywordPairs.push([keywordIds[i], keywordIds[i + 1]]);
        }
        // If we have less than 2 pairs, add a third with first and third keywords
        if (keywordPairs.length < 2 && keywordIds.length >= 3) {
            keywordPairs.push([keywordIds[0], keywordIds[2]]);
        }

        // Collect all candidates from multiple searches
        const allCandidates = new Map<number, TMDBMovie | TMDBTV>();

        for (let i = 0; i < Math.min(keywordPairs.length, 3); i++) {
            const pair = keywordPairs[i];
            const params = { ...baseParams, with_keywords: pair.join('|') };

            console.log(`[Weekly Watchlist] Discover ${mediaType} search ${i + 1}/${Math.min(keywordPairs.length, 3)} with keywords: ${pair.join('|')}`);

            let results: TMDBMovie[] | TMDBTV[];
            if (mediaType === 'movie') {
                results = await discoverMovies(params, 3); // 3 pages per search
            } else {
                results = await discoverTV(params, 3);
            }

            // Add to map (deduplicates by ID)
            for (const r of results) {
                if (!excludeIds.has(r.id)) {
                    allCandidates.set(r.id, r);
                }
            }
        }

        let filtered = Array.from(allCandidates.values());
        console.log(`[Weekly Watchlist] Combined ${filtered.length} unique ${mediaType} candidates from ${keywordPairs.length} keyword searches`);

        // FALLBACK: If still too few results, search without keywords
        if (filtered.length < 20) {
            console.log(`[Weekly Watchlist] Only ${filtered.length} ${mediaType} candidates, adding fallback search without keywords...`);
            const fallbackParams = { ...baseParams };
            fallbackParams.vote_average_gte = Math.max(6.0, (fallbackParams.vote_average_gte || 7) - 0.5);

            let fallbackResults: TMDBMovie[] | TMDBTV[];
            if (mediaType === 'movie') {
                fallbackResults = await discoverMovies(fallbackParams, 5);
            } else {
                fallbackResults = await discoverTV(fallbackParams, 5);
            }

            for (const r of fallbackResults) {
                if (!excludeIds.has(r.id)) {
                    allCandidates.set(r.id, r);
                }
            }
            filtered = Array.from(allCandidates.values());
            console.log(`[Weekly Watchlist] After fallback: ${filtered.length} unique ${mediaType} candidates`);
        }

        // ANIMATION LIMITER: Limit anime/animation to max 30% of results
        const ANIMATION_GENRE_ID = 16; // TMDB Animation genre ID
        const animationItems = filtered.filter(c => c.genre_ids?.includes(ANIMATION_GENRE_ID));
        const nonAnimationItems = filtered.filter(c => !c.genre_ids?.includes(ANIMATION_GENRE_ID));

        const maxAnimation = Math.floor(filtered.length * 0.3); // Max 30%
        if (animationItems.length > maxAnimation) {
            console.log(`[Weekly Watchlist] Limiting animation from ${animationItems.length} to ${maxAnimation} (30% cap)`);
            filtered = [...nonAnimationItems, ...animationItems.slice(0, maxAnimation)];
        }

        return filtered;
    }

    /**
     * Generate weekly watchlist for all users
     * Called by scheduler
     */
    static async generateForAllUsers(): Promise<void> {
        console.log('[Weekly Watchlist] Starting generation for all users');

        const users = await prisma.user.findMany();

        for (const user of users) {
            try {
                await this.generateForUser(user.id);
            } catch (error: any) {
                console.error(`[Weekly Watchlist] Failed for user ${user.id}:`, error?.message || error);
            }
        }

        console.log(`[Weekly Watchlist] Completed generation for ${users.length} users`);
    }

    /**
     * Check for stale watchlists and regenerate
     * Called on application startup
     */
    static async checkAndRefreshStale(): Promise<void> {
        const weekStart = getWeekStart();

        // Find users without a current week's watchlist
        const users = await prisma.user.findMany();

        for (const user of users) {
            const existing = await prisma.weeklyWatchlist.findUnique({
                where: { userId_weekStart: { userId: user.id, weekStart } }
            });

            if (!existing) {
                console.log(`[Weekly Watchlist] User ${user.id} has no current watchlist, generating...`);
                try {
                    await this.generateForUser(user.id);
                } catch (error: any) {
                    console.error(`[Weekly Watchlist] Failed to generate for user ${user.id}:`, error?.message || error);
                }
            }
        }
    }
}
