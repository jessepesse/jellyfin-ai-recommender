/**
 * Anchor-based recommendation helpers
 * Uses cached similar/recommendation IDs from enriched media to find candidates
 */

import prisma from '../db';
import { getMediaDetails } from './jellyseerr';
import type { Enriched } from './jellyseerr';

export interface AnchorItem {
    id: number;
    tmdbId: number;
    title: string;
    mediaType: string;
    genres: string[];
    keywords: string[];
    director?: string;
    similarIds: number[];
    recommendationIds: number[];
}

/**
 * Mood to TMDB keywords mapping for contextual filtering
 * Each mood maps to relevant keywords that indicate matching content
 */
export const MOOD_KEYWORDS: Record<string, string[]> = {
    'mind-bending': ['twist ending', 'nonlinear timeline', 'surreal', 'psychological', 'dream', 'time travel', 'mind game', 'plot twist', 'unreliable narrator'],
    'dark': ['dark hero', 'violence', 'neo-noir', 'dystopia', 'crime', 'conspiracy', 'revenge', 'serial killer', 'dark comedy', 'moral ambiguity'],
    'adrenaline': ['car chase', 'explosion', 'fight', 'heist', 'survival', 'action hero', 'martial arts', 'spy', 'chase', 'high stakes'],
    'chill': ['feel-good', 'friendship', 'slice of life', 'heartwarming', 'cozy', 'comfort', 'small town', 'nature', 'meditation', 'peaceful'],
    'feel-good': ['comedy', 'romance', 'happy ending', 'family', 'underdog', 'redemption', 'love story', 'friendship', 'wedding', 'coming of age'],
    'tearjerker': ['tragedy', 'death', 'loss', 'emotional', 'grief', 'terminal illness', 'sacrifice', 'farewell', 'bittersweet', 'tear jerker'],
    'visual': ['epic', 'visually stunning', 'fantasy world', 'sci-fi', 'beautiful scenery', 'cinematography', 'visual effects', 'futuristic', 'surreal', 'animation'],
};

/**
 * Get anchor items for a user based on their history
 * Prioritizes recently watched items that have been enriched
 * 
 * @param username - User's username
 * @param mediaType - 'movie' or 'tv' filter (optional)
 * @param genre - Genre name filter (optional, e.g. "Science Fiction", "Drama")
 * @param mood - Mood filter (optional, e.g. "mind-bending", "dark", "adrenaline")
 * @param limit - Number of anchors to return (default 5)
 * @returns Array of anchor items with enriched metadata
 */
