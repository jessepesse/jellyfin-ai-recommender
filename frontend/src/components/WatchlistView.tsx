import React, { useEffect, useMemo, useState } from 'react';
import ItemList from './ItemList';
import type { JellyfinItem } from '../types';
import { getUserWatchlist } from '../services/api';
import FilterGroup from './FilterGroup';

type FilterType = 'all' | 'movie' | 'tv';
type SortType = 'added-newest' | 'release-newest' | 'title-asc';

const WatchlistView: React.FC = () => {
  const [items, setItems] = useState<JellyfinItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortType>('added-newest');

  // ...

  useEffect(() => {
    let mounted = true;
    getUserWatchlist()
      .then(data => {
        if (!mounted) return;
        setItems(data || []);
      })
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load watchlist'))
      .finally(() => {
        if (mounted) setLoading(false);
      });

    // Listen for global watchlist changes (e.g., added from Recommendations)
    const handler = () => {
      getUserWatchlist().then(d => { if (mounted) setItems(d || []); }).catch(err => console.error('Failed refreshing watchlist after event', err));
    };
    window.addEventListener('watchlist:changed', handler as EventListener);

    return () => {
      mounted = false;
      window.removeEventListener('watchlist:changed', handler as EventListener);
    };
  }, []);

  const handleRemove = (tmdbId?: number) => {
    if (!tmdbId && tmdbId !== 0) return;
    setItems(prev => prev.filter(i => Number(i.tmdbId) !== Number(tmdbId)));
  };

  // Derived/processed items applying filter + sort
  const processedItems = useMemo(() => {
    let list = Array.from(items || []);

    // Filter
    if (filter !== 'all') {
      const want = filter === 'movie' ? 'movie' : 'tv';
      list = list.filter(it => (it.mediaType || 'movie') === want);
    }

    // Sort
    if (sort === 'added-newest') {
      // Assuming API returns oldest-first, reverse to show newest first
      list = [...list].reverse();
    } else if (sort === 'release-newest') {
      list = [...list].sort((a, b) => {
        const ay = Number(a.releaseYear || 0) || 0;
        const by = Number(b.releaseYear || 0) || 0;
        return by - ay;
      });
    } else if (sort === 'title-asc') {
      list = [...list].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    }

    return list;
  }, [items, filter, sort]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h2 className="text-4xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-slate-400">
          My Watchlist
        </h2>
        <div className="flex items-center gap-3">
          <label htmlFor="watchlist-sort" className="hidden sm:block text-sm text-slate-400 mr-2">Sort</label>
          <select
            id="watchlist-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortType)}
            className="bg-slate-800/80 backdrop-blur-sm border border-white/10 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition"
            aria-label="Sort watchlist"
          >
            <option value="added-newest">Recently Added</option>
            <option value="release-newest">Release Date (Newest)</option>
            <option value="title-asc">Title (A-Z)</option>
          </select>
        </div>
      </div>

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

      {error && <div className="text-red-400 mb-4">{error}</div>}

      <ItemList items={processedItems} onSelectItem={() => { }} isLoading={loading} onRemove={(id) => handleRemove(id)} variant="watchlist" />
    </div>
  );
};

export default WatchlistView;
