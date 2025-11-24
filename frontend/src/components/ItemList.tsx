import React from 'react';
import type { JellyfinItem } from '../types';
import MediaCard from './MediaCard';
import SkeletonCard from './SkeletonCard';

interface Props {
    items: JellyfinItem[];
    onSelectItem: (item: JellyfinItem) => void;
    isLoading?: boolean;
    onRemove?: (tmdbId?: number) => void;
    variant?: 'default' | 'watchlist' | 'search';
}

const ItemList: React.FC<Props> = ({ items, onSelectItem, isLoading = false, onRemove, variant = 'default' }) => {
    const skeletonCount = 8;
    // Debug: log incoming items to verify shape
    // eslint-disable-next-line no-console
    // Intentionally not logging item contents to avoid exposing user data in console

    return (
        <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-6">
                {isLoading ? (
                    Array.from({ length: skeletonCount }).map((_, idx) => (
                        <SkeletonCard key={`skeleton-${idx}`} />
                    ))
                ) : (
                    items.map((item) => (
                        <MediaCard key={item.tmdbId} item={item} onClick={onSelectItem} onRemove={onRemove} variant={variant} />
                    ))
                )}
            </div>
        </div>
    );
};

export default ItemList;
