import type { SharedMediaItem, JellyfinLibrary } from '@jellyfin-ai/types';

export interface JellyfinItem extends SharedMediaItem {
    mediaType: 'movie' | 'tv';
    releaseYear: string;
    posterUrl: string | null;
    overview: string | null;
    backdropUrl: string | null;
    voteAverage: number;
    genres?: string[];
}

export type { JellyfinLibrary };

export interface Settings {
    jellyfinUrl?: string;
    apiKey?: string;
}

export type AppView = 'recommendations' | 'weekly-picks' | 'trending' | 'watchlist' | 'search' | 'mark-watched' | 'settings' | 'blocked';

export interface WeeklyWatchlistItem {
    tmdbId: number;
    title: string;
    posterUrl: string | null;
    overview: string;
    releaseDate?: string;
    voteAverage?: number;
    genreIds?: number[];
}

export interface WeeklyWatchlist {
    id: number;
    userId: number;
    movies: WeeklyWatchlistItem[];
    tvShows: WeeklyWatchlistItem[];
    tasteProfile: string;
    generatedAt: string;
    weekStart: string;
    weekEnd: string;
}
