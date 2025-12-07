/**
 * ⚠️ CRITICAL ARCHITECTURE NOTE: BACKWARD COMPATIBILITY ⚠️
 * 
 * This service is the bridge between legacy JSON data and the current Database Schema.
 * 
 * RULES FOR MODIFYING THIS FILE:
 * 1. If you change `schema.prisma` (e.g. rename 'tmdbId' to 'externalId'), 
 *    you MUST update the mapping logic here to handle BOTH keys.
 *    Example: `const id = jsonItem.externalId || jsonItem.tmdbId;`
 * 
 * 2. NEVER remove support for the v1/v2 JSON structure. Users rely on this 
 *    to migrate their data across versions.
 */

import prisma from './data';
import { searchAndEnrich } from './jellyseerr';
import { updateMediaStatus } from './data';
import { MediaItemInput, LegacyImportEntry } from '../types';

type LegacyEntry = string | LegacyImportEntry;

// Resolved item after Jellyseerr verification
interface ResolvedImportItem {
  title?: string;
  tmdbId?: number;
  mediaType: 'movie' | 'tv';
  releaseYear?: string;
  overview?: string;
  posterUrl?: string;
  backdropUrl?: string;
  voteAverage?: number;
}

// Import payload structure (legacy JSON format)
interface ImportPayload {
  movies?: LegacyEntry[];
  series?: LegacyEntry[];
  watchlist?: {
    movies?: LegacyEntry[];
    series?: LegacyEntry[];
  };
  'watchlist.movies'?: LegacyEntry[];
  'watchlist.series'?: LegacyEntry[];
  items?: LegacyEntry[];
  data?: ImportPayload;
}

export interface ImportProgress {
  username: string;
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  errors: number;
  currentItem: string;
  active: boolean;
  completed: boolean;
}

export class ImportService {
  private progressMap = new Map<string, ImportProgress>();

  getProgress(username: string): ImportProgress | null {
    return this.progressMap.get(username) || null;
  }

  private updateProgress(username: string, update: Partial<ImportProgress>) {
    const current = this.progressMap.get(username);
    if (current) {
      this.progressMap.set(username, { ...current, ...update });
    }
  }

  private initProgress(username: string, total: number) {
    this.progressMap.set(username, {
      username,
      total,
      processed: 0,
      imported: 0,
      skipped: 0,
      errors: 0,
      currentItem: '',
      active: true,
      completed: false,
    });
  }

  private completeProgress(username: string) {
    const current = this.progressMap.get(username);
    if (current) {
      this.progressMap.set(username, { ...current, active: false, completed: true });
      // Auto-cleanup after 5 minutes
      setTimeout(() => this.progressMap.delete(username), 5 * 60 * 1000);
    }
  }
  // Resolve an entry to a standard shape, try Jellyseerr when tmdbId missing
  async resolveLegacyEntry(entry: LegacyEntry, defaultMediaType: 'movie' | 'tv'): Promise<ResolvedImportItem | null> {
    if (!entry) return null;
    let title: string | undefined;
    let tmdbId: number | undefined;
    let mediaType: 'movie' | 'tv' = defaultMediaType;
    let releaseYear: string | undefined;

    if (typeof entry === 'string') {
      title = entry.trim();
    } else if (typeof entry === 'object') {
      title = entry.title ?? undefined;
      tmdbId = entry.tmdb_id ?? entry.tmdbId ?? undefined;
      mediaType = (entry.media_type === 'tv' ? 'tv' : 'movie') as 'movie' | 'tv';
      if (entry.year) releaseYear = String(entry.year);
      if (entry.releaseDate) releaseYear = String(entry.releaseDate).substring(0,4);
    }

    if (!title && !tmdbId) return null;

    if (!tmdbId && title) {
      // Try to verify via Jellyseerr
      try {
        const enriched = await searchAndEnrich(title, mediaType, releaseYear);
        if (!enriched || !enriched.tmdb_id) return null;
        tmdbId = Number(enriched.tmdb_id);
        title = enriched.title || title;
        // return enriched metadata as well
        return {
          title,
          tmdbId,
          mediaType: mediaType === 'tv' ? 'tv' : 'movie',
          releaseYear: enriched.releaseDate ? String(enriched.releaseDate).substring(0,4) : releaseYear,
          overview: enriched.overview ?? undefined,
          posterUrl: enriched.posterUrl ?? undefined,
          backdropUrl: enriched.backdropUrl ?? undefined,
          voteAverage: enriched.voteAverage ?? undefined,
        };
      } catch (e) {
        return null;
      }
    }

    return {
      title,
      tmdbId: tmdbId ? Number(tmdbId) : undefined,
      mediaType: mediaType === 'tv' ? 'tv' : 'movie',
      releaseYear,
    };
  }

