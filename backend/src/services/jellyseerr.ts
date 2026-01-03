import axios from 'axios';
import { CacheService } from './cache';


// NOTE: Do not rely on process.env at module-evaluation time for runtime-configured
// values. Use `ConfigService.getConfig()` via `getClient()` so the in-app SetupWizard
// (DB-backed) values are respected when the app is running.

import ConfigService from './config';
import { validateBaseUrl } from '../utils/ssrf-protection';

// Create an axios client using runtime configuration (DB values preferred, then env)
async function getClient(): Promise<import('axios').AxiosInstance> {
  const cfg = await ConfigService.getConfig();
  const rawBase = cfg && cfg.jellyseerrUrl ? String(cfg.jellyseerrUrl) : (process.env.JELLYSEERR_URL || '');
  const rawKey = cfg && cfg.jellyseerrApiKey ? String(cfg.jellyseerrApiKey) : (process.env.JELLYSEERR_API_KEY || '');
  // Explicit SSRF validation for baseURL
  const base = validateBaseUrl(rawBase);
  const key = rawKey ? rawKey.trim() : '';
  // Return axios client with validated runtime base URL and sanitized API key header
  return axios.create({ baseURL: base, headers: { 'X-Api-Key': key }, timeout: 30000 });
}

export type Enriched = {
  title: string;
  media_type: 'movie' | 'tv' | string;
  tmdb_id?: number;
  posterUrl?: string;
  overview?: string;
  backdropUrl?: string;
  voteAverage?: number;
  language?: string;
  releaseDate?: string;
};

function normalizeTitle(str: string | undefined): string {
  if (!str) return '';
  // Lowercase
  let s = String(str).toLowerCase();
  // Remove common prefixes
  s = s.replace(/^the\s+/, '').replace(/^a\s+/, '');
  // Remove non-alphanumeric characters
  s = s.replace(/[^a-z0-9]/g, '');
  return s;
}

/**
 * Strict encode: ensures characters that `encodeURIComponent` leaves unescaped
 * (like ! ' ( ) *) are percent-encoded in uppercase hex, matching strict
 * validators such as Jellyseerr's.
 */
function strictEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, function (c) {
    return '%' + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

async function constructPosterUrl(partialPath: string | undefined) {
  if (!partialPath) return undefined;
  const cfg = await ConfigService.getConfig();
  const rawBase = cfg.jellyseerrUrl || process.env.JELLYSEERR_URL || '';
  // SSRF Protection: validate base URL
  const baseUrl = validateBaseUrl(rawBase);
  return `${baseUrl}/imageproxy/tmdb/t/p/w300_and_h450_face${partialPath}`;
}

async function constructBackdropUrl(partialPath: string | undefined) {
  if (!partialPath) return undefined;
  const cfg = await ConfigService.getConfig();
  const rawBase = cfg.jellyseerrUrl || process.env.JELLYSEERR_URL || '';
  // SSRF Protection: validate base URL
  const baseUrl = validateBaseUrl(rawBase);
  return `${baseUrl}/imageproxy/tmdb/t/p/w1280_and_h720_multi_faces${partialPath}`;
}

/**
 * Strict verification: exact year match, exact type match, fuzzy title matching
 * Returns Enriched or null when no strict match found
 */
export async function searchAndVerify(queryTitle: string, queryYear: string | number | undefined, queryType: string | undefined): Promise<Enriched | null> {
  const yearStr = queryYear ? String(queryYear).trim() : '';
  const typeStr = queryType ? String(queryType).toLowerCase() : '';
  const cacheKey = `${cacheKeyForTitle(queryTitle)}_verify_${yearStr}_${typeStr}`;
  const cached = CacheService.get<Enriched | null>('jellyseerr', cacheKey);
  if (cached !== undefined) return cached; // could be null

  try {
    // Manually encode the query to guarantee compliance with Jellyseerr's strict URL rules.
    const encodedQuery = strictEncode(String(queryTitle));
    let client;
    try {
      client = await getClient();
    } catch (cfgErr) {
      console.warn('Jellyseerr not configured; skipping verification', (cfgErr as any)?.message || String(cfgErr));
      return null;
    }
    const resp = await client.get(`/api/v1/search?query=${encodedQuery}&page=1`);
    const data = resp.data;
    const results = Array.isArray(data) ? data : (data.results || []);

    const normQuery = normalizeTitle(queryTitle);

    // Filter out non-media results (persons, etc.)
    const candidates = (results || []).filter((c: any) => {
      const ct = (c.mediaType || c.media_type || c.type || '').toString().toLowerCase();
      return ct === 'movie' || ct === 'tv';
    });

    const match = candidates.find((candidate: any) => {
      const candidateTypeRaw = candidate.mediaType || candidate.media_type || candidate.type || (candidate.isMovie ? 'movie' : candidate.isTv ? 'tv' : undefined);
      const candidateType = candidateTypeRaw ? String(candidateTypeRaw).toLowerCase() : '';
      if (typeStr && candidateType !== typeStr) return false;

      // Year check (strict exact)
      const dateStr = candidate.releaseDate || candidate.firstAirDate || candidate.year || candidate.release_date || candidate.first_air_date;
      const candidateYear = dateStr ? String(dateStr).substring(0, 4) : '';
      if (yearStr && candidateYear !== yearStr) return false;

      // Title fuzzy check
      const candTitle = candidate.title || candidate.name || candidate.originalTitle || candidate.original_name || '';
      const normCand = normalizeTitle(candTitle);
      if (!normCand || !normQuery) return false;
      return normCand.includes(normQuery) || normQuery.includes(normCand);
    });

    if (match) {
      const id = match.id ?? match.tmdbId ?? match.tmdb_id ?? match.tmdb;
      const tmdb_id = id !== undefined && id !== null ? Number(id) : undefined;
      const partialPath = match.posterPath || match.poster_path || match.poster || match.thumb || match.posterUrl || undefined;
      const posterUrl = await constructPosterUrl(partialPath);
      const backdropPartial = match.backdropPath || match.backdrop_path || match.backdrop || undefined;
      const backdropUrl = await constructBackdropUrl(backdropPartial);
      const overview = match.overview || match.plot || match.synopsis || null;
      const voteAverage = match.voteAverage ?? match.vote_average ?? match.rating ?? match.vote ?? undefined;
      const language = match.originalLanguage ?? match.language ?? match.lang ?? undefined;
      const media_type = (match.mediaType || match.media_type || match.type || (match.isMovie ? 'movie' : match.isTv ? 'tv' : 'movie')) as any;
      const title = match.title || match.name || queryTitle;
      const releaseDate = match.releaseDate || match.firstAirDate || match.year || match.release_date || match.first_air_date || undefined;

      const enriched: Enriched = {
        title,
        overview: overview || undefined,
        posterUrl: posterUrl || undefined,
        backdropUrl: backdropUrl || undefined,
        voteAverage: voteAverage !== undefined && voteAverage !== null ? Number(voteAverage) : undefined,
        language: language ? String(language) : undefined,
        tmdb_id: tmdb_id ? Number(tmdb_id) : undefined,
        media_type,
        releaseDate: releaseDate,
      };

      CacheService.set('jellyseerr', cacheKey, enriched);
      // Detailed audit log for verification success
      try {
        console.debug(`[Jellyseerr Verify] SUCCESS: Found "${match.title || match.name || title}" | Type: ${match.mediaType || match.media_type || match.type || media_type} | Year: ${match.releaseDate || match.firstAirDate || releaseDate}`);
      } catch (logErr) {
        // swallow logging errors
        console.debug('[Jellyseerr Verify] SUCCESS: (log failed)', logErr);
      }
      return enriched;
    }

    // Audit when no match found
    try {
      console.debug(`[Jellyseerr Verify] FAILED: No match found for query "${queryTitle}" (${yearStr})`);
    } catch (logErr) {
      console.warn('[Jellyseerr Verify] FAILED: (log failed)', logErr);
    }

    // FALLBACK: Try direct TMDB search if configured
    try {
      const { searchByTitle } = await import('./tmdb-discover');
      const tmdbResult = await searchByTitle(queryTitle, yearStr || undefined, typeStr as 'movie' | 'tv' | undefined);

      if (tmdbResult) {
        const enriched: Enriched = {
          title: tmdbResult.title,
          overview: tmdbResult.overview,
          posterUrl: tmdbResult.posterUrl,
          backdropUrl: tmdbResult.backdropUrl,
          voteAverage: tmdbResult.voteAverage,
          tmdb_id: tmdbResult.tmdb_id,
          media_type: tmdbResult.media_type,
          releaseDate: tmdbResult.releaseDate,
        };
        CacheService.set('jellyseerr', cacheKey, enriched);
        console.debug(`[TMDB Fallback] SUCCESS: Found "${tmdbResult.title}" via direct TMDB`);
        return enriched;
      }
    } catch (tmdbErr: any) {
      // TMDB fallback failed - continue with null result
      console.debug('[TMDB Fallback] Skipped:', tmdbErr?.message || 'not configured');
    }

    CacheService.set('jellyseerr', cacheKey, null);
    return null;
  } catch (e: any) {
    console.error('Jellyseerr verify/search error for', queryTitle, e?.response?.data || e.message || e);
    return null;
  }
}

/**
 * Search Jellyseerr directly and map results to Enriched[]
 */
export async function search(query: string): Promise<Enriched[]> {
  let client;
  try {
    client = await getClient();
  } catch (cfgErr) {
    console.warn('Jellyseerr not configured; search skipped', (cfgErr as any)?.message || String(cfgErr));
    return [];
  }
  try {
    // Manually encode the query to guarantee compliance with Jellyseerr's strict URL rules.
    const encodedQuery = strictEncode(String(query));
    const resp = await client.get(`/api/v1/search?query=${encodedQuery}&page=1`);
    const data = resp.data;
    const results = Array.isArray(data) ? data : (data.results || []);
    const out: Enriched[] = [];
    for (const r of (results || [])) {
      const tmdb_id = r.id || r.tmdbId || r.tmdb_id || r.tmdb || undefined;
      const partialPath = r.posterPath || r.poster_path || r.poster || r.thumb || r.posterUrl || undefined;
      const backdropPartial = r.backdropPath || r.backdrop_path || r.backdrop || undefined;
      const voteAverage = r.voteAverage ?? r.vote_average ?? r.rating ?? r.vote;
      const language = r.originalLanguage ?? r.language ?? r.lang;
      const posterUrl = partialPath ? await constructPosterUrl(partialPath) : undefined;
      const backdropUrl = backdropPartial ? await constructBackdropUrl(backdropPartial) : undefined;
      out.push({
        title: r.title || r.name || r.originalTitle || r.original_name || '',
        media_type: (r.mediaType || r.media_type || r.type || (r.isMovie ? 'movie' : r.isTv ? 'tv' : 'movie')) as any,
        tmdb_id: tmdb_id ? Number(tmdb_id) : undefined,
        posterUrl: posterUrl || undefined,
        backdropUrl: backdropUrl || undefined,
        voteAverage: voteAverage ? Number(voteAverage) : undefined,
        language: language ? String(language) : undefined,
        overview: r.overview || r.plot || r.synopsis,
        releaseDate: r.releaseDate || r.firstAirDate || r.year || r.release_date || r.first_air_date,
      } as Enriched);
    }
    return out;
  } catch (e: any) {
    console.error('Jellyseerr search error', e?.response?.data || e.message || e);
    return [];
  }
}

function cacheKeyForTitle(title: string) {
  return `jellyseerr_enrich_${title.trim().toLowerCase()}`;
}

export async function searchAndEnrich(title: string, targetMediaType?: string, releaseYear?: string | number): Promise<Enriched | null> {
  // If Jellyseerr not configured, return minimal info
  let client;
  try {
    client = await getClient();
  } catch (cfgErr) {
    console.warn('Jellyseerr not configured: skipping enrichment', (cfgErr as any)?.message || String(cfgErr));
    return { title, media_type: 'movie' };
  }
  // Use strict verification logic: require exact year and type, fuzzy title
  try {
    const verified = await searchAndVerify(title, releaseYear, targetMediaType);
    // Ask Jellyseerr/Overseerr to request media by TMDB id when requested by the user
    // (searchAndEnrich only attempts verification/enrichment, it does not perform requests)
    return verified;
  } catch (e: any) {
    console.error('Jellyseerr search error for', title, e?.response?.data || e.message || e);
    return null;
  }
}

/**
 * Get media details directly by TMDB ID (no search required)
 * @param tmdbId - TMDB ID (numeric)
 * @param mediaType - 'movie' or 'tv'
 * @returns Enriched object with full metadata or null if not found
 */
export async function getMediaDetails(tmdbId: string | number, mediaType: 'movie' | 'tv'): Promise<Enriched | null> {
  const id = Number(tmdbId);
  if (!Number.isFinite(id) || id <= 0) {
    console.warn('[Jellyseerr] Invalid TMDB ID:', tmdbId);
    return null;
  }

  const cacheKey = `jellyseerr_details_${mediaType}_${id}`;
  const cached = CacheService.get<Enriched | null>('jellyseerr', cacheKey);
  if (cached !== undefined) return cached;

  let client;
  try {
    client = await getClient();
  } catch (cfgErr) {
    console.warn('Jellyseerr not configured; skipping details lookup', (cfgErr as any)?.message || String(cfgErr));
    return null;
  }

  try {
    const endpoint = mediaType === 'movie' ? `/api/v1/movie/${id}` : `/api/v1/tv/${id}`;
    const resp = await client.get(endpoint);
    const data = resp.data;

    if (!data) {
      CacheService.set('jellyseerr', cacheKey, null);
      return null;
    }

    const partialPath = data.posterPath || data.poster_path || data.poster || undefined;
    const backdropPartial = data.backdropPath || data.backdrop_path || data.backdrop || undefined;
    const posterUrl = await constructPosterUrl(partialPath);
    const backdropUrl = await constructBackdropUrl(backdropPartial);

    const enriched: Enriched = {
      title: data.title || data.name || data.originalTitle || data.original_name || '',
      media_type: mediaType,
      tmdb_id: id,
      posterUrl: posterUrl || undefined,
      backdropUrl: backdropUrl || undefined,
      overview: data.overview || data.plot || data.synopsis || undefined,
      voteAverage: data.voteAverage ?? data.vote_average ?? data.rating ?? undefined,
      language: data.originalLanguage ?? data.language ?? undefined,
      releaseDate: data.releaseDate || data.firstAirDate || data.release_date || data.first_air_date || undefined,
    };

    CacheService.set('jellyseerr', cacheKey, enriched);
    console.debug(`[Jellyseerr] Details fetched for ${mediaType} ${id}: ${enriched.title}`);
    return enriched;
  } catch (e: any) {
    if (e.response?.status === 404) {
      console.debug(`[Jellyseerr] Media not found: ${mediaType} ${id}`);
      CacheService.set('jellyseerr', cacheKey, null);
      return null;
    }
    console.error(`[Jellyseerr] Error fetching details for ${mediaType} ${id}:`, e?.response?.data || e.message || e);
    return null;
  }
}

export async function requestMediaByTmdb(tmdbId: number, mediaType: 'movie' | 'tv' = 'movie'): Promise<any> {
  let client;
  try {
    client = await getClient();
  } catch (cfgErr) {
    throw new Error('Jellyseerr not configured');
  }
  try {
    // Build strict payload required by Jellyseerr/Overseerr APIs
    const payload: any = {
      mediaType: mediaType, // 'movie' or 'tv'
      mediaId: Number(tmdbId),
    };

    // For TV shows, we must specify seasons. Fetch available seasons and request all.
    if (mediaType === 'tv') {
      try {
        const detailsResp = await client.get(`/api/v1/tv/${tmdbId}`);
        if (detailsResp.data && Array.isArray(detailsResp.data.seasons)) {
          // Select all seasons
          payload.seasons = detailsResp.data.seasons.map((s: any) => s.seasonNumber);
          console.debug(`[Jellyseerr] Auto-selecting seasons for TV ${tmdbId}:`, payload.seasons);
        }
      } catch (detailsErr) {
        console.warn('[Jellyseerr] Failed to fetch TV details for season auto-selection, sending empty season list:', detailsErr);
        payload.seasons = [];
      }
    }

    // Debug: avoid logging full request payloads; log minimal identifying fields only
    console.debug('[Jellyseerr] Sending request payload', { mediaType: payload.mediaType, mediaId: payload.mediaId, seasonsCount: payload.seasons?.length });

    const resp = await client.post('/api/v1/request', payload);
    console.debug('[Jellyseerr] Request response:', resp.data);
    return resp.data;
  } catch (e: any) {
    console.error('Jellyseerr request error for', tmdbId, e?.response?.data || e.message || e);
    throw e;
  }
}

/**
 * Get similar media items from TMDB via Jellyseerr
 * @param tmdbId - TMDB ID (numeric)
 * @param mediaType - 'movie' or 'tv'
 * @returns Array of TMDB IDs for similar items
 */
export async function getSimilar(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<number[]> {
  const cacheKey = `jellyseerr_similar_${mediaType}_${tmdbId}`;
  const cached = CacheService.get<number[]>('jellyseerr', cacheKey);
  if (cached !== undefined) return cached;

  let client;
  try {
    client = await getClient();
  } catch (cfgErr) {
    console.warn('[Jellyseerr] Not configured; skipping similar lookup');
    return [];
  }

  try {
    const endpoint = mediaType === 'movie'
      ? `/api/v1/movie/${tmdbId}/similar`
      : `/api/v1/tv/${tmdbId}/similar`;
    const resp = await client.get(endpoint);
    const results = resp.data?.results || [];
    const ids = results.map((r: any) => Number(r.id)).filter((id: number) => Number.isFinite(id) && id > 0);

    CacheService.set('jellyseerr', cacheKey, ids);
    console.debug(`[Jellyseerr] Similar fetched for ${mediaType} ${tmdbId}: ${ids.length} items`);
    return ids;
  } catch (e: any) {
    console.error(`[Jellyseerr] Error fetching similar for ${mediaType} ${tmdbId}:`, e?.response?.data || e.message || e);
    return [];
  }
}

/**
 * Get recommended media items from TMDB via Jellyseerr
 * @param tmdbId - TMDB ID (numeric)
 * @param mediaType - 'movie' or 'tv'
 * @returns Array of TMDB IDs for recommended items
 */
export async function getRecommendations(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<number[]> {
  const cacheKey = `jellyseerr_recommendations_${mediaType}_${tmdbId}`;
  const cached = CacheService.get<number[]>('jellyseerr', cacheKey);
  if (cached !== undefined) return cached;

  let client;
  try {
    client = await getClient();
  } catch (cfgErr) {
    console.warn('[Jellyseerr] Not configured; skipping recommendations lookup');
    return [];
  }

  try {
    const endpoint = mediaType === 'movie'
      ? `/api/v1/movie/${tmdbId}/recommendations`
      : `/api/v1/tv/${tmdbId}/recommendations`;
    const resp = await client.get(endpoint);
    const results = resp.data?.results || [];
    const ids = results.map((r: any) => Number(r.id)).filter((id: number) => Number.isFinite(id) && id > 0);

    CacheService.set('jellyseerr', cacheKey, ids);
    console.debug(`[Jellyseerr] Recommendations fetched for ${mediaType} ${tmdbId}: ${ids.length} items`);
    return ids;
  } catch (e: any) {
    console.error(`[Jellyseerr] Error fetching recommendations for ${mediaType} ${tmdbId}:`, e?.response?.data || e.message || e);
    return [];
  }
}

/**
 * Full details response type with enriched metadata
 */
export type FullMediaDetails = {
  genres: string[];  // TMDB genre names: ["Science Fiction", "Action"]
  keywords: string[];
  director?: string;
  topCast: string[];
  tagline?: string;
  similar: number[];
  recommendations: number[];
};

/**
 * Get full media details including keywords, credits, similar, and recommendations
 * @param tmdbId - TMDB ID (numeric)
 * @param mediaType - 'movie' or 'tv'
 * @returns Full enriched metadata
 */
export async function getFullDetails(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<FullMediaDetails | null> {
  const cacheKey = `jellyseerr_fulldetails_${mediaType}_${tmdbId}`;
  const cached = CacheService.get<FullMediaDetails>('jellyseerr', cacheKey);
  if (cached !== undefined) return cached;

  let client;
  try {
    client = await getClient();
  } catch (cfgErr) {
    console.warn('[Jellyseerr] Not configured; skipping full details lookup');
    return null;
  }

  try {
    const endpoint = mediaType === 'movie' ? `/api/v1/movie/${tmdbId}` : `/api/v1/tv/${tmdbId}`;
    const resp = await client.get(endpoint);
    const data = resp.data;

    if (!data) return null;

    // Extract genres
    const genresData = data.genres || [];
    const genres = (Array.isArray(genresData) ? genresData : [])
      .map((g: any) => g.name || g)
      .filter(Boolean);

    // Extract keywords
    const keywordsData = data.keywords?.keywords || data.keywords?.results || data.keywords || [];
    const keywords = (Array.isArray(keywordsData) ? keywordsData : [])
      .map((k: any) => k.name || k)
      .filter(Boolean)
      .slice(0, 10);

    // Extract director from crew
    const crew = data.credits?.crew || [];
    const director = crew.find((c: any) => c.job === 'Director' || c.job === 'Series Director')?.name;

    // Extract top cast
    const cast = data.credits?.cast || [];
    const topCast = cast.slice(0, 5).map((c: any) => c.name).filter(Boolean);

    // Extract tagline
    const tagline = data.tagline || undefined;

    // Fetch similar and recommendations in parallel
    const [similar, recommendations] = await Promise.all([
      getSimilar(tmdbId, mediaType),
      getRecommendations(tmdbId, mediaType),
    ]);

    const result: FullMediaDetails = {
      genres,
      keywords,
      director,
      topCast,
      tagline,
      similar,
      recommendations,
    };

    CacheService.set('jellyseerr', cacheKey, result);
    console.debug(`[Jellyseerr] Full details fetched for ${mediaType} ${tmdbId}: ${genres.length} genres, ${keywords.length} keywords, ${topCast.length} cast`);
    return result;
  } catch (e: any) {
    console.error(`[Jellyseerr] Error fetching full details for ${mediaType} ${tmdbId}:`, e?.response?.data || e.message || e);
    return null;
  }
}

