import React, { useState } from 'react';
import SearchBar from './SearchBar';
import ItemList from './ItemList';
import type { JellyfinItem } from '../types';
import { searchJellyseerr } from '../services/api';

const ManualSearchView: React.FC = () => {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<JellyfinItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!term) return;
    setLoading(true);
    setError(null);
    try {
      const res = await searchJellyseerr(term);
      setResults(res || []);
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Mark as Watched / Search</h2>
      <div className="mb-4">
        <SearchBar setSearchTerm={setTerm} />
        <div className="mt-2">
          <button onClick={handleSearch} className="bg-indigo-600 px-4 py-2 rounded">Search</button>
        </div>
      </div>

      {error && <div className="text-red-400 mb-4">{error}</div>}
      <ItemList items={results} onSelectItem={() => {}} isLoading={loading} variant="search" />
    </div>
  );
};

export default ManualSearchView;
