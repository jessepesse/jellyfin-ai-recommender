import React, { useState } from 'react';
import ItemList from './ItemList';
import type { JellyfinItem } from '../types';
import { getRecommendations } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import WatchlistView from './WatchlistView';
import ManualSearchView from './ManualSearchView';
import SettingsView from './SettingsView';
import Footer from './Footer';
import SegmentedControl from './SegmentedControl';
import FilterGroup from './FilterGroup';
import HeroButton from './HeroButton';

import WeeklyWatchlist from './WeeklyWatchlist';
import TrendingPage from './TrendingPage';
import BlockedView from './BlockedView';

// Official TMDB genre names for proper matching with enriched data
const GENRES = [
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
  'Documentary', 'Drama', 'Fantasy', 'Horror', 'Mystery',
  'Romance', 'Science Fiction', 'Thriller', 'War', 'Western'
];

const MOODS = [
  { id: 'chill', label: 'Chill & Comfort 🛋️' },
  { id: 'mind-bending', label: 'Mind Bending 🤯' },
  { id: 'dark', label: 'Dark & Gritty 🌑' },
  { id: 'adrenaline', label: 'Adrenaline 🔥' },
  { id: 'feel-good', label: 'Feel Good ✨' },
  { id: 'tearjerker', label: 'Tearjerker 😢' },
  { id: 'visual', label: 'Visual / Epic 🎨' },
];
const YEAR_MIN = 1900;
const YEAR_MAX = 2026;
const YEAR_STEP = 10;
const YEAR_TICKS = Array.from({ length: Math.floor((YEAR_MAX - YEAR_MIN) / YEAR_STEP) + 1 }, (_, i) => YEAR_MIN + i * YEAR_STEP);

interface Props {
  currentView?: 'recommendations' | 'weekly-picks' | 'trending' | 'watchlist' | 'search' | 'mark-watched' | 'settings' | 'blocked';
}

