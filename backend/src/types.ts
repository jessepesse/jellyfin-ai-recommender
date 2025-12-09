import { MediaStatus, JellyfinLibrary, SharedMediaItem as FrontendItem, ApiError } from '@jellyfin-ai/types';

export { MediaStatus, JellyfinLibrary, FrontendItem, ApiError };

// ============================================================
// Jellyfin API Types
// ============================================================

export interface JellyfinItem {
    Id: string;
    Name: string;
    Type?: string;
    Genres?: string[];
    CommunityRating?: number;
    Overview?: string;
    PremiereDate?: string;
    ProductionYear?: number;
    RunTimeTicks?: number;
    SeriesId?: string;
    SeriesName?: string;
    ImageTags?: {
        Primary?: string;
    };
    imageUrl?: string;
    ProviderIds?: {
        Tmdb?: string | number;
        tmdb?: string | number;
        Imdb?: string;
        imdb?: string;
    };
    UserData?: {
        Played?: boolean;
        LastPlayedDate?: string;
    };
}

export interface JellyfinUser {
    Id: string;
    Name: string;
}

export interface JellyfinAuthResponse {
    AccessToken: string;
    User: JellyfinUser;
}

export interface LoginResponse {
    success: boolean;
    message?: string;
    jellyfinAuth?: JellyfinAuthResponse;
    serverUrl?: string;
}

// ============================================================
// Frontend/API Response Types
// ============================================================

// FrontendItem imported from shared


// ============================================================
// Media & Database Types
// ============================================================

// MediaStatus imported from shared


// Flexible input type for media items from various sources (Jellyfin, Jellyseerr, imports, etc.)
export interface MediaItemInput {
    tmdbId?: number | string | null;
    tmdb_id?: number | string | null;
    media_id?: number | string | null;
    id?: number | string | null;
    title?: string;
    name?: string;
    originalTitle?: string;
    Title?: string;
    releaseYear?: string | number;
    release_year?: string | number;
    releaseDate?: string;
    release_date?: string;
    firstAirDate?: string;
    first_air_date?: string;
    year?: string | number;
    mediaType?: string;
    media_type?: string;
    type?: string;
    posterUrl?: string | null;
    poster_url?: string | null;
    poster_path?: string | null;
    overview?: string | null;
    plot?: string | null;
    synopsis?: string | null;
    backdropUrl?: string | null;
    backdrop_url?: string | null;
    backdrop_path?: string | null;
    voteAverage?: number | null;
    vote_average?: number | null;
    rating?: number | null;
    language?: string | null;
    originalLanguage?: string | null;
    reason?: string;
}

export interface MediaItem {
    tmdbId: number;
    title: string;
    overview?: string;
    mediaType: 'movie' | 'tv' | string;
    releaseYear?: string;
    posterUrl?: string;
    posterSourceUrl?: string;
    backdropUrl?: string;
    backdropSourceUrl?: string;
    voteAverage?: number;
    language?: string;
}

export interface UserData {
    watchedIds?: number[];
    watchlistIds?: number[];
    blockedIds?: number[];
    jellyfin_history?: JellyfinItem[];
}

// ============================================================
// Recommendation Types
// ============================================================

export interface RecommendationCandidate {
    title: string;
    media_type?: 'movie' | 'tv' | string;
    release_year?: string | number;
    reason?: string;
}

export interface EnrichedRecommendation extends MediaItem {
    tmdb_id?: number;
    reason?: string;
}

export interface RecommendationFilters {
    type?: 'movie' | 'tv' | string;
    genre?: string;
    mood?: string;
}

// ============================================================
// Configuration Types
// ============================================================

export interface SystemConfig {
    jellyfinUrl?: string;
    jellyseerrUrl?: string;
    geminiApiKey?: string;
    geminiModel?: string;
}

export interface ConfigUpdatePayload {
    jellyfinUrl?: string;
    jellyseerrUrl?: string;
    geminiApiKey?: string;
    geminiModel?: string;
}

// ============================================================
// Import/Export Types
// ============================================================

export interface LegacyImportEntry {
    title?: string;
    tmdb_id?: number;
    tmdbId?: number;
    media_type?: string;
    year?: string | number;
    releaseDate?: string;
}

export interface ImportPayload {
    movies?: LegacyImportEntry[];
    watchlist?: LegacyImportEntry[];
    blocked?: LegacyImportEntry[];
    tv?: LegacyImportEntry[];
}

export interface ImportResult {
    imported: number;
    skipped: number;
    errors: string[];
}

// ============================================================
// Error Types
// ============================================================

// ApiError imported from shared


export interface HttpError extends Error {
    status?: number;
    statusCode?: number;
    response?: {
        status?: number;
        data?: unknown;
    };
}

// ============================================================
// Request Header Types
// ============================================================

export interface AuthHeaders {
    'x-access-token'?: string;
    'x-jellyfin-url'?: string;
    'x-user-id'?: string;
    'x-user-name'?: string;
    [key: string]: string | undefined;
}

// ============================================================
// Prisma-related Types (for update payloads)
// ============================================================

export interface MediaUpdateData {
    title?: string;
    overview?: string;
    posterUrl?: string;
    posterSourceUrl?: string;
    backdropUrl?: string;
    backdropSourceUrl?: string;
    voteAverage?: number;
    language?: string;
    mediaType?: string;
    releaseYear?: string;
}

export interface MediaCreateData extends MediaUpdateData {
    tmdbId: number;
    title: string;
}
