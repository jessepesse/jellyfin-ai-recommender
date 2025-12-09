
import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { Loader2, Film, Tv, Ban, Clock, Sparkles } from 'lucide-react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

interface StatsData {
    stats: {
        movies: number;
        series: number;
        blocked: number;
        totalHours: number;
    };
    genres: Array<{ name: string; value: number }>;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#d0ed57'];

const GENRE_TRANSLATIONS: Record<string, string> = {
    'Seikkailu': 'Adventure',
    'Animaatio': 'Animation',
    'Perhe': 'Family',
    'Fantasia': 'Fantasy',
    'Science fiction': 'Sci-Fi',
    'Toiminta': 'Action',
    'Komedia': 'Comedy',
    'Draama': 'Drama',
    'Rikos': 'Crime',
    'Jännitys': 'Thriller',
    'Kauhu': 'Horror',
    'Dokumentti': 'Documentary',
    'Kotimainen': 'Domestic',
    'Sota': 'War',
    'Historia': 'History',
    'Musiikki': 'Music',
    'Romantiikka': 'Romance',
    'Lännenelokuva': 'Western',
    'Mystuuri': 'Mystery',
    'Urheilu': 'Sports',
    'Elämäkerta': 'Biography',
    'Koko perhe': 'Family',
    'Lapset': 'Kids'
};

const UserStatsModal: React.FC<Props> = ({ isOpen, onClose }) => {
    const { token, user } = useAuth();
    const [data, setData] = useState<StatsData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Profile State
    const [movieProfile, setMovieProfile] = useState<string | null>(null);
    const [seriesProfile, setSeriesProfile] = useState<string | null>(null);
    const [loadingMovieProfile, setLoadingMovieProfile] = useState(false);
    const [loadingSeriesProfile, setLoadingSeriesProfile] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            // Reset state on close
            setData(null);
            setMovieProfile(null);
            setSeriesProfile(null);
            return;
        }
        const fetchStats = async () => {
            setLoading(true);
            setError('');
            try {
                // Prioritize AuthContext user, fallback to localStorage if needed (though AuthContext should handle it)
                const userId = user?.id || localStorage.getItem('userId') || '';
                const username = user?.name || localStorage.getItem('username') || '';

                const res = await axios.get('/api/stats', {
                    headers: {
                        'x-access-token': token,
                        'x-user-id': userId,
                        'x-user-name': username
                    }
                });

                // Translate genres if needed
                if (res.data && res.data.genres) {
                    res.data.genres = res.data.genres.map((g: { name: string; value: number }) => ({
                        ...g,
                        name: GENRE_TRANSLATIONS[g.name] || g.name
                    })).sort((a: { value: number }, b: { value: number }) => b.value - a.value); // Sort descending for chart
                }

                setData(res.data);
            } catch (err: unknown) {
                console.error('Failed to fetch stats', err);
                const error = err as { response?: { data?: { error?: string } } };
                setError(error.response?.data?.error || 'Failed to load statistics.');
            } finally {
                setLoading(false);
            }
        };

