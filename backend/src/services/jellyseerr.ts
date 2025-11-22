import axios from 'axios';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';

dotenv.config();

const JELLYSEERR_URL = process.env.JELLYSEERR_URL;
const JELLYSEERR_API_KEY = process.env.JELLYSEERR_API_KEY;

if (!JELLYSEERR_URL) {
  console.warn('JELLYSEERR_URL not set; Jellyseerr enrichment will be disabled');
}

const client = axios.create({
  baseURL: JELLYSEERR_URL,
  headers: {
    'X-Api-Key': JELLYSEERR_API_KEY || '',
  },
  timeout: 10000,
});

// Cache TTL: 12 hours
const CACHE_TTL_SECONDS = 60 * 60 * 12;
const cache = new NodeCache({ stdTTL: CACHE_TTL_SECONDS, checkperiod: 1200 });

export type Enriched = {
  title: string;
  media_type: 'movie' | 'tv' | string;
  tmdb_id?: number;
  posterUrl?: string;
  overview?: string;
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

function constructPosterUrl(partialPath: string | undefined) {
  if (!partialPath) return undefined;
  const baseUrl = (JELLYSEERR_URL || '').replace(/\/$/, '');
  // Keep same sizing used previously
  return `${baseUrl}/imageproxy/tmdb/t/p/w300_and_h450_face${partialPath}`;
}

/**
 * Strict verification: exact year match, exact type match, fuzzy title matching
 * Returns Enriched or null when no strict match found
 */
export async function searchAndVerify(queryTitle: string, queryYear: string | number | undefined, queryType: string | undefined): Promise<Enriched | null> {
  if (!JELLYSEERR_URL || !JELLYSEERR_API_KEY) return null;

  const yearStr = queryYear ? String(queryYear).trim() : '';
  const typeStr = queryType ? String(queryType).toLowerCase() : '';
  const cacheKey = `${cacheKeyForTitle(queryTitle)}_verify_${yearStr}_${typeStr}`;
  const cached = cache.get<Enriched | null>(cacheKey);
  if (cached !== undefined) return cached; // could be null

  try {
    const resp = await client.get('/api/v1/search', { params: { query: queryTitle } });
    const data = resp.data;
    const results = Array.isArray(data) ? data : (data.results || []);

    const normQuery = normalizeTitle(queryTitle);

    const match = (results || []).find((candidate: any) => {
      // Type check
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
      // allow inclusion both ways to tolerate articles and minor variants
      return normCand.includes(normQuery) || normQuery.includes(normCand);
    });

    if (match) {
      const tmdb_id = match.id || match.tmdbId || match.tmdb_id || match.tmdb || undefined;
      const partialPath = match.posterPath || match.poster_path || match.poster || match.thumb || match.posterUrl || undefined;
      const posterUrl = constructPosterUrl(partialPath);
      const overview = match.overview || match.plot || match.synopsis;
      const media_type = match.mediaType || match.media_type || match.type || (match.isMovie ? 'movie' : match.isTv ? 'tv' : 'movie');

      const enriched: Enriched = {
        title: match.title || match.name || queryTitle,
        overview,
        posterUrl,
        tmdb_id: tmdb_id ? Number(tmdb_id) : undefined,
        media_type,
        releaseDate: match.releaseDate || match.firstAirDate || match.year || match.release_date || match.first_air_date,
      };

      cache.set(cacheKey, enriched);
      console.log(`[Verify] Match Found: "${enriched.title}" (tmdb:${enriched.tmdb_id}) for "${queryTitle}" (${yearStr})`);
      return enriched;
    }

    console.warn(`[Verify] Dropped "${queryTitle}" (${yearStr}). No exact year/type match found.`);
    cache.set(cacheKey, null);
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
  if (!JELLYSEERR_URL || !JELLYSEERR_API_KEY) return [];
  try {
    const resp = await client.get('/api/v1/search', { params: { query } });
    const data = resp.data;
    const results = Array.isArray(data) ? data : (data.results || []);
    return (results || []).map((r: any) => {
      const tmdb_id = r.id || r.tmdbId || r.tmdb_id || r.tmdb || undefined;
      const partialPath = r.posterPath || r.poster_path || r.poster || r.thumb || r.posterUrl || undefined;
      return {
        title: r.title || r.name || r.originalTitle || r.original_name || '',
        media_type: (r.mediaType || r.media_type || r.type || (r.isMovie ? 'movie' : r.isTv ? 'tv' : 'movie')) as any,
        tmdb_id: tmdb_id ? Number(tmdb_id) : undefined,
        posterUrl: partialPath ? constructPosterUrl(partialPath) : undefined,
        overview: r.overview || r.plot || r.synopsis,
        releaseDate: r.releaseDate || r.firstAirDate || r.year || r.release_date || r.first_air_date,
      } as Enriched;
    });
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
  if (!JELLYSEERR_URL || !JELLYSEERR_API_KEY) {
    if (!JELLYSEERR_URL) console.warn('Jellyseerr not configured: skipping enrichment');
    return { title, media_type: 'movie' };
  }
  // Use strict verification logic: require exact year and type, fuzzy title
  try {
    const verified = await searchAndVerify(title, releaseYear, targetMediaType);
    if (verified) {
      // also cache under old-style key for compatibility
      const key = `${cacheKeyForTitle(title)}_${String(releaseYear || '')}`;
      cache.set(key, verified);
      return verified;
    }
    return null;
  } catch (e: any) {
    console.error('Jellyseerr search error for', title, e?.response?.data || e.message || e);
    return null;
  }
}

export async function requestMediaByTmdb(tmdbId: number, mediaType: 'movie' | 'tv' = 'movie'): Promise<any> {
  if (!JELLYSEERR_URL || !JELLYSEERR_API_KEY) {
    throw new Error('Jellyseerr not configured');
  }
  try {
    // Build strict payload required by Jellyseerr/Overseerr APIs
    const payload: any = {
      mediaType: mediaType, // 'movie' or 'tv'
      mediaId: Number(tmdbId),
    };
    // For TV shows, include seasons array (can be empty)
    if (mediaType === 'tv') {
      payload.seasons = [];
    }

    // Log exact payload for debugging
    console.log('[Jellyseerr] Request payload:', payload);

    const resp = await client.post('/api/v1/request', payload);
    return resp.data;
  } catch (e: any) {
    console.error('Jellyseerr request error for', tmdbId, e?.response?.data || e.message || e);
    throw e;
  }
}
