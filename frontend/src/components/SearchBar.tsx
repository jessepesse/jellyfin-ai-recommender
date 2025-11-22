import React from 'react';

interface Props {
    setSearchTerm: (term: string) => void;
}

const SearchBar: React.FC<Props> = ({ setSearchTerm }) => {
    return (
        <div>
            <label htmlFor="search" className="block text-sm font-medium text-gray-300">
                Search
            </label>
            <input
                type="text"
                id="search"
                name="search"
                onChange={(e) => setSearchTerm(e.target.value)}
                className="mt-1 block w-full pl-3 pr-10 py-2 text-base bg-gray-700 border-gray-600 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md text-white"
                placeholder="Search for movies or series..."
            />
        </div>
    );
};

export default SearchBar;
