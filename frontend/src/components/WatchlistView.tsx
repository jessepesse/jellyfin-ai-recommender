import React, { useEffect, useState } from 'react';
import ItemList from './ItemList';
import type { JellyfinItem } from '../types';
import { getUserWatchlist } from '../services/api';

const WatchlistView: React.FC = () => {
  const [items, setItems] = useState<JellyfinItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getUserWatchlist()
      .then(data => {
        if (!mounted) return;
        setItems(data || []);
      })
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load watchlist'))
      .finally(() => setLoading(false));
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

  // Actions are posted by MediaCard; we optimistically remove via handleRemove

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Your Watchlist</h2>
      {error && <div className="text-red-400 mb-4">{error}</div>}
      <ItemList items={items} onSelectItem={() => {}} isLoading={loading} onRemove={(id) => handleRemove(id)} variant="watchlist" />
    </div>
  );
};

export default WatchlistView;
