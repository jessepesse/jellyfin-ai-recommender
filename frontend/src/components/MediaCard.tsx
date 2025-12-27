import React, { useState } from 'react';
import type { JellyfinItem } from '../types';
import Modal from './Modal';
import { DownloadCloud, Bookmark, Eye, Ban, Check, Loader2, Star, Info, ExternalLink, X } from 'lucide-react';
import { postActionWatched, postActionWatchlist, postActionBlock, postJellyseerrRequest, postRemoveFromWatchlist, unblockItem } from '../services/api';

interface Props {
  item: JellyfinItem;
  onClick?: (item: JellyfinItem) => void;
  onRemove?: (tmdbId?: number) => void;
  variant?: 'default' | 'watchlist' | 'search' | 'blocked';
}

interface AugmentedItem extends JellyfinItem {
  media_type?: string;
  tmdb_id?: number;
  releaseDate?: string;
  name?: string;
  id?: number;
}

const MediaCard: React.FC<Props> = ({ item, onClick, onRemove, variant = 'default' }) => {
  // Backend guarantees `posterUrl` and `title` when using Strict Verification
  const imgSrc = item.posterUrl || '';
  const titleText = item.title || 'Unknown Title';
  const rawItem = item as AugmentedItem;

  // Debug logging to help diagnose rendering issues
  console.log('[MediaCard] Rendering:', { title: titleText, posterUrl: item.posterUrl, imgSrc });

  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  // Normalize media type once for all handlers ('movie' | 'tv')
  const currentMediaType = ((item.mediaType || rawItem.media_type || 'movie') as string).toLowerCase().includes('tv') ? 'tv' : 'movie';
  const tmdbLink = `https://www.themoviedb.org/${currentMediaType}/${item.tmdbId}`;

  return (
    <>
      <div
        className="group bg-slate-900 rounded-lg overflow-hidden cursor-pointer transform transition-transform duration-200 hover:scale-105"
        onClick={() => onClick && onClick(item)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' && onClick) onClick(item); }}
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

          {/* INFO BADGE */}
          <div className="absolute top-2 right-2 z-10 transition-transform duration-200 hover:scale-110">
            <button
              aria-label="More Info"
              title="More Info"
              onClick={(e) => {
                e.stopPropagation();
                setShowInfo(true);
              }}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm hover:bg-white/20 text-white transition-colors border border-white/10 shadow-lg"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>

          <div className="absolute inset-0 transition-opacity duration-300 flex flex-col justify-end p-4 bg-gradient-to-t from-black/90 via-black/60 to-transparent opacity-100 md:opacity-0 md:group-hover:opacity-100">
            <div className="flex w-full items-center justify-evenly gap-1 bg-black/40 px-1 py-2 rounded-md">



              {/* Request */}
              <button aria-label="Request" title="Request" onClick={async (e) => {
                e.stopPropagation();
                if (requesting) return;
                setRequesting(true);
                const id = Number(item.tmdbId);
                try {
                  if (variant === 'blocked') {
                    if (typeof onRemove === 'function') onRemove(id);
                    await unblockItem(id, 'jellyseerr');
                  } else {
                    await postJellyseerrRequest(id, currentMediaType as 'movie' | 'tv');
                  }
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

              {/* Watchlist */}
              {variant !== 'watchlist' ? (
                <button aria-label="Add to Watchlist" title="Add to Watchlist" onClick={(e) => {
                  e.stopPropagation();
                  const id = Number(item.tmdbId);
                  if (typeof onRemove === 'function') onRemove(id as number);
                  // Build strict payload item to avoid missing fields
                  const payloadItem = {
                    tmdbId: item.tmdbId ?? rawItem.tmdb_id ?? null,
                    title: item.title ?? rawItem.name ?? 'Unknown Title',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    mediaType: ((item.mediaType || rawItem.media_type || 'movie').toString().toLowerCase() as any),
                    posterUrl: item.posterUrl ?? null,
                    releaseYear: item.releaseYear ?? (rawItem.releaseDate ? String(rawItem.releaseDate).substring(0, 4) : null),
                    // Rich metadata
                    overview: item.overview ?? '',
                    voteAverage: item.voteAverage ? Number(item.voteAverage) : 0,
                    backdropUrl: item.backdropUrl ?? '',
                  };
                  if (variant === 'blocked' && typeof onRemove === 'function') onRemove(id);
                  const actionPromise = variant === 'blocked' ? unblockItem(id, 'watchlist') : postActionWatchlist(payloadItem);
                  actionPromise
                    .then(() => {
                      try { window.dispatchEvent(new CustomEvent('watchlist:changed', { detail: { tmdbId: id } })); } catch { /* ignore */ }
                    })
                    .catch(() => {/* TODO: handle rollback if needed */ });
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
                    tmdbId: item.tmdbId ?? rawItem.tmdb_id ?? null,
                    title: item.title ?? rawItem.name ?? 'Unknown Title',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    mediaType: ((item.mediaType || rawItem.media_type || 'movie').toString().toLowerCase() as any),
                    posterUrl: item.posterUrl ?? null,
                    releaseYear: item.releaseYear ?? (rawItem.releaseDate ? String(rawItem.releaseDate).substring(0, 4) : null),
                    // Rich metadata
                    overview: item.overview ?? '',
                    voteAverage: item.voteAverage ? Number(item.voteAverage) : 0,
                    backdropUrl: item.backdropUrl ?? '',
                  };
                  postRemoveFromWatchlist(payloadItemRem)
                    .then(() => {
                      try { window.dispatchEvent(new CustomEvent('watchlist:changed', { detail: { tmdbId: id } })); } catch { /* ignore */ }
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
                  tmdbId: item.tmdbId ?? rawItem.tmdb_id ?? null,
                  title: item.title ?? rawItem.name ?? 'Unknown Title',
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  mediaType: ((item.mediaType || rawItem.media_type || 'movie').toString().toLowerCase() as any),
                  posterUrl: item.posterUrl ?? null,
                  releaseYear: item.releaseYear ?? (rawItem.releaseDate ? String(rawItem.releaseDate).substring(0, 4) : null),
                  // Rich metadata
                  overview: item.overview ?? '',
                  voteAverage: item.voteAverage ? Number(item.voteAverage) : 0,
                  backdropUrl: item.backdropUrl ?? '',
                };
                if (variant === 'blocked') {
                  if (typeof onRemove === 'function') onRemove(id);
                  unblockItem(id, 'watched').catch(() => { });
                } else {
                  postActionWatched(payloadItemWatched).catch(() => {/* TODO: handle rollback if needed */ });
                }
              }} className="p-3 md:p-2 rounded-md text-white hover:text-green-300 active:scale-95 transition-transform focus:outline-none">
                <Eye className="w-6 h-6 md:w-5 md:h-5" />
              </button>

              {/* Block */}
              {/* Block / Unblock */}
              {variant === 'blocked' ? (
                <button aria-label="Unblock" title="Unblock" onClick={(e) => {
                  e.stopPropagation();
                  const id = Number(item.tmdbId);
                  if (typeof onRemove === 'function') onRemove(id as number);
                  unblockItem(id, 'remove').catch(console.error);
                }} className="p-3 md:p-2 rounded-md text-white hover:text-red-500 active:scale-95 transition-transform focus:outline-none">
                  <X className="w-6 h-6 md:w-5 md:h-5" />
                </button>
              ) : (
                <button aria-label="Block (Do not recommend)" title="Block (Do not recommend)" onClick={(e) => {
                  e.stopPropagation();
                  const id = Number(item.tmdbId);
                  if (typeof onRemove === 'function') onRemove(id as number);
                  const payloadItemBlock = {
                    tmdbId: item.tmdbId ?? rawItem.tmdb_id ?? null,
                    title: item.title ?? rawItem.name ?? 'Unknown Title',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    mediaType: ((item.mediaType || rawItem.media_type || 'movie').toString().toLowerCase() as any),
                    posterUrl: item.posterUrl ?? null,
                    releaseYear: item.releaseYear ?? (rawItem.releaseDate ? String(rawItem.releaseDate).substring(0, 4) : null),
                    // Rich metadata
                    overview: item.overview ?? '',
                    voteAverage: item.voteAverage ? Number(item.voteAverage) : 0,
                    backdropUrl: item.backdropUrl ?? '',
                  };
                  postActionBlock(payloadItemBlock).catch(() => {/* TODO: handle rollback if needed */ });
                }} className="p-3 md:p-2 rounded-md text-white hover:text-red-500 active:scale-95 transition-transform focus:outline-none">
                  <Ban className="w-6 h-6 md:w-5 md:h-5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Title and metadata below card */}
        <div className="p-3 bg-slate-900/50">
          <h3 className="font-semibold text-white text-sm md:text-base line-clamp-2 leading-tight" title={titleText}>
            {titleText}
          </h3>
          <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-400">
            {item.releaseYear && (
              <span>{item.releaseYear}</span>
            )}
            {item.releaseYear && item.voteAverage && item.voteAverage > 0 && (
              <span>•</span>
            )}
            {item.voteAverage && item.voteAverage > 0 && (
              <span className="flex items-center gap-1">
                <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                {item.voteAverage.toFixed(1)}
              </span>
            )}
            {(item.releaseYear || (item.voteAverage && item.voteAverage > 0)) && currentMediaType && (
              <span>•</span>
            )}
            {currentMediaType && (
              <span className="text-slate-500">
                {currentMediaType === 'movie' ? '🎬 Movie' : '📺 TV'}
              </span>
            )}
          </div>
        </div>
      </div>

      <Modal isOpen={showInfo} onClose={() => setShowInfo(false)} title="Details">
        <div className="flex flex-col md:flex-row gap-6 p-4 md:p-6">
          <div className="w-full md:w-1/3 shrink-0">
            <img
              src={imgSrc}
              alt={titleText}
              className="w-full rounded-lg shadow-lg object-cover aspect-[2/3]"
              onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="100%" height="100%" fill="%23343a40"/></svg>'; }}
            />
          </div>
          <div className="flex-1 space-y-4">
            <div>
              <h3 className="text-2xl font-bold text-white">{titleText}</h3>
              <div className="flex items-center gap-3 text-slate-400 mt-1">
                <span>{item.releaseYear}</span>
                <span>•</span>
                <span className="capitalize">{currentMediaType === 'tv' ? 'TV Series' : 'Movie'}</span>
                {item.voteAverage ? (
                  <>
                    <span>•</span>
                    <div className="flex items-center gap-1 text-yellow-400">
                      <Star className="w-4 h-4 fill-current" />
                      <span>{item.voteAverage.toFixed(1)}</span>
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            <div className="prose prose-invert max-w-none">
              <p className="text-slate-300 leading-relaxed">
                {item.overview || 'No synopsis available.'}
              </p>
            </div>

            <div className="pt-4 border-t border-white/10 flex flex-wrap gap-4 items-center justify-between">
              <a
                href={tmdbLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-[#0d253f] hover:bg-[#01b4e4] text-white px-4 py-2 rounded-lg transition-colors font-medium border border-[#01b4e4]/30"
              >
                <ExternalLink className="w-4 h-4" />
                View on TMDB
              </a>

              <div className="flex flex-wrap items-center gap-3">
                {/* Request */}
                <button
                  aria-label="Request"
                  title="Request"
                  onClick={async () => {
                    if (requesting) return;
                    setRequesting(true);
                    const id = Number(item.tmdbId);
                    try {
                      if (variant === 'blocked') {
                        if (typeof onRemove === 'function') onRemove(id);
                        setShowInfo(false);
                        await unblockItem(id, 'jellyseerr');
                      } else {
                        await postJellyseerrRequest(id, currentMediaType as 'movie' | 'tv');
                      }
                      setRequested(true);
                      if (typeof onRemove === 'function') onRemove(Number(id));
                      setShowInfo(false);
                    } catch (err) {
                      console.error('Request failed', err);
                    } finally {
                      setRequesting(false);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 hover:text-cyan-300 transition-colors border border-cyan-500/20"
                >
                  {requesting ? <Loader2 className="w-5 h-5 animate-spin" /> : <DownloadCloud className="w-5 h-5" />}
                  <span className="font-medium">Request</span>
                </button>

                {/* Watchlist */}
                <button
                  aria-label={variant === 'watchlist' ? "Remove" : "Watchlist"}
                  title={variant === 'watchlist' ? "Remove from Watchlist" : "Add to Watchlist"}
                  onClick={() => {
                    const id = Number(item.tmdbId);
                    // Always remove from view and close modal
                    if (typeof onRemove === 'function') onRemove(id as number);
                    setShowInfo(false);
                    // If currently on watchlist, remove it
                    if (variant === 'watchlist') {
                      const payloadItemRem = {
                        tmdbId: item.tmdbId ?? null,
                        title: item.title ?? 'Unknown Title',
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        mediaType: (currentMediaType as any),
                        posterUrl: item.posterUrl ?? null,
                        releaseYear: item.releaseYear,
                        overview: item.overview ?? '',
                        voteAverage: item.voteAverage ? Number(item.voteAverage) : 0,
                        backdropUrl: item.backdropUrl ?? '',
                      };
                      postRemoveFromWatchlist(payloadItemRem).catch(console.error);
                    } else if (variant === 'blocked') {
                      if (typeof onRemove === 'function') onRemove(id);
                      setShowInfo(false);
                      unblockItem(id, 'watchlist')
                        .then(() => { try { window.dispatchEvent(new CustomEvent('watchlist:changed', { detail: { tmdbId: id } })); } catch { } })
                        .catch(console.error);
                    } else {
                      // Add to watchlist
                      const payloadItem = {
                        tmdbId: item.tmdbId ?? null,
                        title: item.title ?? 'Unknown Title',
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        mediaType: (currentMediaType as any),
                        posterUrl: item.posterUrl ?? null,
                        releaseYear: item.releaseYear,
                        overview: item.overview ?? '',
                        voteAverage: item.voteAverage ? Number(item.voteAverage) : 0,
                        backdropUrl: item.backdropUrl ?? '',
                      };
                      postActionWatchlist(payloadItem)
                        .then(() => { try { window.dispatchEvent(new CustomEvent('watchlist:changed', { detail: { tmdbId: id } })); } catch { } })
                        .catch(console.error);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 hover:text-yellow-300 transition-colors border border-yellow-500/20"
                >
                  <Bookmark className="w-5 h-5" />
                  <span className="font-medium">Watchlist</span>
                </button>

                {/* Watched */}
                <button
                  aria-label="Watched"
                  title="Mark Watched"
                  onClick={() => {
                    const id = Number(item.tmdbId);
                    if (typeof onRemove === 'function') onRemove(id as number);
                    setShowInfo(false);
                    const payloadItemWatched = {
                      tmdbId: item.tmdbId ?? null,
                      title: item.title ?? 'Unknown Title',
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      mediaType: (currentMediaType as any),
                      posterUrl: item.posterUrl ?? null,
                      releaseYear: item.releaseYear,
                      overview: item.overview ?? '',
                      voteAverage: item.voteAverage ? Number(item.voteAverage) : 0,
                      backdropUrl: item.backdropUrl ?? '',
                    };
                    if (variant === 'blocked') {
                      if (typeof onRemove === 'function') onRemove(id);
                      setShowInfo(false);
                      unblockItem(id, 'watched').catch(console.error);
                    } else {
                      postActionWatched(payloadItemWatched).catch(console.error);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-400 hover:text-green-300 transition-colors border border-green-500/20"
                >
                  <Eye className="w-5 h-5" />
                  <span className="font-medium">Watched</span>
                </button>

                {/* Block */}
                {/* Block / Unblock */}
                {variant === 'blocked' ? (
                  <button
                    aria-label="Unblock"
                    title="Unblock"
                    onClick={() => {
                      const id = Number(item.tmdbId);
                      if (typeof onRemove === 'function') onRemove(id as number);
                      setShowInfo(false);
                      unblockItem(id, 'remove').catch(console.error);
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 hover:text-red-400 transition-colors border border-red-500/20"
                  >
                    <X className="w-5 h-5" />
                    <span className="font-medium">Unblock</span>
                  </button>
                ) : (
                  <button
                    aria-label="Block"
                    title="Block / Hide"
                    onClick={() => {
                      const id = Number(item.tmdbId);
                      if (typeof onRemove === 'function') onRemove(id as number);
                      setShowInfo(false);
                      const payloadItemBlock = {
                        tmdbId: item.tmdbId ?? null,
                        title: item.title ?? 'Unknown Title',
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        mediaType: (currentMediaType as any),
                        posterUrl: item.posterUrl ?? null,
                        releaseYear: item.releaseYear,
                        overview: item.overview ?? '',
                        voteAverage: item.voteAverage ? Number(item.voteAverage) : 0,
                        backdropUrl: item.backdropUrl ?? '',
                      };
                      postActionBlock(payloadItemBlock).catch(console.error);
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 hover:text-red-400 transition-colors border border-red-500/20"
                  >
                    <Ban className="w-5 h-5" />
                    <span className="font-medium">Block</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default MediaCard;
