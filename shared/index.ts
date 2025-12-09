// Shared types between Backend and Frontend

export type MediaStatus = 'WATCHED' | 'WATCHLIST' | 'BLOCKED';

export interface JellyfinLibrary {
    Id: string;
    Name: string;
}

export interface ApiError {
    error: string;
    message?: string;
    detail?: string;
}

// Unified Media Item type (replaces FrontendItem in backend and JellyfinItem in frontend)
export interface SharedMediaItem {
    tmdbId: number;
    title: string;
    overview?: string | null;
    mediaType: 'movie' | 'tv' | string;
    releaseYear?: string;
    posterUrl?: string | null;
    backdropUrl?: string | null;
    voteAverage?: number;
    language?: string;
    status?: MediaStatus;
    reason?: string;
    CommunityRating?: number;
}
