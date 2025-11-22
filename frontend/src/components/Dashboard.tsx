import React, { useState } from 'react';
import ItemList from './ItemList';
import type { JellyfinItem } from '../types';
import { getRecommendations } from '../services/api';
import WatchlistView from './WatchlistView';
import ManualSearchView from './ManualSearchView';
import SettingsView from './SettingsView';

const GENRES = ['Action','Comedy','Drama','Sci-Fi','Horror','Romance','Documentary','Animation','Thriller'];

interface Props {
  currentView?: 'recommendations' | 'watchlist' | 'search' | 'settings';
}

const Dashboard: React.FC<Props> = ({ currentView = 'recommendations' }) => {
  const [selectedType, setSelectedType] = useState<'movie'|'tv'>('movie');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<JellyfinItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const toggleGenre = (g: string) => {
    setSelectedGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  };

  const handleGetRecommendations = async () => {
    setError(null);
    setIsLoading(true);
      try {
      const genreParam = selectedGenres.join(',') || undefined;
      // Do not send targetItemId or libraryId by default — general recommendations from user history
      const recs = await getRecommendations('', '', { type: selectedType, genre: genreParam });
      // Log raw API response for debugging in browser console
      console.log('RAW API RESPONSE:', recs);

      // Backend guarantees strict items with tmdbId and posterUrl. Use them directly.
      let itemsArray: any[] = [];
      if (Array.isArray(recs)) itemsArray = recs;
      else if (recs && Array.isArray((recs as any).data)) itemsArray = (recs as any).data;

      setRecommendations(itemsArray as any[]);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Failed to fetch recommendations');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Jellyfin AI Recommender</h1>
          <p className="text-sm text-gray-400">Personalized recommendations for your library</p>
        </div>
      </header>

      {currentView === 'recommendations' && (
      <section className="bg-gray-800 p-4 rounded-lg mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-6">
          <div className="flex items-center space-x-3">
            <label className="text-sm text-gray-300">Content Type</label>
            <div className="inline-flex bg-gray-700 p-1 rounded-md">
              <button onClick={() => setSelectedType('movie')} className={`px-3 py-1 rounded ${selectedType === 'movie' ? 'bg-indigo-600 text-white' : 'text-gray-300'}`}>Movies</button>
              <button onClick={() => setSelectedType('tv')} className={`ml-1 px-3 py-1 rounded ${selectedType === 'tv' ? 'bg-indigo-600 text-white' : 'text-gray-300'}`}>TV Series</button>
            </div>
          </div>

          <div className="mt-4 sm:mt-0">
            <label className="text-sm text-gray-300 mb-2 block">Genres</label>
            <div className="flex flex-wrap gap-2">
              {GENRES.map(g => (
                <button key={g} onClick={() => toggleGenre(g)} className={`px-3 py-1 rounded-full text-sm ${selectedGenres.includes(g) ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-200'}`}>
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 sm:mt-0 ml-auto">
            <button onClick={handleGetRecommendations} className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-2 rounded-md font-semibold text-white">
              {isLoading ? 'Getting Recommendations...' : 'Get Recommendations'}
            </button>
          </div>
        </div>
      </section>
      )}

      <section>
        {currentView === 'recommendations' && (
          <>
            {error && <div className="mb-4 text-red-400">{error}</div>}
            <ItemList items={recommendations} onSelectItem={() => {}} isLoading={isLoading} onRemove={(tmdbId) => {
              if (!tmdbId && tmdbId !== 0) return;
              setRecommendations(prev => prev.filter(i => {
                const id = Number((i as any).tmdbId ?? (i as any).tmdb_id ?? (i as any).id);
                return id !== Number(tmdbId);
              }));
            }} />
          </>
        )}

        {currentView === 'watchlist' && <WatchlistView />}
        {currentView === 'search' && <ManualSearchView />}
        {currentView === 'settings' && <SettingsView />}
      </section>
      
    </div>
  );
};

export default Dashboard;
