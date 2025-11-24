import React, { useState } from 'react';
import SearchBar from './SearchBar';
import ItemList from './ItemList';
import type { JellyfinItem } from '../types';
import { searchJellyseerr } from '../services/api';

const ManualSearchView: React.FC = () => {
  const [results, setResults] = useState<JellyfinItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (term: string) => {
    if (!term) return;
    setLoading(true);
    setError(null);
    try {
      const res = await searchJellyseerr(term);
      setResults(res || []);
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = (tmdbId?: number) => {
    if (!tmdbId) return;
    setResults(prev => prev.filter(item => item.tmdbId !== tmdbId));
  };

  return (
    <div>
      <h2 className="text-4xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-slate-400 mb-8">
        Mark as Watched
      </h2>

      <div className="max-w-3xl mx-auto mb-8">
        <SearchBar onSearch={handleSearch} isLoading={loading} />
      </div>

      {error && <div className="text-red-400 mb-4 text-center">{error}</div>}

      {(!loading && (!results || results.length === 0)) ? (
        <div className="text-center py-16">
          <svg className="mx-auto h-16 w-16 text-slate-700 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-slate-500 text-lg">Search for a title to add it to your watched history or watchlist.</p>
        </div>
      ) : null}

      <div className="mt-6">
        <ItemList items={results} onSelectItem={() => {}} isLoading={loading} variant="search" onRemove={handleRemove} />
      </div>
    </div>
  );
};

export default ManualSearchView;
