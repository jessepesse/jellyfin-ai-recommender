import type { SharedMediaItem, JellyfinLibrary } from '@jellyfin-ai/types';

export interface JellyfinItem extends SharedMediaItem {
    mediaType: 'movie' | 'tv';
    releaseYear: string;
    posterUrl: string | null;
    overview: string | null;
    backdropUrl: string | null;
    voteAverage: number;
}

export type { JellyfinLibrary };

export interface Settings {
    jellyfinUrl?: string;
    apiKey?: string;
}
