import React, { useState } from 'react';
import ItemList from './ItemList';
import type { JellyfinItem } from '../types';
import { getRecommendations } from '../services/api';
import WatchlistView from './WatchlistView';
import ManualSearchView from './ManualSearchView';
import SettingsView from './SettingsView';
import Footer from './Footer';
import SegmentedControl from './SegmentedControl';
import FilterGroup from './FilterGroup';
import HeroButton from './HeroButton';

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

interface Props {
  currentView?: 'recommendations' | 'watchlist' | 'search' | 'mark-watched' | 'settings';
}

const Dashboard: React.FC<Props> = ({ currentView = 'recommendations' }) => {
  const [selectedType, setSelectedType] = useState<'movie' | 'tv'>('movie');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<JellyfinItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const toggleGenre = (g: string) => {
    setSelectedGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  };

  const toggleMood = (m: string) => {
    setSelectedMood(prev => prev === m ? null : m);
  };

  const handleGetRecommendations = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const genreParam = selectedGenres.join(',') || undefined;
      // Build params object conditionally so we don't send undefined/null path/query values
      const params: Record<string, string | undefined> = {};
      if (selectedType) params.type = selectedType;
      if (genreParam) params.genre = genreParam;
      if (selectedMood) params.mood = selectedMood;

      // getRecommendations signature is (targetItemId, libraryId, options)
      // We intentionally omit targetItemId and libraryId for general recommendations.
      const recs = await getRecommendations('', '', params);
      // Log raw API response for debugging in browser console
      // Avoid logging raw API responses in production (may contain PII)

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
  };

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

        {currentView === 'recommendations' && (
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
                <HeroButton onClick={handleGetRecommendations} disabled={isLoading}>
                  {isLoading ? 'Getting Recommendations...' : '✨ Get Recommendations'}
                </HeroButton>
              </div>
            </div>
          </section>
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
          {currentView === 'settings' && <SettingsView />}
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
