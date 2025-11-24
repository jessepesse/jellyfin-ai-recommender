export interface JellyfinItem {
    // Standardized backend recommendation shape (Strict Verification)
    tmdbId: number; // Trusted TMDB ID from backend (required)
    title: string;
    // Poster URL may be null if not available, but present for verified items
    posterUrl: string | null;
    mediaType: 'movie' | 'tv';
    // YYYY string (empty string when not available)
    releaseYear: string;
    // Rich metadata returned when available
    overview: string | null;
    backdropUrl: string | null;
    // Numeric vote average (0 when unknown)
    voteAverage: number;
    CommunityRating?: number;
}

export interface JellyfinLibrary {
    Id: string;
    Name:string;
}

export interface Settings {
    jellyfinUrl?: string;
    apiKey?: string;
}
