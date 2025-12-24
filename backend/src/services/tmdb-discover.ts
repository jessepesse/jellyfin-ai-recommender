/**
 * TMDB Discover API Service
 * Used for fetching candidates based on Gemini-generated search criteria
 */

import axios from 'axios';
import ConfigService from './config';
import { validateBaseUrl } from '../utils/ssrf-protection';
import { CacheService } from './cache';

interface DiscoverParams {
    with_genres?: string;           // comma (AND) or pipe (OR) separated
    with_keywords?: string;         // keyword IDs
    primary_release_date_gte?: string; // YYYY-MM-DD (movies)
    primary_release_date_lte?: string;
    first_air_date_gte?: string;    // (TV)
    first_air_date_lte?: string;
    vote_average_gte?: number;
    vote_average_lte?: number;
    vote_count_gte?: number;
    with_original_language?: string;
    sort_by?: string;
    page?: number;
}

export interface TMDBMovie {
    id: number;
    title: string;
    original_title: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    release_date: string;
    genre_ids: number[];
    vote_average: number;
    vote_count: number;
    popularity: number;
}

export interface TMDBTV {
    id: number;
    name: string;
    original_name: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    first_air_date: string;
    genre_ids: number[];
    vote_average: number;
    vote_count: number;
    popularity: number;
    origin_country: string[];
}

interface DiscoverResponse<T> {
    page: number;
    results: T[];
    total_pages: number;
    total_results: number;
}

interface KeywordSearchResult {
    id: number;
    name: string;
}


// Create axios client for either Direct TMDB or Jellyseerr (proxy)
async function getClient(): Promise<{ client: import('axios').AxiosInstance; type: 'tmdb' | 'jellyseerr' }> {
    const cfg = await ConfigService.getConfig();

    // Priority 1: Direct TMDB API (if configured)
    if (cfg.tmdbApiKey && cfg.tmdbApiKey.length > 5) {
        const isBearer = cfg.tmdbApiKey.length > 60; // Read Access Tokens are usually very long JWTs
        const config: import('axios').CreateAxiosDefaults = {
            baseURL: 'https://api.themoviedb.org/3',
            timeout: 15000
        };

        if (isBearer) {
            config.headers = { Authorization: `Bearer ${cfg.tmdbApiKey}` };
        } else {
            config.params = { api_key: cfg.tmdbApiKey };
        }

        return {
            client: axios.create(config),
            type: 'tmdb'
        };
    }

    // Priority 2: Jellyseerr Proxy
    const rawBase = cfg && cfg.jellyseerrUrl ? String(cfg.jellyseerrUrl) : (process.env.JELLYSEERR_URL || '');
    const rawKey = cfg && cfg.jellyseerrApiKey ? String(cfg.jellyseerrApiKey) : (process.env.JELLYSEERR_API_KEY || '');
    const base = validateBaseUrl(rawBase);
    const key = rawKey ? rawKey.trim() : '';

    return {
        client: axios.create({
            baseURL: base,
            headers: { 'X-Api-Key': key },
            timeout: 15000
        }),
        type: 'jellyseerr'
    };
}

/**
 * Discover movies using TMDB Discover API (Direct or via Proxy)
 */
export async function discoverMovies(params: DiscoverParams, pages: number = 3): Promise<TMDBMovie[]> {
    const cacheKey = `discover_movie_${JSON.stringify(params)}_${pages}`;
    const cached = CacheService.get<TMDBMovie[]>('tmdb', cacheKey);
    if (cached) return cached;

    const { client, type } = await getClient();
    const results: TMDBMovie[] = [];
    const endpoint = type === 'tmdb' ? '/discover/movie' : '/api/v1/discover/movies';

    try {
        for (let page = 1; page <= pages; page++) {
            const queryParams: Record<string, string | number> = {
                language: 'en-US',
                page,
                sort_by: params.sort_by || 'popularity.desc',
            };

            if (params.with_genres) queryParams.with_genres = params.with_genres;
            if (params.with_keywords) queryParams.with_keywords = params.with_keywords;
            if (params.primary_release_date_gte) queryParams['primary_release_date.gte'] = params.primary_release_date_gte;
            if (params.primary_release_date_lte) queryParams['primary_release_date.lte'] = params.primary_release_date_lte;
            if (params.vote_average_gte) queryParams['vote_average.gte'] = params.vote_average_gte;
            if (params.vote_count_gte) queryParams['vote_count.gte'] = params.vote_count_gte;
            if (params.with_original_language) queryParams.with_original_language = params.with_original_language;

            const response = await client.get<DiscoverResponse<TMDBMovie>>(endpoint, { params: queryParams });

            if (response.data?.results) {
                results.push(...response.data.results);
            }

            console.debug(`[TMDB Discover] Movies page ${page} (${type}): ${response.data?.results?.length || 0} results`);

            // Stop if we've fetched all pages
            if (page >= response.data.total_pages) break;
        }

        CacheService.set('tmdb', cacheKey, results, 3600); // Cache 1 hour
        return results;
    } catch (error: any) {
        console.error(`[TMDB Discover] Movie search failed (${type}):`, error?.message || error);
        return [];
    }
}

/**
 * Discover TV shows using TMDB Discover API (Direct or via Proxy)
 */