const Dashboard: React.FC<Props> = ({ currentView = 'recommendations' }) => {
  const { user } = useAuth();
  const [selectedType, setSelectedType] = useState<'movie' | 'tv'>('movie');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [selectedYearFrom, setSelectedYearFrom] = useState<number>(YEAR_MIN);
  const [selectedYearTo, setSelectedYearTo] = useState<number>(YEAR_MAX);
  const [isLoading, setIsLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<JellyfinItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const toggleGenre = (g: string) => {
    setSelectedGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  };

  const toggleMood = (m: string) => {
    setSelectedMood(prev => prev === m ? null : m);
  };

  const handleYearFromChange = (value: number) => {
    const normalized = Math.max(YEAR_MIN, Math.min(YEAR_MAX, value));
    setSelectedYearFrom(normalized);
    if (normalized > selectedYearTo) {
      setSelectedYearTo(normalized);
    }
  };

  const handleYearToChange = (value: number) => {
    const normalized = Math.max(YEAR_MIN, Math.min(YEAR_MAX, value));
    setSelectedYearTo(normalized);
    if (normalized < selectedYearFrom) {
      setSelectedYearFrom(normalized);
    }
  };

  const handleGetRecommendations = React.useCallback(async (refresh: boolean = true) => {
    setError(null);
    setIsLoading(true);
    try {
      const genreParam = selectedGenres.join(',') || undefined;
      // Build params object conditionally so we don't send undefined/null path/query values
      const params: Record<string, string | number | boolean | undefined> = {};
      if (selectedType) params.type = selectedType;
      if (genreParam) params.genre = genreParam;
      if (selectedMood) params.mood = selectedMood;
      params.yearFrom = selectedYearFrom;
      params.yearTo = selectedYearTo;
      params.refresh = refresh;

      // getRecommendations signature is (targetItemId, libraryId, options)
      // We intentionally omit targetItemId and libraryId for general recommendations.
      const recs = await getRecommendations('', '', params);
      // Log raw API response for debugging in browser console
      // Avoid logging raw API responses in production (may contain PII)
      // console.log('Recommendations API response:', recs);

      // Backend guarantees strict items with tmdbId and posterUrl. Use them directly.
      let itemsArray: JellyfinItem[] = [];
      if (Array.isArray(recs)) itemsArray = recs;
      else if (recs && Array.isArray((recs as { data: JellyfinItem[] }).data)) itemsArray = (recs as { data: JellyfinItem[] }).data;

      setRecommendations(itemsArray);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err.response?.data?.error || err.message || 'Failed to fetch recommendations');
    } finally {
      setIsLoading(false);
    }
  }, [selectedType, selectedGenres, selectedMood, selectedYearFrom, selectedYearTo]);

  // Load cached recommendations on mount if viewing recommendations page
  React.useEffect(() => {
    if (currentView === 'recommendations') {
      handleGetRecommendations(false);
    }
  }, [currentView, handleGetRecommendations]);

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto flex flex-col h-full pb-30">
      <div className="flex-grow">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-slate-400">
              Jellyfin AI Recommender
            </h1>
            <p className="text-sm text-slate-500 mt-1">Personalized recommendations for your library</p>
          </div>
        </header>

        {currentView === 'weekly-picks' && <WeeklyWatchlist />}

        {currentView === 'trending' && <TrendingPage />}

        {currentView === 'recommendations' && (
          <>
            <section className="bg-slate-800/30 backdrop-blur-md border border-white/5 p-6 rounded-2xl mb-6 overflow-visible">

              <div className="space-y-6">
                <div>
                  <label className="text-sm text-slate-400 mb-3 block">Content Type</label>
                  <SegmentedControl
                    options={[
                      { id: 'movie', label: 'Movies' },
                      { id: 'tv', label: 'TV Series' }
                    ]}
                    value={selectedType}
                    onChange={(value) => setSelectedType(value as 'movie' | 'tv')}
                    ariaLabel="Select content type"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm text-slate-400 block">Decade Range</label>
                    <span className="text-xs text-slate-300">{selectedYearFrom} - {selectedYearTo}</span>
                  </div>
                  <div className="relative rounded-2xl border border-white/5 bg-slate-900/30 p-4">
                    <div className="relative h-8">
                      <div className="absolute top-1/2 left-0 right-0 h-1 rounded-full bg-slate-700/60 -translate-y-1/2" />
                      <div
                        className="absolute top-1/2 h-1 rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 -translate-y-1/2"
                        style={{
                          left: `${((selectedYearFrom - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100}%`,
                          right: `${100 - ((selectedYearTo - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100}%`,
                        }}
                      />
                      <input
                        type="range"
                        min={YEAR_MIN}
                        max={YEAR_MAX}
                        step={YEAR_STEP}
                        value={selectedYearFrom}
                        onChange={(e) => handleYearFromChange(Number(e.target.value))}
                        className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-300 [&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(34,211,238,0.9)]"
                        aria-label="Select minimum release year"
                      />
                      <input
                        type="range"
                        min={YEAR_MIN}
                        max={YEAR_MAX}
                        step={YEAR_STEP}
                        value={selectedYearTo}
                        onChange={(e) => handleYearToChange(Number(e.target.value))}
                        className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-300 [&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(139,92,246,0.9)]"
                        aria-label="Select maximum release year"
                      />
                    </div>
                    <div className="mt-3 flex justify-between text-xs text-slate-500">
                      {YEAR_TICKS.map(year => (
                        <span key={year}>{year}</span>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-sm text-slate-400 mb-3 block">Genres</label>
                  <FilterGroup
                    chips={GENRES.map(g => ({ id: g, label: g, active: selectedGenres.includes(g) }))}
                    onToggle={toggleGenre}
                  />
                </div>

                <div>
                  <label className="text-sm text-slate-400 mb-3 block">Mood</label>
                  <FilterGroup
                    chips={MOODS.map(m => ({ id: m.id, label: m.label, active: selectedMood === m.id }))}
                    onToggle={toggleMood}
                  />
                </div>

                <div className="flex justify-center pt-2 pb-10">
                  <HeroButton onClick={() => handleGetRecommendations(true)} disabled={isLoading}>
                    {isLoading ? 'Getting Recommendations...' : '✨ Get Recommendations'}
                  </HeroButton>
                </div>
              </div>
            </section>
          </>
        )}

        <section>
          {currentView === 'recommendations' && (
            <>
              {error && <div className="mb-4 text-red-400">{error}</div>}
              <ItemList items={recommendations} onSelectItem={() => { }} isLoading={isLoading} onRemove={(tmdbId) => {
                if (!tmdbId && tmdbId !== 0) return;
                setRecommendations(prev => prev.filter(i => {
                  const item = i as JellyfinItem & { tmdb_id?: number; id?: number };
                  const id = Number(item.tmdbId ?? item.tmdb_id ?? item.id);
                  return id !== Number(tmdbId);
                }));
              }} />
            </>
          )}

          {currentView === 'watchlist' && <WatchlistView />}
          {(currentView === 'search' || currentView === 'mark-watched') && <ManualSearchView />}
          {currentView === 'settings' && (
            user?.isAdmin ? (
              <SettingsView />
            ) : (
              <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center p-8 bg-red-900/20 rounded-2xl border border-red-500/30 max-w-md">
                  <h2 className="text-2xl font-bold text-white mb-2">Access Denied</h2>
                  <p className="text-slate-400">Settings are only accessible to Jellyfin administrators.</p>
                </div>
              </div>
            )
          )}
          {currentView === 'blocked' && <BlockedView />}
        </section>
      </div>

      <div className="sticky bottom-0 mt-6 bg-[#0b0b15]">
        <div className="border-t border-white/5 pt-4">
          <Footer />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