        if (isOpen && token) {
            fetchStats();
        } else if (isOpen && !token) {
            setError('Please log in to view statistics.');
        }
    }, [isOpen, token, user]);

    // Fetch Profiles Effect
    useEffect(() => {
        const fetchProfile = async (type: 'movie' | 'tv') => {
            if (type === 'movie') setLoadingMovieProfile(true);
            else setLoadingSeriesProfile(true);

            try {
                const userId = user?.id || localStorage.getItem('userId') || '';
                const username = user?.name || localStorage.getItem('username') || '';

                const res = await axios.get(`/api/stats/profile?type=${type}`, {
                    headers: {
                        'x-access-token': token,
                        'x-user-id': userId,
                        'x-user-name': username
                    }
                });

                if (type === 'movie') setMovieProfile(res.data.profile);
                else setSeriesProfile(res.data.profile);

            } catch (err) {
                console.error(`Failed to fetch ${type} profile`, err);
            } finally {
                if (type === 'movie') setLoadingMovieProfile(false);
                else setLoadingSeriesProfile(false);
            }
        };

        if (isOpen && data && token) {
            // Only fetch if we haven't already (simple check)
            if (!movieProfile && !loadingMovieProfile) fetchProfile('movie');
            if (!seriesProfile && !loadingSeriesProfile) fetchProfile('tv');
        }
    }, [isOpen, data, token, user, movieProfile, seriesProfile, loadingMovieProfile, loadingSeriesProfile]);


    return (
        <Modal isOpen={isOpen} onClose={onClose} title="User Statistics">
            <div className="p-4 md:p-6 min-h-[500px]">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
                    </div>
                ) : error ? (
                    <div className="flex items-center justify-center h-64 text-red-400">
                        {error}
                    </div>
                ) : data ? (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

                        {/* Hero Stats Cards */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="bg-gradient-to-br from-cyan-900/30 to-slate-900/50 p-5 rounded-2xl border border-cyan-500/20 flex flex-col items-center justify-center text-center shadow-lg hover:border-cyan-500/40 transition-colors">
                                <div className="p-3 bg-cyan-500/10 rounded-full mb-3">
                                    <Film className="w-8 h-8 text-cyan-400" />
                                </div>
                                <div className="text-4xl font-bold text-white mb-1">{data.stats.movies}</div>
                                <div className="text-xs font-medium text-cyan-200/70 uppercase tracking-widest">Movies</div>
                            </div>

                            <div className="bg-gradient-to-br from-violet-900/30 to-slate-900/50 p-5 rounded-2xl border border-violet-500/20 flex flex-col items-center justify-center text-center shadow-lg hover:border-violet-500/40 transition-colors">
                                <div className="p-3 bg-violet-500/10 rounded-full mb-3">
                                    <Tv className="w-8 h-8 text-violet-400" />
                                </div>
                                <div className="text-4xl font-bold text-white mb-1">{data.stats.series}</div>
                                <div className="text-xs font-medium text-violet-200/70 uppercase tracking-widest">Series</div>
                            </div>

                            <div className="bg-gradient-to-br from-amber-900/30 to-slate-900/50 p-5 rounded-2xl border border-amber-500/20 flex flex-col items-center justify-center text-center shadow-lg hover:border-amber-500/40 transition-colors">
                                <div className="p-3 bg-amber-500/10 rounded-full mb-3">
                                    <Clock className="w-8 h-8 text-amber-400" />
                                </div>
                                <div className="text-4xl font-bold text-white mb-1">{data.stats.totalHours}</div>
                                <div className="text-xs font-medium text-amber-200/70 uppercase tracking-widest">Hours</div>
                            </div>

                            <div className="bg-gradient-to-br from-red-900/30 to-slate-900/50 p-5 rounded-2xl border border-red-500/20 flex flex-col items-center justify-center text-center shadow-lg hover:border-red-500/40 transition-colors">
                                <div className="p-3 bg-red-500/10 rounded-full mb-3">
                                    <Ban className="w-8 h-8 text-red-400" />
                                </div>
                                <div className="text-4xl font-bold text-white mb-1">{data.stats.blocked}</div>
                                <div className="text-xs font-medium text-red-200/70 uppercase tracking-widest">Blocked</div>
                            </div>
                        </div>

                        {/* Charts Section - Horizontal Bar Chart */}
                        <div className="bg-gradient-to-b from-slate-800/20 to-slate-900/20 p-6 rounded-2xl border border-white/5 backdrop-blur-sm">
                            <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                                <span className="w-1 h-6 bg-cyan-500 rounded-full"></span>
                                Top Genres
                            </h3>
                            <div className="h-[400px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        layout="vertical"
                                        data={data.genres.slice(0, 10)} // Top 10 only
                                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={true} vertical={false} />
                                        <XAxis type="number" stroke="#94a3b8" />
                                        <YAxis
                                            dataKey="name"
                                            type="category"
                                            stroke="#94a3b8"
                                            width={100}
                                            tick={{ fill: '#e2e8f0', fontSize: 13 }}
                                        />
                                        <RechartsTooltip
                                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                                            itemStyle={{ color: '#67e8f9' }}
                                        />
                                        <Bar dataKey="value" fill="#06b6d4" radius={[0, 4, 4, 0]} barSize={20}>
                                            {data.genres.map((_entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* AI Taste Profile Section */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6">
                            {/* Movie Taste */}
                            <div className="bg-gradient-to-br from-purple-900/20 to-slate-900/40 p-6 rounded-2xl border border-purple-500/20 backdrop-blur-sm relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-4 opacity-50 group-hover:opacity-100 transition-opacity">
                                    <Sparkles className="w-5 h-5 text-purple-400" />
                                </div>
                                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                    <Film className="w-5 h-5 text-purple-400" />
                                    Movie Taste
                                </h3>

                                {loadingMovieProfile ? (
                                    <div className="space-y-3 animate-pulse">
                                        <div className="h-2 bg-purple-500/20 rounded w-3/4"></div>
                                        <div className="h-2 bg-purple-500/20 rounded w-full"></div>
                                        <div className="h-2 bg-purple-500/20 rounded w-5/6"></div>
                                    </div>
                                ) : (
                                    <div className="text-slate-300 text-sm leading-relaxed">
                                        {movieProfile ? (
                                            <ul className="list-disc list-inside space-y-1">
                                                {movieProfile.split('\n').map((line, i) => (
                                                    <li key={i} className="pl-1">{line.replace(/^[*•-]\s*/, '')}</li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <span className="italic opacity-50">Analyzing movie history...</span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Series Taste */}
                            <div className="bg-gradient-to-br from-indigo-900/20 to-slate-900/40 p-6 rounded-2xl border border-indigo-500/20 backdrop-blur-sm relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-4 opacity-50 group-hover:opacity-100 transition-opacity">
                                    <Sparkles className="w-5 h-5 text-indigo-400" />
                                </div>
                                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                    <Tv className="w-5 h-5 text-indigo-400" />
                                    Series Taste
                                </h3>

                                {loadingSeriesProfile ? (
                                    <div className="space-y-3 animate-pulse">
                                        <div className="h-2 bg-indigo-500/20 rounded w-3/4"></div>
                                        <div className="h-2 bg-indigo-500/20 rounded w-full"></div>
                                        <div className="h-2 bg-indigo-500/20 rounded w-5/6"></div>
                                    </div>
                                ) : (
                                    <div className="text-slate-300 text-sm leading-relaxed">
                                        {seriesProfile ? (
                                            <ul className="list-disc list-inside space-y-1">
                                                {seriesProfile.split('\n').map((line, i) => (
                                                    <li key={i} className="pl-1">{line.replace(/^[*•-]\s*/, '')}</li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <span className="italic opacity-50">Analyzing series history...</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                ) : null}
            </div>
        </Modal >
    );
};

export default UserStatsModal;
