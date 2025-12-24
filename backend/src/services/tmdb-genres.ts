/**
 * TMDB Genre ID mappings for Movie and TV Discover API
 */

// Movie genre IDs from TMDB
export const MOVIE_GENRES: Record<string, number> = {
    'action': 28,
    'adventure': 12,
    'animation': 16,
    'comedy': 35,
    'crime': 80,
    'documentary': 99,
    'drama': 18,
    'family': 10751,
    'fantasy': 14,
    'history': 36,
    'horror': 27,
    'music': 10402,
    'mystery': 9648,
    'romance': 10749,
    'science fiction': 878,
    'sci-fi': 878,
    'tv movie': 10770,
    'thriller': 53,
    'war': 10752,
    'western': 37,
};

// TV genre IDs from TMDB
export const TV_GENRES: Record<string, number> = {
    'action & adventure': 10759,
    'action': 10759,
    'adventure': 10759,
    'animation': 16,
    'comedy': 35,
    'crime': 80,
    'documentary': 99,
    'drama': 18,
    'family': 10751,
    'kids': 10762,
    'mystery': 9648,
    'news': 10763,
    'reality': 10764,
    'sci-fi & fantasy': 10765,
    'sci-fi': 10765,
    'science fiction': 10765,
    'fantasy': 10765,
    'soap': 10766,
    'talk': 10767,
    'war & politics': 10768,
    'war': 10768,
    'western': 37,
};

/**
 * Convert genre names to TMDB IDs
 * @param names - Array of genre names (case-insensitive)
 * @param type - 'movie' or 'tv'
 * @returns Array of unique TMDB genre IDs
 */
export function genreNamesToIds(names: string[], type: 'movie' | 'tv'): number[] {
    const map = type === 'movie' ? MOVIE_GENRES : TV_GENRES;
    const ids = names
        .map(n => map[n.toLowerCase().trim()])
        .filter((id): id is number => id !== undefined);

    // Return unique IDs
    return [...new Set(ids)];
}

/**
 * Get genre ID by name (single lookup)
 */
export function getGenreId(name: string, type: 'movie' | 'tv'): number | null {
    const map = type === 'movie' ? MOVIE_GENRES : TV_GENRES;
    return map[name.toLowerCase().trim()] ?? null;
}
