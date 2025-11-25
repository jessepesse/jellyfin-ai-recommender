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

type LegacyEntry = string | { title?: string; tmdb_id?: number; tmdbId?: number; year?: string | number; media_type?: string };

export class ImportService {
  // Resolve an entry to a standard shape, try Jellyseerr when tmdbId missing
  async resolveLegacyEntry(entry: LegacyEntry, defaultMediaType: 'movie' | 'tv') {
    if (!entry) return null;
    let title: string | undefined;
    let tmdbId: number | undefined;
    let mediaType: string = defaultMediaType;
    let releaseYear: string | undefined;

    if (typeof entry === 'string') {
      title = entry.trim();
    } else if (typeof entry === 'object') {
      title = (entry as any).title ?? undefined;
      tmdbId = (entry as any).tmdb_id ?? (entry as any).tmdbId ?? undefined;
      mediaType = (entry as any).media_type ?? mediaType;
      if ((entry as any).year) releaseYear = String((entry as any).year);
      if ((entry as any).releaseDate) releaseYear = String((entry as any).releaseDate).substring(0,4);
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
        } as any;
      } catch (e) {
        return null;
      }
    }

    return {
      title,
      tmdbId: tmdbId ? Number(tmdbId) : undefined,
      mediaType: mediaType === 'tv' ? 'tv' : 'movie',
      releaseYear,
    } as any;
  }

  // jsonData is parsed object (not raw string) representing legacy database.json
  async processImport(username: string, jsonData: any, accessToken?: string) {
    if (!username) throw new Error('username required');
    const user = await prisma.user.upsert({ where: { username }, create: { username }, update: {} });
    // Unwrap if payloads are nested under `data` (legacy export format)
    const payload = (jsonData && typeof jsonData === 'object' && jsonData.data) ? jsonData.data : jsonData;

    // Build queue from known legacy keys
    const queue: Array<{ raw: LegacyEntry; targetStatus: string; mediaType: 'movie'|'tv' }> = [];

    try {
      if (Array.isArray(payload.movies)) payload.movies.forEach((r: any) => queue.push({ raw: r, targetStatus: 'WATCHED', mediaType: 'movie' }));
      if (Array.isArray(payload.series)) payload.series.forEach((r: any) => queue.push({ raw: r, targetStatus: 'WATCHED', mediaType: 'tv' }));

      // watchlist may be nested
      if (payload.watchlist) {
        if (Array.isArray(payload.watchlist.movies)) payload.watchlist.movies.forEach((r: any) => queue.push({ raw: r, targetStatus: 'WATCHLIST', mediaType: 'movie' }));
        if (Array.isArray(payload.watchlist.series)) payload.watchlist.series.forEach((r: any) => queue.push({ raw: r, targetStatus: 'WATCHLIST', mediaType: 'tv' }));
      }

      // legacy keys like watchlist_movies or similar
      if (Array.isArray(payload['watchlist.movies'])) payload['watchlist.movies'].forEach((r: any) => queue.push({ raw: r, targetStatus: 'WATCHLIST', mediaType: 'movie' }));
      if (Array.isArray(payload['watchlist.series'])) payload['watchlist.series'].forEach((r: any) => queue.push({ raw: r, targetStatus: 'WATCHLIST', mediaType: 'tv' }));

      // Allow top-level generic arrays
      if (Array.isArray(payload.items)) payload.items.forEach((r: any) => queue.push({ raw: r, targetStatus: 'WATCHLIST', mediaType: 'movie' }));
    } catch (e) {
      // ignore malformed
    }

    console.debug(`[Import] Built queue with ${queue.length} items for user ${username}`);

    let total = 0, skipped = 0, imported = 0;
    const errors: string[] = [];

    for (const q of queue) {
      total++;
      try {
        const resolved: any = await this.resolveLegacyEntry(q.raw, q.mediaType);
        if (!resolved || !resolved.tmdbId) {
          skipped++;
          continue;
        }

        const tmdbId = Number(resolved.tmdbId);

        // Check if media exists
        const media = await prisma.media.findUnique({ where: { tmdbId } });
        let exists = false;
        if (media) {
          const um = await prisma.userMedia.findFirst({ where: { userId: user.id, mediaId: media.id } });
          if (um) exists = true;
        }

        if (exists) {
          console.debug(`Skipping '${resolved.title}' - Already in DB`);
          skipped++;
          continue;
        }

        // Build item payload for updateMediaStatus (it will upsert media)
        const itemForDb: any = {
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
      } catch (e: any) {
        errors.push(String(e?.message || e));
      }
    }

    return { total, skipped, imported, errors };
  }
}

export default new ImportService();