  // jsonData is parsed object (not raw string) representing legacy database.json
  async processImport(username: string, jsonData: ImportPayload, accessToken?: string) {
    if (!username) throw new Error('username required');
    const user = await prisma.user.upsert({ where: { username }, create: { username }, update: {} });
    // Unwrap if payloads are nested under `data` (legacy export format)
    const payload: ImportPayload = (jsonData && typeof jsonData === 'object' && jsonData.data) ? jsonData.data : jsonData;

    // Build queue from known legacy keys
    const queue: Array<{ raw: LegacyEntry; targetStatus: string; mediaType: 'movie'|'tv' }> = [];

    try {
      if (Array.isArray(payload.movies)) payload.movies.forEach((r: LegacyEntry) => queue.push({ raw: r, targetStatus: 'WATCHED', mediaType: 'movie' }));
      if (Array.isArray(payload.series)) payload.series.forEach((r: LegacyEntry) => queue.push({ raw: r, targetStatus: 'WATCHED', mediaType: 'tv' }));

      // watchlist may be nested
      if (payload.watchlist) {
        if (Array.isArray(payload.watchlist.movies)) payload.watchlist.movies.forEach((r: LegacyEntry) => queue.push({ raw: r, targetStatus: 'WATCHLIST', mediaType: 'movie' }));
        if (Array.isArray(payload.watchlist.series)) payload.watchlist.series.forEach((r: LegacyEntry) => queue.push({ raw: r, targetStatus: 'WATCHLIST', mediaType: 'tv' }));
      }

      // legacy keys like watchlist_movies or similar
      if (Array.isArray(payload['watchlist.movies'])) payload['watchlist.movies'].forEach((r: LegacyEntry) => queue.push({ raw: r, targetStatus: 'WATCHLIST', mediaType: 'movie' }));
      if (Array.isArray(payload['watchlist.series'])) payload['watchlist.series'].forEach((r: LegacyEntry) => queue.push({ raw: r, targetStatus: 'WATCHLIST', mediaType: 'tv' }));

      // Allow top-level generic arrays
      if (Array.isArray(payload.items)) payload.items.forEach((r: LegacyEntry) => queue.push({ raw: r, targetStatus: 'WATCHLIST', mediaType: 'movie' }));
    } catch (e) {
      // ignore malformed
    }

    console.log(`[Import] Built queue with ${queue.length} items for user ${username}`);

    // Initialize progress tracking
    this.initProgress(username, queue.length);

    let total = 0, skipped = 0, imported = 0;
    const errors: string[] = [];

    // Process in batches to avoid timeout
    const BATCH_SIZE = 10;
    for (let i = 0; i < queue.length; i += BATCH_SIZE) {
      const batch = queue.slice(i, i + BATCH_SIZE);
      console.log(`[Import] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(queue.length / BATCH_SIZE)} (items ${i + 1}-${Math.min(i + BATCH_SIZE, queue.length)})`);

      for (const q of batch) {
        total++;
        try {
          const resolved = await this.resolveLegacyEntry(q.raw, q.mediaType);
          if (!resolved || !resolved.tmdbId) {
            skipped++;
            this.updateProgress(username, { 
              processed: total, 
              skipped, 
              currentItem: typeof q.raw === 'string' ? q.raw : ((q.raw as LegacyImportEntry).title || 'Unknown')
            });
            continue;
          }

          const tmdbId = Number(resolved.tmdbId);
          
          // Update progress with current item
          this.updateProgress(username, { 
            currentItem: resolved.title || 'Unknown',
            processed: total
          });

          // Check if media exists
          const media = await prisma.media.findUnique({ where: { tmdbId } });
          let exists = false;
          if (media) {
            const um = await prisma.userMedia.findFirst({ where: { userId: user.id, mediaId: media.id } });
            if (um) exists = true;
          }

          if (exists) {
            console.debug(`[Import] Skipping '${resolved.title}' - Already in DB`);
            skipped++;
            this.updateProgress(username, { skipped, processed: total });
            continue;
          }

          // Build item payload for updateMediaStatus (it will upsert media)
          const itemForDb: MediaItemInput = {
            tmdbId: tmdbId,
            title: resolved.title,
            mediaType: resolved.mediaType,
            releaseYear: resolved.releaseYear,
            posterUrl: resolved.posterUrl,
            overview: resolved.overview,
            backdropUrl: resolved.backdropUrl,
            voteAverage: resolved.voteAverage !== undefined ? Number(resolved.voteAverage) : undefined,
          };

          await updateMediaStatus(username, itemForDb, q.targetStatus, accessToken);
          imported++;
          this.updateProgress(username, { imported, processed: total });
          console.log(`[Import] ✓ Imported '${resolved.title}' (${imported}/${queue.length - skipped})`);
        } catch (e: unknown) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          errors.push(errorMsg);
          this.updateProgress(username, { errors: errors.length, processed: total });
          console.error(`[Import] ✗ Failed to import item:`, errorMsg);
        }
      }
    }

    console.log(`[Import] Complete: ${imported} imported, ${skipped} skipped, ${errors.length} errors`);
    this.completeProgress(username);
    return { total, skipped, imported, errors };
  }
}

export default new ImportService();