export async function discoverTV(params: DiscoverParams, pages: number = 3): Promise<TMDBTV[]> {
    const cacheKey = `discover_tv_${JSON.stringify(params)}_${pages}`;
    const cached = CacheService.get<TMDBTV[]>('tmdb', cacheKey);
    if (cached) return cached;

    const { client, type } = await getClient();
    const results: TMDBTV[] = [];
    const endpoint = type === 'tmdb' ? '/discover/tv' : '/api/v1/discover/tv';

    try {
        for (let page = 1; page <= pages; page++) {
            const queryParams: Record<string, string | number> = {
                language: 'en-US',
                page,
                sort_by: params.sort_by || 'popularity.desc',
            };

            if (params.with_genres) queryParams.with_genres = params.with_genres;
            if (params.with_keywords) queryParams.with_keywords = params.with_keywords;
            if (params.first_air_date_gte) queryParams['first_air_date.gte'] = params.first_air_date_gte;
            if (params.first_air_date_lte) queryParams['first_air_date.lte'] = params.first_air_date_lte;
            if (params.vote_average_gte) queryParams['vote_average.gte'] = params.vote_average_gte;
            if (params.vote_count_gte) queryParams['vote_count.gte'] = params.vote_count_gte;
            if (params.with_original_language) queryParams.with_original_language = params.with_original_language;

            const response = await client.get<DiscoverResponse<TMDBTV>>(endpoint, { params: queryParams });

            if (response.data?.results) {
                results.push(...response.data.results);
            }

            console.debug(`[TMDB Discover] TV page ${page} (${type}): ${response.data?.results?.length || 0} results`);

            if (page >= response.data.total_pages) break;
        }

        CacheService.set('tmdb', cacheKey, results, 3600);
        return results;
    } catch (error: any) {
        console.error(`[TMDB Discover] TV search failed (${type}):`, error?.message || error);
        return [];
    }
}

/**
 * Search for a keyword ID by name
 * Used to convert Gemini's keyword suggestions to TMDB keyword IDs
 */
export async function searchKeyword(query: string): Promise<number | null> {
    const cacheKey = `keyword_${query.toLowerCase()}`;
    const cached = CacheService.get<number | null>('tmdb', cacheKey);
    if (cached !== undefined) return cached;

    const { client, type } = await getClient();
    const endpoint = type === 'tmdb' ? '/search/keyword' : '/api/v1/search/keyword';

    try {
        const response = await client.get<{ results: KeywordSearchResult[] }>(endpoint, {
            params: { query: query.trim() }
        });

        if (response.data?.results && response.data.results.length > 0) {
            // Return exact match or first result
            const exact = response.data.results.find(r => r.name.toLowerCase() === query.toLowerCase());
            const id = exact?.id || response.data.results[0].id;
            CacheService.set('tmdb', cacheKey, id, 86400); // Cache 24 hours
            return id;
        }

        CacheService.set('tmdb', cacheKey, null, 86400);
        return null;
    } catch (error: any) {
        console.error(`[TMDB Discover] Keyword search failed for "${query}" (${type}):`, error?.message || error);
        return null;
    }
}

/**
 * Convert keyword names to IDs
 */
export async function keywordNamesToIds(keywords: string[]): Promise<number[]> {
    const ids: number[] = [];

    for (const keyword of keywords) {
        const id = await searchKeyword(keyword);
        if (id !== null) {
            ids.push(id);
        }
    }

    return ids;
}

/**
 * Search TMDB directly by title (multi-search)
 * Used as fallback when Jellyseerr search fails
 */
export async function searchByTitle(
    query: string,
    year?: string,
    mediaType?: 'movie' | 'tv'
): Promise<{
    tmdb_id?: number;
    title: string;
    media_type: 'movie' | 'tv';
    overview?: string;
    posterUrl?: string;
    backdropUrl?: string;
    voteAverage?: number;
    releaseDate?: string;
} | null> {
    try {
        const { client, type } = await getClient();

        // Only use direct TMDB API - can't use Jellyseerr for this
        if (type !== 'tmdb') {
            console.debug('[TMDB Search] Direct API not configured, skipping fallback');
            return null;
        }

        // Use multi-search endpoint
        const params: any = { query: query.trim() };
        if (year) params.year = year;

        const response = await client.get<{ results: any[] }>('/search/multi', { params });

        if (!response.data?.results || response.data.results.length === 0) {
            console.debug(`[TMDB Search] No results for "${query}" (${year || 'no year'})`);
            return null;
        }

        // Filter by media type if specified
        let results = response.data.results.filter(r =>
            r.media_type === 'movie' || r.media_type === 'tv'
        );

        if (mediaType) {
            results = results.filter(r => r.media_type === mediaType);
        }

        if (results.length === 0) {
            return null;
        }

        // Find best match (exact title + year match if possible)
        const normalizedQuery = query.toLowerCase().trim();
        const bestMatch = results.find(r => {
            const title = (r.title || r.name || '').toLowerCase().trim();
            const releaseYear = (r.release_date || r.first_air_date || '').substring(0, 4);
            const titleMatch = title === normalizedQuery || title.includes(normalizedQuery);
            const yearMatch = !year || releaseYear === year;
            return titleMatch && yearMatch;
        }) || results[0];

        const posterPath = bestMatch.poster_path;
        const backdropPath = bestMatch.backdrop_path;

        console.debug(`[TMDB Search] SUCCESS: Found "${bestMatch.title || bestMatch.name}" (${bestMatch.media_type})`);

        return {
            tmdb_id: bestMatch.id,
            title: bestMatch.title || bestMatch.name,
            media_type: bestMatch.media_type,
            overview: bestMatch.overview,
            posterUrl: posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : undefined,
            backdropUrl: backdropPath ? `https://image.tmdb.org/t/p/w780${backdropPath}` : undefined,
            voteAverage: bestMatch.vote_average,
            releaseDate: bestMatch.release_date || bestMatch.first_air_date,
        };
    } catch (error: any) {
        console.error(`[TMDB Search] Failed for "${query}":`, error?.message || error);
        return null;
    }
}

