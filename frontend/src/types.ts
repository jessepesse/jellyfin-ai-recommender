export interface JellyfinItem {
    // Standardized backend recommendation shape (Strict Verification)
    tmdbId: number; // Trusted TMDB ID from backend (required)
    title: string;
    posterUrl: string; // Full Jellyseerr proxy URL (required)
    mediaType: 'movie' | 'tv';
    releaseYear: string; // YYYY string
    // Optional legacy/extra metadata that frontend should not rely on
    overview?: string;
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
