import React, { useState } from 'react';
import type { JellyfinItem } from '../types';
import { DownloadCloud, Bookmark, Eye, Ban, Check, Loader2, Star } from 'lucide-react';
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
  // Avoid logging card rendering details in production
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);
  // Normalize media type once for all handlers ('movie' | 'tv')
  const currentMediaType = ((item.mediaType || (item as any).media_type || 'movie') as string).toLowerCase().includes('tv') ? 'tv' : 'movie';

  return (
    <div
      className="group bg-slate-900 rounded-lg overflow-hidden cursor-pointer transform transition-transform duration-200 hover:scale-105"
      onClick={() => onClick && onClick(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick && onClick(item); }}
    >
      {/* RESPONSIVE IMAGE CONTAINER: aspect-video on mobile, aspect-[2/3] on desktop */}
      <div className="relative w-full aspect-video md:aspect-[2/3]">
        {/* MOBILE IMAGE (Backdrop - Landscape 16:9) - Visible on mobile, hidden on md+ */}
        {(item.backdropUrl || imgSrc) ? (
          <img
            src={item.backdropUrl || imgSrc}
            alt={titleText}
            className="absolute inset-0 w-full h-full object-cover block md:hidden"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="100%" height="100%" fill="%23343a40"/></svg>'; }}
          />
        ) : (
          <div className="absolute inset-0 bg-slate-800 h-full flex items-center justify-center md:hidden">
            <div className="text-slate-300 text-center px-2">
              <div className="font-semibold">{titleText}</div>
              <div className="text-sm text-slate-400">No Image</div>
            </div>
          </div>
        )}

        {/* DESKTOP IMAGE (Poster - Portrait 2:3) - Hidden on mobile, visible on md+ */}
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={titleText}
            className="absolute inset-0 w-full h-full object-cover hidden md:block"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="100%" height="100%" fill="%23343a40"/></svg>'; }}
          />
        ) : (
          <div className="absolute inset-0 bg-slate-800 h-full items-center justify-center hidden md:flex">
            <div className="text-slate-300 text-center px-2">
              <div className="font-semibold">{titleText}</div>
              <div className="text-sm text-slate-400">No Image</div>
            </div>
          </div>
        )}

        {/* RATING BADGE */}
        {typeof item.voteAverage === 'number' && item.voteAverage > 0 && (
          <div className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-md">
            <Star className="w-3 h-3 text-yellow-400" />
            <span className="text-xs font-bold text-white">{item.voteAverage.toFixed(1)}</span>
          </div>
        )}

        <div className="absolute inset-0 transition-opacity duration-300 flex flex-col justify-end p-4 bg-gradient-to-t from-black/90 via-black/60 to-transparent opacity-100 md:opacity-0 md:group-hover:opacity-100">
          <div className="flex w-full items-center justify-evenly gap-1 bg-black/40 px-1 py-2 rounded-md">
            {/* Request */}
            <button aria-label="Request" title="Request" onClick={async (e) => {
              e.stopPropagation();
              if (requesting) return;
              setRequesting(true);
              const id = Number(item.tmdbId);
              try {
                await postJellyseerrRequest(Number(id), currentMediaType as 'movie' | 'tv');
                setRequested(true);
                if (typeof onRemove === 'function') onRemove(Number(id));
              } catch (err) {
                console.error('Request failed', err);
              } finally {
                setRequesting(false);
              }
            }} className="p-3 md:p-2 rounded text-white hover:text-cyan-300 transition-colors">
              {requesting ? <Loader2 className="w-6 h-6 md:w-5 md:h-5 animate-spin" /> : requested ? <Check className="w-6 h-6 md:w-5 md:h-5 text-green-400" /> : <DownloadCloud className="w-6 h-6 md:w-5 md:h-5" />}
            </button>
            {/* touch-friendly sizing */}
            {/* Watchlist */}
            {variant !== 'watchlist' ? (
            <button aria-label="Add to Watchlist" title="Add to Watchlist" onClick={(e) => {
              e.stopPropagation();
              const id = Number(item.tmdbId);
              if (typeof onRemove === 'function') onRemove(id as number);
              // Build strict payload item to avoid missing fields
              const payloadItem = {
                tmdbId: item.tmdbId ?? (item as any).tmdb_id ?? null,
                title: item.title ?? (item as any).name ?? 'Unknown Title',
                mediaType: (item.mediaType || (item as any).media_type || 'movie').toString().toLowerCase(),
                posterUrl: item.posterUrl ?? null,
                releaseYear: item.releaseYear ?? ((item as any).releaseDate ? String((item as any).releaseDate).substring(0,4) : null),
                // Rich metadata
                overview: item.overview ?? '',
                voteAverage: item.voteAverage ? Number(item.voteAverage) : 0,
                backdropUrl: item.backdropUrl ?? '',
              };
              // Debug log
              // eslint-disable-next-line no-console
              // Sending watchlist payload (not logged to avoid leaking user data)
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              postActionWatchlist(payloadItem)
                .then(() => {
                  try { window.dispatchEvent(new CustomEvent('watchlist:changed', { detail: { tmdbId: id } })); } catch (e) { /* ignore */ }
                })
                .catch(() => {/* TODO: handle rollback if needed */});
            }} className="p-3 md:p-2 rounded-md text-white hover:text-yellow-300 active:scale-95 transition-transform focus:outline-none">
              <Bookmark className="w-6 h-6 md:w-5 md:h-5" />
            </button>
            ) : (
            <button aria-label="Remove from Watchlist" title="Remove from Watchlist" onClick={(e) => {
              e.stopPropagation();
              const id = Number(item.tmdbId);
              // Optimistically remove from UI
              if (typeof onRemove === 'function') onRemove(id as number);
              const payloadItemRem = {
                tmdbId: item.tmdbId ?? (item as any).tmdb_id ?? null,
                title: item.title ?? (item as any).name ?? 'Unknown Title',
                mediaType: (item.mediaType || (item as any).media_type || 'movie').toString().toLowerCase(),
                posterUrl: item.posterUrl ?? null,
                releaseYear: item.releaseYear ?? ((item as any).releaseDate ? String((item as any).releaseDate).substring(0,4) : null),
                // Rich metadata
                overview: item.overview ?? '',
                voteAverage: item.voteAverage ? Number(item.voteAverage) : 0,
                backdropUrl: item.backdropUrl ?? '',
              };
              // eslint-disable-next-line no-console
              // Removing watchlist payload (not logged)
              postRemoveFromWatchlist(payloadItemRem)
                .then(() => {
                  try { window.dispatchEvent(new CustomEvent('watchlist:changed', { detail: { tmdbId: id } })); } catch (err) { /* ignore */ }
                })
                .catch(err => {
                  console.error('Failed to remove from watchlist', err);
                });
            }} className="p-3 md:p-2 rounded-md text-white hover:text-yellow-300 active:scale-95 transition-transform focus:outline-none">
              <Bookmark className="w-6 h-6 md:w-5 md:h-5" />
            </button>
            )}

            {/* Watched */}
            <button aria-label="Mark Watched" title="Mark Watched" onClick={(e) => {
              e.stopPropagation();
              const id = Number(item.tmdbId);
              if (typeof onRemove === 'function') onRemove(id as number);
              const payloadItemWatched = {
                tmdbId: item.tmdbId ?? (item as any).tmdb_id ?? null,
                title: item.title ?? (item as any).name ?? 'Unknown Title',
                mediaType: (item.mediaType || (item as any).media_type || 'movie').toString().toLowerCase(),
                posterUrl: item.posterUrl ?? null,
                releaseYear: item.releaseYear ?? ((item as any).releaseDate ? String((item as any).releaseDate).substring(0,4) : null),
                // Rich metadata
                overview: item.overview ?? '',
                voteAverage: item.voteAverage ? Number(item.voteAverage) : 0,
                backdropUrl: item.backdropUrl ?? '',
              };
              // eslint-disable-next-line no-console
              // Watched payload (not logged)
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              postActionWatched(payloadItemWatched).catch(() => {/* TODO: handle rollback if needed */});
            }} className="p-3 md:p-2 rounded-md text-white hover:text-green-300 active:scale-95 transition-transform focus:outline-none">
              <Eye className="w-6 h-6 md:w-5 md:h-5" />
            </button>

            {/* Block */}
            <button aria-label="Block (Do not recommend)" title="Block (Do not recommend)" onClick={(e) => {
              e.stopPropagation();
              const id = Number(item.tmdbId);
              if (typeof onRemove === 'function') onRemove(id as number);
              const payloadItemBlock = {
                tmdbId: item.tmdbId ?? (item as any).tmdb_id ?? null,
                title: item.title ?? (item as any).name ?? 'Unknown Title',
                mediaType: (item.mediaType || (item as any).media_type || 'movie').toString().toLowerCase(),
                posterUrl: item.posterUrl ?? null,
                releaseYear: item.releaseYear ?? ((item as any).releaseDate ? String((item as any).releaseDate).substring(0,4) : null),
                // Rich metadata
                overview: item.overview ?? '',
                voteAverage: item.voteAverage ? Number(item.voteAverage) : 0,
                backdropUrl: item.backdropUrl ?? '',
              };
              // eslint-disable-next-line no-console
              // Block payload (not logged)
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              postActionBlock(payloadItemBlock).catch(() => {/* TODO: handle rollback if needed */});
            }} className="p-3 md:p-2 rounded-md text-white hover:text-red-500 active:scale-95 transition-transform focus:outline-none">
              <Ban className="w-6 h-6 md:w-5 md:h-5" />
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
