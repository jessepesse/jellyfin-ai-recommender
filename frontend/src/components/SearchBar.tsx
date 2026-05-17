import React, { useCallback, useState } from 'react';
import { Search as SearchIcon, Loader2 } from 'lucide-react';

interface Props {
    onSearch: (term: string) => void;
    isLoading?: boolean;
}

const SearchBar: React.FC<Props> = ({ onSearch, isLoading = false }) => {
    const [term, setTerm] = useState('');

    const handleSearch = useCallback(() => {
        const t = (term || '').trim();
        if (!t || isLoading) return;
        onSearch(t);
    }, [term, isLoading, onSearch]);

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSearch();
        }
    };

    return (
        <div className="w-full">
            <div className="relative flex w-full flex-col gap-2 sm:block">
                <div className="pointer-events-none absolute left-4 top-4 sm:left-6">
                    <SearchIcon className="text-slate-500" size={20} />
                </div>
                <input
                    type="text"
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Search movies or TV shows..."
                    aria-label="Search for movies or TV shows"
                    className="w-full bg-slate-800/50 backdrop-blur-sm text-white text-base sm:text-lg pl-12 sm:pl-14 pr-4 sm:pr-40 py-4 rounded-2xl sm:rounded-full border-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition"
                />

                <button
                    onClick={handleSearch}
                    disabled={isLoading || !(term || '').trim()}
                    className={`inline-flex w-full items-center justify-center px-6 py-3 sm:absolute sm:right-2 sm:top-1/2 sm:w-auto sm:-translate-y-1/2 sm:px-8 sm:py-2.5 rounded-2xl sm:rounded-full font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${isLoading ? 'bg-violet-500/60 cursor-wait text-white' : 'bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 shadow-lg shadow-cyan-500/30 text-white'}`}
                    aria-label="Search"
                >
                    {isLoading ? <Loader2 className="animate-spin" size={18} /> : 'Search'}
                </button>
            </div>
        </div>
    );
};

export default SearchBar;
