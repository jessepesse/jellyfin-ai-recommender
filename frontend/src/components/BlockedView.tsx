/**
 * Blocked Content View
 * Displays blocked movies/TV shows and AI-recommended redemption candidates
 */

import React, { useEffect, useState } from 'react';
import { Ban, RefreshCw } from 'lucide-react';
import { getBlockedItems, getRedemptionCandidates, testRedemption } from '../services/api';
import type { JellyfinItem } from '../types';
import MediaCard from './MediaCard';
import RedemptionCard from './RedemptionCard';
import SkeletonCard from './SkeletonCard';

interface RedemptionCandidate {
    media: JellyfinItem;
    blockedAt: string;
    appealText: string;
    confidence: number;
    reasons: string[];
}

const BlockedView: React.FC = () => {
    const [blockedMovies, setBlockedMovies] = useState<JellyfinItem[]>([]);
    const [blockedTVShows, setBlockedTVShows] = useState<JellyfinItem[]>([]);
    const [redemptionCandidates, setRedemptionCandidates] = useState<RedemptionCandidate[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingRedemption, setLoadingRedemption] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadBlockedContent();
        loadRedemptionCandidates();
    }, []);

    const loadBlockedContent = async () => {
        try {
            setLoading(true);
            const data = await getBlockedItems();
            setBlockedMovies(data.movies || []);
            setBlockedTVShows(data.tvShows || []);
            setError(null);
        } catch (err) {
            console.error('Failed to load blocked content', err);
            setError('Failed to load blocked content');
        } finally {
            setLoading(false);
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

    const handleTestRedemption = async () => {
        try {
            setLoadingRedemption(true);
            const data = await testRedemption();
            setRedemptionCandidates(data.candidates || []);
        } catch (err) {
            console.error('Failed to test redemption', err);
        } finally {
            setLoadingRedemption(false);
        }
    };

    const handleRedemptionComplete = () => {
        // Refresh both lists after redemption action
        loadBlockedContent();
        loadRedemptionCandidates();
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

                        {/* Test Button (DEV ONLY) */}
                        <button
                            onClick={handleTestRedemption}
                            disabled={loadingRedemption}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 ${loadingRedemption ? 'animate-spin' : ''}`} />
                            Test Redemption
                        </button>
                    </div>
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
                                    key={candidate.media.id}
                                    candidate={candidate}
                                    onComplete={handleRedemptionComplete}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Blocked Movies */}
                <div className="mb-12">
                    <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                        🎬 Blocked Movies ({blockedMovies.length})
                    </h2>

                    {loading ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            {[...Array(10)].map((_, i) => (
                                <SkeletonCard key={i} />
                            ))}
                        </div>
                    ) : blockedMovies.length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                            No blocked movies
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            {blockedMovies.map((movie) => (
                                <MediaCard
                                    key={movie.tmdbId}
                                    item={movie}
                                    variant="default"
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Blocked TV Shows */}
                <div>
                    <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                        📺 Blocked TV Shows ({blockedTVShows.length})
                    </h2>

                    {loading ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            {[...Array(10)].map((_, i) => (
                                <SkeletonCard key={i} />
                            ))}
                        </div>
                    ) : blockedTVShows.length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                            No blocked TV shows
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            {blockedTVShows.map((show) => (
                                <MediaCard
                                    key={show.tmdbId}
                                    item={show}
                                    variant="default"
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BlockedView;
