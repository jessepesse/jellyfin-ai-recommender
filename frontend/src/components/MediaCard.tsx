import React, { useState } from 'react';
import type { JellyfinItem } from '../types';
import { DownloadCloud, Bookmark, Eye, Slash, Check, Loader2 } from 'lucide-react';
import { postActionWatched, postActionWatchlist, postActionBlock, postJellyseerrRequest, postRemoveFromWatchlist } from '../services/api';

interface Props {
  item: JellyfinItem;
  onClick?: (item: JellyfinItem) => void;
  onRemove?: (tmdbId?: number) => void;
  variant?: 'default' | 'watchlist' | 'search';
}

const MediaCard: React.FC<Props> = ({ item, onClick, onRemove, variant = 'default' }) => {
  // Backend guarantees `posterUrl` and `title` when using Strict Verification
  const imgSrc = item.posterUrl || '';
  const titleText = item.title || 'Unknown Title';

  // Debug logging to help diagnose rendering issues
  // eslint-disable-next-line no-console
  console.log('Card rendering:', titleText, imgSrc);
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);

  return (
    <div
      className="bg-gray-800 rounded-lg overflow-hidden cursor-pointer transform transition-transform duration-200 hover:scale-105"
      onClick={() => onClick && onClick(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick && onClick(item); }}
    >
      <div className="relative w-full" style={{ paddingTop: '150%' }}>
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={titleText}
            className="absolute inset-0 w-full h-full object-cover rounded-lg shadow-md"
            onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="100%" height="100%" fill="%23343a40"/></svg>'; }}
          />
        ) : (
          <div className="absolute inset-0 bg-gray-800 h-full flex items-center justify-center">
            <div className="text-gray-300 text-center px-2">
              <div className="font-semibold">{titleText}</div>
              <div className="text-sm text-gray-400">No Image</div>
            </div>
          </div>
        )}

        <div className="absolute inset-0 flex items-end justify-center p-3 opacity-0 hover:opacity-100 transition-opacity duration-150">
            <div className="flex space-x-2 bg-black/40 p-2 rounded-md">
            {/* Request */}
            <button title="Request" onClick={async (e) => {
              e.stopPropagation();
              if (requesting) return;
              setRequesting(true);
              const id = Number(item.tmdbId);
              const mediaType = item.mediaType || 'movie';
              try {
                await postJellyseerrRequest(Number(id), (mediaType === 'tv' ? 'tv' : 'movie'));
                setRequested(true);
                if (typeof onRemove === 'function') onRemove(Number(id));
              } catch (err) {
                console.error('Request failed', err);
              } finally {
                setRequesting(false);
              }
            }} className="p-2 rounded text-white hover:text-indigo-300">
              {requesting ? <Loader2 className="animate-spin" /> : requested ? <Check className="text-green-400" /> : <DownloadCloud />}
            </button>
            {/* Watchlist */}
            {variant !== 'watchlist' ? (
            <button title="Add to Watchlist" onClick={(e) => {
              e.stopPropagation();
              const id = Number(item.tmdbId);
              if (typeof onRemove === 'function') onRemove(id as number);
              // Fire the API in background with a minimal trusted payload
              postActionWatchlist({ tmdbId: id, title: item.title, mediaType: item.mediaType, releaseYear: item.releaseYear })
                .then(() => {
                  // Notify other views (e.g., WatchlistView) that watchlist changed
                  try { window.dispatchEvent(new CustomEvent('watchlist:changed', { detail: { tmdbId: id } })); } catch (e) { /* ignore */ }
                })
                .catch(() => {/* TODO: handle rollback if needed */});
            }} className="p-2 rounded text-white hover:text-yellow-300">
              <Bookmark />
            </button>
            ) : (
            <button title="Remove from Watchlist" onClick={(e) => {
              e.stopPropagation();
              const id = Number(item.tmdbId);
              // Optimistically remove from UI
              if (typeof onRemove === 'function') onRemove(id as number);
              postRemoveFromWatchlist({ tmdbId: id })
                .then(() => {
                  try { window.dispatchEvent(new CustomEvent('watchlist:changed', { detail: { tmdbId: id } })); } catch (err) { /* ignore */ }
                })
                .catch(err => {
                  console.error('Failed to remove from watchlist', err);
                });
            }} className="p-2 rounded text-white hover:text-yellow-300">
              <Bookmark />
            </button>
            )}

            {/* Watched */}
            <button title="Mark Watched" onClick={(e) => {
              e.stopPropagation();
              const id = Number(item.tmdbId);
              if (typeof onRemove === 'function') onRemove(id as number);
              postActionWatched({ tmdbId: id, title: item.title, mediaType: item.mediaType, releaseYear: item.releaseYear }).catch(() => {/* TODO: handle rollback if needed */});
            }} className="p-2 rounded text-white hover:text-green-300">
              <Eye />
            </button>

            {/* Block */}
            <button title="Block (Do not recommend)" onClick={(e) => {
              e.stopPropagation();
              const id = Number(item.tmdbId);
              if (typeof onRemove === 'function') onRemove(id as number);
              postActionBlock({ tmdbId: id, title: item.title, mediaType: item.mediaType, releaseYear: item.releaseYear }).catch(() => {/* TODO: handle rollback if needed */});
            }} className="p-2 rounded text-white hover:text-red-400">
              <Slash />
            </button>
          </div>
        </div>
      </div>

      <div className="p-3">
        <p className="truncate font-semibold" title={titleText}>{titleText}</p>
        <div className="flex items-center justify-between mt-1">
          <p className="text-sm text-gray-400">{item.releaseYear}</p>
          {item.CommunityRating ? (
            <p className="text-sm text-gray-300">{Math.round(item.CommunityRating)}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default MediaCard;