export async function getAnchorItems(
    username: string,
    mediaType?: string,
    genre?: string,
    mood?: string,
    limit: number = 5
): Promise<AnchorItem[]> {
    // Find user's watched/watchlist items that are enriched
    const user = await prisma.user.findUnique({
        where: { username },
    });

    if (!user) return [];

    // Query media items associated with user that have enrichment data
    // Fetch more items if we need to filter by genre or mood
    const hasFilters = genre || mood;
    const fetchLimit = hasFilters ? limit * 5 : limit * 2;

    const userMedia = await prisma.userMedia.findMany({
        where: {
            userId: user.id,
            status: { in: ['WATCHED', 'WATCHLIST'] },
            media: {
                enrichedAt: { not: null },
                ...(mediaType ? { mediaType } : {}),
            },
        },
        include: {
            media: true,
        },
        orderBy: {
            updatedAt: 'desc',
        },
        take: fetchLimit,
    });

    const anchors: AnchorItem[] = [];

    // Track Animation count only (no primary genre diversification)
    let animationCount = 0;
    const MAX_ANIMATION = 4; // Max 4 animated items out of 10 anchors

    for (const um of userMedia) {
        if (anchors.length >= limit) break;

        const media = um.media;
        if (!media.similarIds && !media.recommendationIds) continue;

        try {
            const genres = media.genres ? JSON.parse(media.genres) : [];
            const keywords = media.keywords ? JSON.parse(media.keywords) : [];
            const similarIds = media.similarIds ? JSON.parse(media.similarIds) : [];
            const recommendationIds = media.recommendationIds ? JSON.parse(media.recommendationIds) : [];

            if (similarIds.length === 0 && recommendationIds.length === 0) continue;

            // Filter by genre if specified
            if (genre) {
                const genreLower = genre.toLowerCase();
                const hasMatchingGenre = genres.some((g: string) =>
                    g.toLowerCase().includes(genreLower) || genreLower.includes(g.toLowerCase())
                );
                if (!hasMatchingGenre) continue;
            }

            // Filter by mood keywords if specified
            if (mood && MOOD_KEYWORDS[mood]) {
                const moodKeywords = MOOD_KEYWORDS[mood];
                const keywordsLower = keywords.map((k: string) => k.toLowerCase());
                const hasMatchingKeyword = moodKeywords.some(mk =>
                    keywordsLower.some((k: string) => k.includes(mk.toLowerCase()) || mk.toLowerCase().includes(k))
                );
                if (!hasMatchingKeyword) {
                    // Don't strictly filter, but deprioritize - only skip if we have enough anchors
                    if (anchors.length >= limit * 0.5) {
                        console.debug(`[Anchor] MOOD SKIP: "${media.title}" - keywords [${keywords.slice(0, 3).join(', ')}] don't match mood "${mood}"`);
                        continue;
                    }
                }
            }

            // Animation limiter only - prevent all-anime anchor sets
            const isAnimation = genres.some((g: string) => g.toLowerCase().includes('animation'));
            if (isAnimation && animationCount >= MAX_ANIMATION) {
                console.debug(`[Anchor] DIVERSIFY SKIP: "${media.title}" - already have ${MAX_ANIMATION} Animation anchors`);
                continue;
            }
            if (isAnimation) {
                animationCount++;
            }

            anchors.push({
                id: media.id,
                tmdbId: media.tmdbId,
                title: media.title,
                mediaType: media.mediaType,
                genres,
                keywords,
                director: media.director || undefined,
                similarIds,
                recommendationIds,
            });
        } catch (e) {
            // JSON parse error, skip this item
            continue;
        }
    }

    return anchors;
}

/**
 * Collect candidate TMDB IDs from anchor items
 * Combines similar and recommendation IDs, deduplicates
 * 
 * @param anchors - Array of anchor items
 * @param excludeIds - Set of TMDB IDs to exclude (already watched, etc.)
 * @returns Array of unique candidate TMDB IDs
 */
export function collectCandidateIds(
    anchors: AnchorItem[],
    excludeIds: Set<number>
): number[] {
    const candidateSet = new Set<number>();

    for (const anchor of anchors) {
        for (const id of anchor.similarIds) {
            if (!excludeIds.has(id)) {
                candidateSet.add(id);
            }
        }
        for (const id of anchor.recommendationIds) {
            if (!excludeIds.has(id)) {
                candidateSet.add(id);
            }
        }
    }

    return Array.from(candidateSet);
}

/**
 * Fetch basic details for candidate TMDB IDs
 * Uses Jellyseerr to get title, overview, vote_average
 * 
 * @param candidateIds - Array of TMDB IDs
 * @param mediaType - 'movie' or 'tv'
 * @param limit - Max candidates to fetch (default 40)
 * @returns Array of enriched candidates
 */
export async function fetchCandidateDetails(
    candidateIds: number[],
    mediaType: 'movie' | 'tv',
    limit: number = 40
): Promise<Enriched[]> {
    const candidates: Enriched[] = [];
    const idsToFetch = candidateIds.slice(0, limit);

    for (const tmdbId of idsToFetch) {
        try {
            const details = await getMediaDetails(tmdbId, mediaType);
            if (details) {
                candidates.push(details);
            }
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 50));
        } catch (e) {
            // Skip failed fetches
            continue;
        }
    }

    return candidates;
}

/**
 * Build anchor context string for Gemini prompt
 * Shows user's liked items with keywords for context
 */
export function buildAnchorContext(anchors: AnchorItem[]): string {
    if (anchors.length === 0) return '';

    const lines = anchors.map(a => {
        const keywordStr = a.keywords.slice(0, 5).join(', ');
        const directorStr = a.director ? ` (${a.director})` : '';
        return `- ${a.title}${directorStr}: ${keywordStr}`;
    });

    return `User's favorites that we're basing recommendations on:\n${lines.join('\n')}`;
}
