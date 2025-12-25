
import React, { useEffect, useState } from 'react';
import { Calendar, Sparkles, TrendingUp, Tv } from 'lucide-react';
import { getWeeklyWatchlist } from '../services/api';
import type { WeeklyWatchlist as IWeeklyWatchlist, WeeklyWatchlistItem } from '../types';
import type { JellyfinItem } from '../types';
import MediaCard from './MediaCard';
import SkeletonCard from './SkeletonCard';
import { format, parseISO } from 'date-fns';

const WeeklyWatchlist: React.FC = () => {
    const [watchlist, setWatchlist] = useState<IWeeklyWatchlist | null>(null);
    const [loading, setLoading] = useState(true);

    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadWatchlist();
    }, []);

    const loadWatchlist = async () => {
        try {
            setLoading(true);
            const data = await getWeeklyWatchlist();
            setWatchlist(data);
            setError(null);
        } catch (err) {
            console.error('Failed to load weekly watchlist', err);
            setWatchlist(null);
        } finally {
            setLoading(false);
        }
    };



    // Helper to map WeeklyWatchlistItem to JellyfinItem for MediaCard
    const mapToJellyfinItem = (item: WeeklyWatchlistItem, type: 'movie' | 'tv'): JellyfinItem => {
        return {
            Id: `tmdb-${item.tmdbId}`,
            Name: item.title,
            Type: type === 'movie' ? 'Movie' : 'Series',
            mediaType: type,
            tmdbId: item.tmdbId,
            title: item.title,
            posterUrl: item.posterUrl,
            overview: item.overview,
            releaseYear: item.releaseDate ? item.releaseDate.substring(0, 4) : 'Unknown',
            voteAverage: item.voteAverage || 0,
            backdropUrl: null,
            UserData: { Played: false, UnplayedItemCount: 1, PlaybackPositionTicks: 0, IsFavorite: false },
        } as JellyfinItem;
    };

    // Remove item from local state when user takes an action
    const handleRemove = (tmdbId?: number) => {
        if (!tmdbId || !watchlist) return;
        setWatchlist(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                movies: prev.movies.filter(m => m.tmdbId !== tmdbId),
                tvShows: prev.tvShows.filter(t => t.tmdbId !== tmdbId),
            };
        });
    };

    if (loading && !watchlist) {
        return (
            <div className="space-y-8">
                {/* Loading skeleton for header */}
                <div className="h-32 animate-pulse bg-slate-800/50 rounded-xl" />
                {/* Loading skeleton for grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-6">
                    {Array.from({ length: 10 }).map((_, idx) => (
                        <SkeletonCard key={`skeleton-${idx}`} />
                    ))}
                </div>
            </div>
        );
    }

    if (!watchlist && !loading && !error) {
        // Empty state - show generate button
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <div className="text-center p-8 bg-slate-900/50 rounded-2xl border border-slate-700/50 max-w-md">
                    <Sparkles className="w-12 h-12 text-purple-400 mx-auto mb-4" />
                    <h3 className="text-2xl font-bold text-white mb-2">Weekly Picks</h3>
                    <p className="text-slate-400 mb-6">
                        Get personalized recommendations for the week based on your unique taste.
                    </p>
                    <button
                        onClick={handleRefresh}
                        disabled={refreshing}
                        className="flex items-center gap-2 mx-auto bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-8 py-3 rounded-xl transition-all shadow-lg shadow-purple-500/20"
                    >
                        {refreshing ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                        <span className="font-semibold">{refreshing ? 'Generating...' : 'Generate My Picks'}</span>
                    </button>
                </div>
            </div>
        );
    }

    if (!watchlist) return null;

    const startDate = parseISO(watchlist.weekStart);
    const endDate = parseISO(watchlist.weekEnd);
    const dateRange = `${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d')}`;

    return (
        <div className="space-y-8">
            {/* Header Section */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-900/40 to-blue-900/40 border border-white/10 p-6 md:p-8">
                <div className="relative z-10">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                        <div>
                            <div className="flex items-center gap-2 text-purple-300 font-medium mb-1">
                                <Calendar className="w-4 h-4" />
                                <span className="uppercase tracking-wider text-xs">Week of {dateRange}</span>
                            </div>
                            <h2 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Sparkles className="w-6 h-6 text-purple-400" />
                                Weekly Picks
                            </h2>
                        </div>
                    </div>

                    {/* Taste Profile Quote */}
                    <div className="bg-black/30 backdrop-blur-md rounded-xl p-4 border-l-4 border-purple-500">
                        <p className="text-slate-200 italic font-medium leading-relaxed">
                            "{watchlist.tasteProfile}"
                        </p>
                    </div>
                </div>

                {/* Decorative Background Elements */}
                <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>
                <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
            </div>

            {/* Movies Section - Grid Layout */}
            {watchlist.movies.length > 0 && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-white px-2 border-l-4 border-blue-500">
                        <TrendingUp className="w-5 h-5 text-blue-400" />
                        <h3 className="text-xl font-semibold">Movies for You</h3>
                        <span className="text-slate-500 text-sm">({watchlist.movies.length})</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-6">
                        {watchlist.movies.map((item) => (
                            <MediaCard
                                key={item.tmdbId}
                                item={mapToJellyfinItem(item, 'movie')}
                                variant="search"
                                onRemove={handleRemove}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* TV Shows Section - Grid Layout */}
            {watchlist.tvShows.length > 0 && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-white px-2 border-l-4 border-pink-500">
                        <Tv className="w-5 h-5 text-pink-400" />
                        <h3 className="text-xl font-semibold">TV Shows to Binge</h3>
                        <span className="text-slate-500 text-sm">({watchlist.tvShows.length})</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-6">
                        {watchlist.tvShows.map((item) => (
                            <MediaCard
                                key={item.tmdbId}
                                item={mapToJellyfinItem(item, 'tv')}
                                variant="search"
                                onRemove={handleRemove}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default WeeklyWatchlist;
