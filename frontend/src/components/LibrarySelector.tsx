import React from 'react';
import type { JellyfinLibrary } from '../types';

interface Props {
    libraries: JellyfinLibrary[];
    setSelectedLibraryId: (id: string) => void;
}

const LibrarySelector: React.FC<Props> = ({ libraries, setSelectedLibraryId }) => {
    return (
        <div>
            <label htmlFor="library" className="block text-sm font-medium text-gray-300">
                Select Library
            </label>
            <select
                id="library"
                name="library"
                onChange={(e) => setSelectedLibraryId(e.target.value)}
                className="mt-1 block w-full pl-3 pr-10 py-2 text-base bg-gray-700 border-gray-600 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md text-white"
            >
                <option value="">-- Select a library --</option>
                {libraries.map(library => (
                    <option key={library.Id} value={library.Id}>
                        {library.Name}
                    </option>
                ))}
            </select>
        </div>
    );
};

export default LibrarySelector;
