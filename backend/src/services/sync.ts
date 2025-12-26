import { JellyfinService } from '../jellyfin';
import * as JellyseerrService from './jellyseerr';
import * as DataService from './data';
import { extractTmdbIds, normalizeJellyfinItem } from './jellyfin-normalizer';
import prisma from '../db';

const jellyfinService = new JellyfinService();

export interface SyncResult {
  total: number;
  new: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/**
 * Synchronize Jellyfin watch history to local database
 * 
 * Process:
 * 1. Fetch user's watch history from Jellyfin (items marked as played)
 * 2. Extract TMDB IDs from ProviderIds.Tmdb
 * 3. Check if each TMDB ID already exists in the database for this user
 * 4. For new items, enrich with metadata from Jellyseerr using getMediaDetails
 * 5. Save enriched items to database with status WATCHED
 * 
 * @param userId - Jellyfin User ID
 * @param username - Jellyfin Username (for database storage)
 * @param accessToken - Jellyfin Access Token
 * @param jellyfinUrl - Optional Jellyfin server URL override
 * @returns SyncResult with statistics
 */
export async function syncHistory(
  userId: string,
  username: string,
  accessToken: string,
  jellyfinUrl?: string
): Promise<SyncResult> {
  const result: SyncResult = {
    total: 0,
    new: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  try {
    console.log(`[Sync] Starting history sync for user: ${username}`);

    // Step 1: Fetch watched history from Jellyfin
    const history = await jellyfinService.getUserHistory(userId, accessToken, 1000, jellyfinUrl);
    result.total = history.length;
    console.log(`[Sync] Fetched ${history.length} watched items from Jellyfin`);

    if (history.length === 0) {
      console.log('[Sync] No watch history found');
      return result;
    }

    // Step 2: Get existing user data to check what's already in DB
    const existingData = await DataService.getUserData(username);
    const existingWatchedSet = new Set(existingData.watchedIds);
    console.log(`[Sync] Found ${existingWatchedSet.size} existing watched items in database`);

    // Step 3: Process each history item
    for (const item of history) {
      try {
        // Extract TMDB ID from ProviderIds.Tmdb
        const tmdbRaw = item.ProviderIds?.Tmdb ?? item.ProviderIds?.tmdb ?? null;

        if (!tmdbRaw) {
          console.debug(`[Sync] Skipping "${item.Name}" - no TMDB ID`);
          result.skipped++;
          continue;
        }

        const tmdbId = Number(tmdbRaw);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
          console.debug(`[Sync] Skipping "${item.Name}" - invalid TMDB ID: ${tmdbRaw}`);
          result.skipped++;
          continue;
        }

        // Check if already in database
        if (existingWatchedSet.has(tmdbId)) {
          console.debug(`[Sync] Skipping TMDB ${tmdbId} "${item.Name}" - already in database`);
          result.skipped++;
          continue;
        }

        // Determine media type (Movie or Series -> tv)
        const jellyfinType = item.Type?.toLowerCase() || 'movie';
        const mediaType = jellyfinType === 'series' ? 'tv' : 'movie';

        console.log(`[Sync] Processing new item: "${item.Name}" (TMDB: ${tmdbId}, Type: ${mediaType})`);

        // Step 4: Enrich with Jellyseerr metadata
        const enriched = await JellyseerrService.getMediaDetails(tmdbId, mediaType);

        if (!enriched) {
          console.warn(`[Sync] Failed to fetch metadata from Jellyseerr for TMDB ${tmdbId}`);

          // Fallback: use Jellyfin data if enrichment fails
          const normalized = normalizeJellyfinItem(item);
          if (normalized && normalized.tmdbId) {
            await DataService.updateMediaStatus(username, normalized, 'WATCHED');
            result.new++;
            console.log(`[Sync] Saved "${item.Name}" with Jellyfin metadata only`);
          } else {
            result.failed++;
            result.errors.push(`No TMDB ID for "${item.Name}"`);
          }
          continue;
        }

        // Step 5: Save to database with enriched metadata
        const itemToSave = {
          tmdbId: enriched.tmdb_id || tmdbId,
          title: enriched.title || item.Name,
          mediaType: enriched.media_type || mediaType,
          releaseYear: enriched.releaseDate?.substring(0, 4) || item.ProductionYear?.toString() || '',
          posterUrl: enriched.posterUrl || null,
          overview: enriched.overview || item.Overview || null,
          backdropUrl: enriched.backdropUrl || null,
          voteAverage: enriched.voteAverage || null,
          language: enriched.language || null,
        };

        await DataService.updateMediaStatus(username, itemToSave, 'WATCHED');
        result.new++;
        console.log(`[Sync] ✓ Saved "${enriched.title}" (TMDB: ${tmdbId})`);

        // Add delay to avoid rate limiting Jellyseerr
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (itemError: any) {
        result.failed++;
        const errorMsg = `Failed to process "${item.Name}": ${itemError.message}`;
        result.errors.push(errorMsg);
        console.error(`[Sync] ${errorMsg}`);
      }
    }

    console.log(`[Sync] Complete: ${result.new} new, ${result.skipped} skipped, ${result.failed} failed`);
    return result;

  } catch (error: any) {
    console.error('[Sync] Fatal error during history sync:', error);
    result.errors.push(`Fatal error: ${error.message}`);
    return result;
  }
}

/**
 * Get sync statistics for a user without performing a sync
 */
export async function getSyncStats(username: string): Promise<{ dbWatched: number; dbTotal: number }> {
  try {
    const user = await prisma.user.findUnique({
      where: { username },
      include: { userMedia: { include: { media: true } } },
    });

    if (!user) {
      return { dbWatched: 0, dbTotal: 0 };
    }

    const dbWatched = user.userMedia.filter((um: any) => um.status === 'WATCHED').length;
    const dbTotal = user.userMedia.length;

    return { dbWatched, dbTotal };
  } catch (error) {
    console.error('[Sync] Error fetching stats:', error);
    return { dbWatched: 0, dbTotal: 0 };
  }
}
