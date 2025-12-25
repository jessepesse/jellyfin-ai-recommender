/**
 * Redemption Card Component
 * Displays AI-recommended blocked content with appeal and action buttons
 */

import React, { useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { unblockItem, keepBlocked } from '../services/api';
import type { RedemptionCandidate } from '../services/api';

interface RedemptionCardProps {
    candidate: RedemptionCandidate;
    onComplete: () => void;
}

const RedemptionCard: React.FC<RedemptionCardProps> = ({ candidate, onComplete }) => {
    const [showUnblockMenu, setShowUnblockMenu] = useState(false);
    const [showKeepBlockedMenu, setShowKeepBlockedMenu] = useState(false);
    const [processing, setProcessing] = useState(false);

    const handleUnblock = async (action: 'watchlist' | 'jellyseerr' | 'watched') => {
        try {
            setProcessing(true);
            await unblockItem(candidate.media.id, action);
            onComplete();
        } catch (error) {
            console.error('Failed to unblock', error);
        } finally {
            setProcessing(false);
        }
    };

    const handleKeepBlocked = async (type: 'soft' | 'permanent') => {
        try {
            setProcessing(true);
            await keepBlocked(candidate.media.id, type);
            onComplete();
        } catch (error) {
            console.error('Failed to keep blocked', error);
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div className="bg-gradient-to-br from-slate-800/50 to-purple-900/20 rounded-xl p-6 border border-white/10">
            <div className="flex gap-6">
                {/* Poster */}
                <div className="flex-shrink-0">
                    <img
                        src={candidate.media.posterUrl || '/placeholder.png'}
                        alt={candidate.media.title}
                        className="w-32 h-48 object-cover rounded-lg"
                    />
                </div>

                {/* Content */}
                <div className="flex-1">
                    <h3 className="text-2xl font-bold text-white mb-2">
                        {candidate.media.title}
                    </h3>

                    <div className="flex items-center gap-3 text-sm text-slate-400 mb-4">
                        <span>⭐ {candidate.media.voteAverage?.toFixed(1) || 'N/A'}</span>
                        <span>•</span>
                        <span>{candidate.media.releaseYear || 'Unknown'}</span>
                        <span>•</span>
                        <span className="px-2 py-0.5 bg-purple-600/30 rounded text-purple-300">
                            {candidate.confidence}% confidence
                        </span>
                    </div>

                    {/* AI Appeal */}
                    <div className="bg-black/30 backdrop-blur-sm rounded-lg p-4 mb-6 border-l-4 border-purple-500">
                        <p className="text-slate-200 italic leading-relaxed">
                            "{candidate.appealText}"
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3">
                        {!showUnblockMenu && !showKeepBlockedMenu && (
                            <>
                                <button
                                    onClick={() => setShowUnblockMenu(true)}
                                    disabled={processing}
                                    className="flex items-center gap-2 px-6 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors disabled:opacity-50"
                                >
                                    <CheckCircle className="w-4 h-4" />
                                    Unblock
                                </button>
                                <button
                                    onClick={() => setShowKeepBlockedMenu(true)}
                                    disabled={processing}
                                    className="flex items-center gap-2 px-6 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
                                >
                                    <XCircle className="w-4 h-4" />
                                    Keep Blocked
                                </button>
                            </>
                        )}

                        {/* Unblock Menu */}
                        {showUnblockMenu && (
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleUnblock('watchlist')}
                                    disabled={processing}
                                    className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm transition-colors disabled:opacity-50"
                                >
                                    📋 Add to Watchlist
                                </button>
                                <button
                                    onClick={() => handleUnblock('jellyseerr')}
                                    disabled={processing}
                                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors disabled:opacity-50"
                                >
                                    🎬 Request in Jellyseerr
                                </button>
                                <button
                                    onClick={() => handleUnblock('watched')}
                                    disabled={processing}
                                    className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-sm transition-colors disabled:opacity-50"
                                >
                                    ✅ Mark as Watched
                                </button>
                                <button
                                    onClick={() => setShowUnblockMenu(false)}
                                    className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-700 text-white text-sm transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        )}

                        {/* Keep Blocked Menu */}
                        {showKeepBlockedMenu && (
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleKeepBlocked('soft')}
                                    disabled={processing}
                                    className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-sm transition-colors disabled:opacity-50"
                                >
                                    😐 Still not interested (6 months)
                                </button>
                                <button
                                    onClick={() => handleKeepBlocked('permanent')}
                                    disabled={processing}
                                    className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-white text-sm transition-colors disabled:opacity-50"
                                >
                                    🚫 Never show again
                                </button>
                                <button
                                    onClick={() => setShowKeepBlockedMenu(false)}
                                    className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-700 text-white text-sm transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RedemptionCard;
