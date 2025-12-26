import React from 'react';
import type { UserStatistics } from '../services/api';
import { Users, Activity, Film, List, Ban, Calendar, Sparkles } from 'lucide-react';

interface UserStatisticsCardProps {
    user: UserStatistics;
}

const UserStatisticsCard: React.FC<UserStatisticsCardProps> = ({ user }) => {
    const formatTimeAgo = (dateString: string): string => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor(diffMs / (1000 * 60));

        if (diffMinutes < 60) return `${diffMinutes}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays === 1) return '1d ago';
        return `${diffDays}d ago`;
    };

    const formatDate = (dateString: string): string => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    return (
        <div className={`bg-gradient-to-br ${user.isActive ? 'from-slate-800/50 to-cyan-900/20' : 'from-slate-800/50 to-slate-900/20'} rounded-xl p-6 border ${user.isActive ? 'border-cyan-500/20' : 'border-slate-700/50'}`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${user.isActive ? 'bg-green-500' : 'bg-red-500'} shadow-lg ${user.isActive ? 'shadow-green-500/50' : 'shadow-red-500/50'}`} />
                    <h3 className="text-xl font-bold text-white">{user.username}</h3>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Activity className="w-4 h-4" />
                    <span>{formatTimeAgo(user.lastActivity)}</span>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-slate-900/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                        <Film className="w-4 h-4" />
                        <span>Watched</span>
                    </div>
                    <div className="text-2xl font-bold text-white">{user.stats.watched}</div>
                </div>

                <div className="bg-slate-900/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                        <List className="w-4 h-4" />
                        <span>Watchlist</span>
                    </div>
                    <div className="text-2xl font-bold text-white">{user.stats.watchlist}</div>
                </div>

                <div className="bg-slate-900/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                        <Ban className="w-4 h-4" />
                        <span>Blocked</span>
                    </div>
                    <div className="text-2xl font-bold text-white">{user.stats.blocked}</div>
                </div>

                <div className="bg-slate-900/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                        <Users className="w-4 h-4" />
                        <span>Total</span>
                    </div>
                    <div className="text-2xl font-bold text-white">{user.stats.total}</div>
                </div>
            </div>

            {/* AI Features Status */}
            <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between text-slate-400">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        <span>Weekly Picks:</span>
                    </div>
                    <span className={user.aiFeatures.weeklyPicks ? 'text-green-400' : 'text-slate-500'}>
                        {user.aiFeatures.weeklyPicks
                            ? `${user.aiFeatures.weeklyPicks.daysOld.toFixed(1)}d old`
                            : 'Not generated'
                        }
                    </span>
                </div>

                <div className="flex items-center justify-between text-slate-400">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        <span>Redemption:</span>
                    </div>
                    <span className={user.aiFeatures.redemptionCandidates ? 'text-green-400' : 'text-slate-500'}>
                        {user.aiFeatures.redemptionCandidates
                            ? `${user.aiFeatures.redemptionCandidates.daysOld.toFixed(1)}d old`
                            : 'No candidates'
                        }
                    </span>
                </div>
            </div>

            {/* Footer */}
            <div className="mt-4 pt-4 border-t border-slate-700/50 flex items-center gap-2 text-xs text-slate-500">
                <Calendar className="w-3 h-3" />
                <span>Joined {formatDate(user.createdAt)}</span>
            </div>
        </div>
    );
};

export default UserStatisticsCard;
