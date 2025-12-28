/**
 * Blocked Content View
 * Displays blocked movies/TV shows and AI-recommended redemption candidates
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Ban } from 'lucide-react';
import { getBlockedItems, getRedemptionCandidates } from '../services/api';
import type { JellyfinItem } from '../types';
import MediaCard from './MediaCard';
import RedemptionCard from './RedemptionCard';
import SkeletonCard from './SkeletonCard';
import FilterGroup from './FilterGroup';

interface RedemptionCandidate {
    media: JellyfinItem;
    blockedAt: string;
    appealText: string;
    confidence: number;
    reasons: string[];
}

type FilterType = 'all' | 'movie' | 'tv';

const BlockedView: React.FC = () => {
    const [blockedMovies, setBlockedMovies] = useState<JellyfinItem[]>([]);
    const [blockedTVShows, setBlockedTVShows] = useState<JellyfinItem[]>([]);
    const [redemptionCandidates, setRedemptionCandidates] = useState<RedemptionCandidate[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<FilterType>('all');

    useEffect(() => {
        loadBlockedContent();
        loadRedemptionCandidates();

        // Listen for global blocked content changes
        const handler = () => {
            loadBlockedContent(true);
            loadRedemptionCandidates();
        };
        window.addEventListener('blocked:changed', handler as EventListener);

        return () => {
            window.removeEventListener('blocked:changed', handler as EventListener);
        };
    }, []);

    const loadBlockedContent = async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const data = await getBlockedItems();
            setBlockedMovies(data.movies || []);
            setBlockedTVShows(data.tvShows || []);
            setError(null);
        } catch (err) {
            console.error('Failed to load blocked content', err);
            setError('Failed to load blocked content');
        } finally {
            if (!silent) setLoading(false);
        }
    };

    const loadRedemptionCandidates = async () => {
        try {
            const data = await getRedemptionCandidates();
            setRedemptionCandidates(data.candidates || []);
        } catch (err) {
            console.error('Failed to load redemption candidates', err);
        }
    };

    // Filtered items based on current filter
    const filteredMovies = useMemo(() => {
        if (filter === 'tv') return [];
        return blockedMovies;
    }, [blockedMovies, filter]);

    const filteredTVShows = useMemo(() => {
        if (filter === 'movie') return [];
        return blockedTVShows;
    }, [blockedTVShows, filter]);

    const handleRedemptionComplete = (mediaId: number) => {
        console.log('[BlockedView] Redemption complete for media:', mediaId);

        // Optimistically remove the card from UI immediately
        setRedemptionCandidates(prev => prev.filter(c => String(c.media.tmdbId) !== String(mediaId)));

        // Refresh both lists after redemption action (in background)
        loadBlockedContent(true);
        loadRedemptionCandidates();

        // Dispatch event so other components know blocked content changed
        window.dispatchEvent(new CustomEvent('blocked:changed'));
    };

    const handleMediaUnblocked = (tmdbId?: number) => {
        if (!tmdbId) return;
        console.log('[BlockedView] Media unblocked:', tmdbId);

        // Optimistically remove from both lists
        // Use String comparison to be safe against type mismatches
        setBlockedMovies(prev => prev.filter(m => String(m.tmdbId) !== String(tmdbId)));
        setBlockedTVShows(prev => prev.filter(s => String(s.tmdbId) !== String(tmdbId)));

        // Refresh in background
        loadBlockedContent(true);

        // Dispatch event so other components know blocked content changed
        window.dispatchEvent(new CustomEvent('blocked:changed'));
    };

    if (error) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <Ban className="w-16 h-16 text-red-500 mx-auto mb-4" />
                    <p className="text-xl text-white">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-4xl font-bold text-white flex items-center gap-3">
                                <Ban className="w-8 h-8 text-red-400" />
                                Blocked Content
                            </h1>
                            <p className="text-slate-400 mt-2">
                                Manage your blocked movies and TV shows
                            </p>
                        </div>
                    </div>
                </div>

                {/* Filter */}
                <div className="mb-6">
                    <FilterGroup
                        chips={[
                            { id: 'all', label: 'All', active: filter === 'all' },
                            { id: 'movie', label: 'Movies', active: filter === 'movie' },
                            { id: 'tv', label: 'TV Shows', active: filter === 'tv' }
                        ]}
                        onToggle={(id) => setFilter(id as FilterType)}
                    />
                </div>

                {/* Redemption Candidates */}
                {redemptionCandidates.length > 0 && (
                    <div className="mb-12">
                        <div className="mb-6">
                            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                                ⚖️ Redemption Candidates
                            </h2>
                            <p className="text-slate-400 mt-1">
                                I think you should reconsider these
                            </p>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                            {redemptionCandidates.map((candidate) => (
                                <RedemptionCard
                                    key={candidate.media.tmdbId}
                                    candidate={candidate}
                                    onComplete={handleRedemptionComplete}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Blocked Movies */}
                {(filter === 'all' || filter === 'movie') && (
                    <div className="mb-12">
                        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                            🎬 Blocked Movies ({filteredMovies.length})
                        </h2>

                        {loading ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {[...Array(10)].map((_, i) => (
                                    <SkeletonCard key={i} />
                                ))}
                            </div>
                        ) : filteredMovies.length === 0 ? (
                            <div className="text-center py-12 text-slate-400">
                                No blocked movies
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {filteredMovies.map((movie) => (
                                    <MediaCard
                                        key={movie.tmdbId}
                                        item={movie}
                                        onRemove={handleMediaUnblocked}
                                        variant="blocked"
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Blocked TV Shows */}
                {(filter === 'all' || filter === 'tv') && (
                    <div>
                        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                            📺 Blocked TV Shows ({filteredTVShows.length})
                        </h2>

                        {loading ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {[...Array(10)].map((_, i) => (
                                    <SkeletonCard key={i} />
                                ))}
                            </div>
                        ) : filteredTVShows.length === 0 ? (
                            <div className="text-center py-12 text-slate-400">
                                No blocked TV shows
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {filteredTVShows.map((show) => (
                                    <MediaCard
                                        key={show.tmdbId}
                                        item={show}
                                        onRemove={handleMediaUnblocked}
                                        variant="blocked"
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default BlockedView;
