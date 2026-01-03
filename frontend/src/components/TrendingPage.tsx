/**
 * TrendingPage - Shows trending movies and TV shows from Jellyseerr
 * Filters out already watched/watchlisted/blocked/requested content
 */

import React, { useEffect, useState } from 'react';
import { TrendingUp, Film, Tv, RefreshCw, AlertCircle } from 'lucide-react';
import MediaCard from './MediaCard';
import SkeletonCard from './SkeletonCard';
import FilterGroup from './FilterGroup';
import type { JellyfinItem } from '../types';
import { getTrending } from '../services/api';

interface TrendingItem {
    id: number;
    title?: string;
    name?: string;
    overview: string;
    posterPath: string | null;
    backdropPath: string | null;
    mediaType: 'movie' | 'tv';
    releaseDate?: string;
    firstAirDate?: string;
    voteAverage: number;
    genres?: string[];
}

interface TrendingResponse {
    movies: TrendingItem[];
    tvShows: TrendingItem[];
}

const TrendingPage: React.FC = () => {
    const [data, setData] = useState<TrendingResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'movies' | 'tv'>('all');

    useEffect(() => {
        loadTrending();
    }, []);

    const loadTrending = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await getTrending();
            setData(response);
        } catch (err: unknown) {
            console.error('Failed to load trending', err);
            const errorMessage = err && typeof err === 'object' && 'response' in err &&
                err.response && typeof err.response === 'object' && 'data' in err.response &&
                err.response.data && typeof err.response.data === 'object' && 'error' in err.response.data
                ? String(err.response.data.error)
                : 'Failed to load trending content';
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    // Map trending item to JellyfinItem for MediaCard
    const mapToJellyfinItem = (item: TrendingItem): JellyfinItem => {
        const title = item.title || item.name || 'Unknown';
        const releaseDate = item.releaseDate || item.firstAirDate;
        const posterUrl = item.posterPath
            ? `https://image.tmdb.org/t/p/w500${item.posterPath}`
            : null;
        const backdropUrl = item.backdropPath
            ? `https://image.tmdb.org/t/p/w780${item.backdropPath}`
            : null;

        return {
            Id: `tmdb-${item.id}`,
            Name: title,
            Type: item.mediaType === 'movie' ? 'Movie' : 'Series',
            mediaType: item.mediaType,
            tmdbId: item.id,
            title: title,
            posterUrl: posterUrl,
            overview: item.overview,
            releaseYear: releaseDate ? releaseDate.substring(0, 4) : 'Unknown',
            voteAverage: item.voteAverage || 0,
            backdropUrl: backdropUrl,
            genres: item.genres,
            UserData: { Played: false, UnplayedItemCount: 1, PlaybackPositionTicks: 0, IsFavorite: false },
        } as JellyfinItem;
    };

    // Remove item from local state after action
    const handleRemove = (tmdbId?: number) => {
        if (!tmdbId || !data) return;
        setData(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                movies: prev.movies.filter(m => m.id !== tmdbId),
                tvShows: prev.tvShows.filter(t => t.id !== tmdbId),
            };
        });
    };

    if (loading) {
        return (
            <div className="space-y-8 p-4 md:p-6">
                <div className="h-16 animate-pulse bg-slate-800/50 rounded-xl" />
                <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
                    {Array.from({ length: 12 }).map((_, idx) => (
                        <SkeletonCard key={`skeleton-${idx}`} />
                    ))}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center p-4">
                <div className="text-center p-8 bg-red-900/20 rounded-2xl border border-red-500/30 max-w-md">
                    <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">Error Loading Trending</h2>
                    <p className="text-slate-400 mb-4">{error}</p>
                    <button
                        onClick={loadTrending}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center gap-2 mx-auto"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    const hasMovies = data && data.movies.length > 0;
    const hasTvShows = data && data.tvShows.length > 0;

    if (!hasMovies && !hasTvShows) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center p-4">
                <div className="text-center p-8 bg-slate-900/50 rounded-2xl border border-slate-700/50 max-w-md">
                    <TrendingUp className="w-12 h-12 text-purple-400 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">No New Trending Content</h2>
                    <p className="text-slate-400">
                        All trending items have been filtered out - you've already watched, requested, or blocked them!
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 p-4 md:p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl">
                        <TrendingUp className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold text-white">Trending</h1>
                        <p className="text-sm text-slate-400">What's popular right now</p>
                    </div>
                </div>

            </div>

            {/* Filter Tabs */}
            <FilterGroup
                chips={[
                    { id: 'all', label: 'All', active: filter === 'all' },
                    { id: 'movies', label: 'Movies', active: filter === 'movies' },
                    { id: 'tv', label: 'TV Shows', active: filter === 'tv' }
                ]}
                onToggle={(id) => setFilter(id as 'all' | 'movies' | 'tv')}
            />

            {/* Movies Section */}
            {hasMovies && (filter === 'all' || filter === 'movies') && (
                <section>
                    <div className="flex items-center gap-2 mb-4">
                        <Film className="w-5 h-5 text-purple-400" />
                        <h2 className="text-xl font-semibold text-white">Movies</h2>
                        <span className="text-sm text-slate-500">({data.movies.length})</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
                        {data.movies.map(item => (
                            <MediaCard
                                key={item.id}
                                item={mapToJellyfinItem(item)}
                                onRemove={() => handleRemove(item.id)}
                            />
                        ))}
                    </div>
                </section>
            )}

            {/* TV Shows Section */}
            {hasTvShows && (filter === 'all' || filter === 'tv') && (
                <section>
                    <div className="flex items-center gap-2 mb-4">
                        <Tv className="w-5 h-5 text-blue-400" />
                        <h2 className="text-xl font-semibold text-white">TV Shows</h2>
                        <span className="text-sm text-slate-500">({data.tvShows.length})</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
                        {data.tvShows.map(item => (
                            <MediaCard
                                key={item.id}
                                item={mapToJellyfinItem(item)}
                                onRemove={() => handleRemove(item.id)}
                            />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
};

export default TrendingPage;
