import prisma from '../db';
import { getFullDetails, type FullMediaDetails } from './jellyseerr';

/**
 * Check if a media item should be enriched
 * Returns true if enrichedAt is null or older than 30 days
 */
export function shouldEnrich(media: { enrichedAt: Date | null }): boolean {
    if (!media.enrichedAt) return true;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return media.enrichedAt < thirtyDaysAgo;
}

/**
 * Enrich a media item with full TMDB data (keywords, credits, similar, recommendations)
 * Updates the database record with the enriched data
 * 
 * @param mediaId - Database ID of the media item
 * @returns true if enrichment was successful, false otherwise
 */
export async function enrichMedia(mediaId: number): Promise<boolean> {
    try {
        const media = await prisma.media.findUnique({
            where: { id: mediaId },
        });

        if (!media) {
            console.warn(`[Enrichment] Media not found: ${mediaId}`);
            return false;
        }

        // Check if enrichment is needed
        if (!shouldEnrich(media)) {
            console.debug(`[Enrichment] Skipping ${media.title} - already enriched recently`);
            return true;
        }

        const mediaType = media.mediaType === 'tv' ? 'tv' : 'movie';
        const fullDetails = await getFullDetails(media.tmdbId, mediaType);

        if (!fullDetails) {
            console.warn(`[Enrichment] Could not fetch full details for ${media.title} (TMDB: ${media.tmdbId})`);
            return false;
        }

        // Update the database record
        await prisma.media.update({
            where: { id: mediaId },
            data: {
                genres: JSON.stringify(fullDetails.genres),
                keywords: JSON.stringify(fullDetails.keywords),
                director: fullDetails.director || null,
                topCast: JSON.stringify(fullDetails.topCast),
                tagline: fullDetails.tagline || null,
                similarIds: JSON.stringify(fullDetails.similar),
                recommendationIds: JSON.stringify(fullDetails.recommendations),
                enrichedAt: new Date(),
            },
        });

        console.info(`[Enrichment] Successfully enriched ${media.title}: ${fullDetails.genres.length} genres, ${fullDetails.keywords.length} keywords, ${fullDetails.topCast.length} cast, ${fullDetails.similar.length} similar, ${fullDetails.recommendations.length} recommendations`);
        return true;
    } catch (error: any) {
        console.error(`[Enrichment] Error enriching media ${mediaId}:`, error?.message || error);
        return false;
    }
}

/**
 * Enrich a media item by TMDB ID (creates record if needed)
 * 
 * @param tmdbId - TMDB ID of the media
 * @param mediaType - 'movie' or 'tv'
 * @returns true if enrichment was successful, false otherwise
 */
export async function enrichMediaByTmdbId(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<boolean> {
    try {
        const media = await prisma.media.findUnique({
            where: { tmdbId },
        });

        if (!media) {
            console.warn(`[Enrichment] Media with TMDB ID ${tmdbId} not in database`);
            return false;
        }

        return enrichMedia(media.id);
    } catch (error: any) {
        console.error(`[Enrichment] Error enriching by TMDB ID ${tmdbId}:`, error?.message || error);
        return false;
    }
}

/**
 * Background job: Enrich all media items that need enrichment
 * Respects rate limiting with delays between API calls
 */
export async function runEnrichmentBackfill(): Promise<{ total: number; enriched: number; failed: number }> {
    console.info('[Enrichment] Starting backfill job...');

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Find media items that need enrichment
    const mediaToEnrich = await prisma.media.findMany({
        where: {
            OR: [
                { enrichedAt: null },
                { enrichedAt: { lt: thirtyDaysAgo } },
            ],
        },
        take: 50, // Limit batch size to avoid overwhelming API
    });

    const result = { total: mediaToEnrich.length, enriched: 0, failed: 0 };

    for (const media of mediaToEnrich) {
        const success = await enrichMedia(media.id);
        if (success) {
            result.enriched++;
        } else {
            result.failed++;
        }

        // Rate limiting: 200ms delay between API calls
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.info(`[Enrichment] Backfill complete: ${result.enriched} enriched, ${result.failed} failed`);
    return result;
}
