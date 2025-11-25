import { PrismaClient, MediaStatus } from '@prisma/client';
import { search as jellySearch } from './jellyseerr';
import { ImageService } from './image';

const prisma = new PrismaClient();

function parseTmdbId(item: any): number | null {
  const raw = item?.tmdbId ?? item?.tmdb_id ?? item?.media_id ?? item?.id ?? null;
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export async function syncMediaItem(item: any) {
  const tmdbId = parseTmdbId(item);
  if (!tmdbId) throw new Error('Missing or invalid tmdbId for media');
  // Normalize title: prefer common keys and fallbacks for TV (`name`) and originals
  const validTitle = item?.title ?? item?.name ?? item?.originalTitle ?? item?.Title ?? 'Unknown Title';

  // Normalize year/date: check multiple possible date/year fields and extract YYYY
  const rawDate = item?.releaseYear ?? item?.release_year ?? item?.releaseDate ?? item?.release_date ?? item?.firstAirDate ?? item?.first_air_date ?? item?.year ?? null;
  const validYear = rawDate && String(rawDate).length >= 4 ? String(rawDate).substring(0, 4) : null;

  // Normalize media type into strict 'movie' or 'tv'
  const mediaTypeRaw = item?.mediaType ?? item?.media_type ?? item?.type ?? 'movie';
  const validType = typeof mediaTypeRaw === 'string' && mediaTypeRaw.toLowerCase().includes('tv') ? 'tv' : 'movie';

  const posterUrl = item?.posterUrl ?? item?.poster_url ?? item?.poster_path ?? null;
  const overview = item?.overview ?? item?.plot ?? item?.synopsis ?? null;
  const backdropUrl = item?.backdropUrl ?? item?.backdrop_url ?? item?.backdrop_path ?? null;
  const voteAverage = item?.voteAverage ?? item?.vote_average ?? item?.rating ?? null;
  const language = item?.language ?? item?.originalLanguage ?? null;

  // Build update payload but avoid overwriting existing posterUrl with null/undefined
  const updateData: any = {
    title: validTitle,
    mediaType: validType,
  };
  if (validYear) updateData.releaseYear = validYear;
  if (posterUrl) {
    updateData.posterUrl = posterUrl;
    updateData.posterSourceUrl = posterUrl; // Save original URL as source
  }
  // Persist rich metadata when provided to allow backfilling
  if (overview !== null && overview !== undefined && overview !== '') updateData.overview = overview;
  if (backdropUrl) {
    updateData.backdropUrl = backdropUrl;
    updateData.backdropSourceUrl = backdropUrl; // Save original URL as source
  }
  if (voteAverage !== null && voteAverage !== undefined) updateData.voteAverage = Number(voteAverage);
  if (language) updateData.language = String(language);

  const createData: any = {
    tmdbId,
    title: validTitle,
    mediaType: validType,
    posterUrl,
    posterSourceUrl: posterUrl, // Save original URL as source
    releaseYear: validYear,
    overview: overview ?? null,
    backdropUrl: backdropUrl ?? null,
    backdropSourceUrl: backdropUrl, // Save original URL as source
    voteAverage: voteAverage !== null && voteAverage !== undefined ? Number(voteAverage) : null,
    language,
  };

  const media = await prisma.media.upsert({
    where: { tmdbId },
    update: updateData,
    create: createData,
  });

  // Download and cache images locally to prevent broken links
  try {
    const needsPosterDownload = posterUrl && (posterUrl.startsWith('http') || posterUrl.startsWith('/api/proxy'));
    const needsBackdropDownload = backdropUrl && (backdropUrl.startsWith('http') || backdropUrl.startsWith('/api/proxy'));

    if (needsPosterDownload || needsBackdropDownload) {
      const localImages = await ImageService.downloadMediaImages(
        tmdbId,
        validType,
        posterUrl,
        backdropUrl
      );

      // Update database with local image paths (posterUrl/backdropUrl)
      // Keep posterSourceUrl/backdropSourceUrl as original URLs for fallback
      const imageUpdate: any = {};
      if (localImages.posterUrl && localImages.posterUrl !== posterUrl) {
        imageUpdate.posterUrl = localImages.posterUrl; // Update to local path
        media.posterUrl = localImages.posterUrl;
        console.log(`[syncMediaItem] Updating posterUrl: ${posterUrl} -> ${localImages.posterUrl}`);
      }
      if (localImages.backdropUrl && localImages.backdropUrl !== backdropUrl) {
        imageUpdate.backdropUrl = localImages.backdropUrl; // Update to local path
        media.backdropUrl = localImages.backdropUrl;
        console.log(`[syncMediaItem] Updating backdropUrl: ${backdropUrl} -> ${localImages.backdropUrl}`);
      }

      if (Object.keys(imageUpdate).length > 0) {
        await prisma.media.update({ where: { id: media.id }, data: imageUpdate });
        console.log(`[syncMediaItem] Database updated with local image paths for tmdbId ${tmdbId}`);
      }
    }
  } catch (error) {
    console.warn(`[syncMediaItem] Failed to download images for tmdbId ${tmdbId}:`, error);
    // Continue without failing the entire sync
  }

  // If posterUrl is missing in DB but available from incoming item or Jellyseerr, try to persist it
  try {
    if ((!media.posterUrl || media.posterUrl === null) && (item?.posterUrl || validTitle)) {
      // Prefer incoming posterUrl
      const incomingPoster = item?.posterUrl ?? item?.poster_url ?? item?.poster_path ?? null;
      if (incomingPoster) {
        await prisma.media.update({ where: { id: media.id }, data: { posterUrl: incomingPoster } });
        media.posterUrl = incomingPoster;
      } else if (item?.title) {
        // Attempt to search Jellyseerr for a poster
        try {
          const candidates = await jellySearch(validTitle);
          if (Array.isArray(candidates) && candidates.length > 0) {
            const first = candidates.find(c => c.tmdb_id && Number(c.tmdb_id) === tmdbId) || candidates[0];
              const poster = first.posterUrl ?? null;
              if (poster) {
                await prisma.media.update({ where: { id: media.id }, data: { posterUrl: poster } });
                media.posterUrl = poster;
              }
              // Backfill other rich fields from Jellyseerr candidate when available
              const toUpdate: any = {};
              if (first.overview) toUpdate.overview = first.overview;
              if (first.backdropUrl) toUpdate.backdropUrl = first.backdropUrl;
              if (first.voteAverage !== undefined && first.voteAverage !== null) toUpdate.voteAverage = Number(first.voteAverage);
              if (first.language) toUpdate.language = String(first.language);
              if (Object.keys(toUpdate).length > 0) {
                await prisma.media.update({ where: { id: media.id }, data: toUpdate });
                Object.assign(media, toUpdate);
              }
          }
        } catch (inner) {
          // swallow search errors but log
          console.warn('Jellyseerr search failed during poster backfill for', validTitle, inner);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to persist posterUrl for media', tmdbId, e);
  }

  return media;
}

export async function updateMediaStatus(username: string, item: any, status: MediaStatus | string, accessToken?: string) {
  // Do not log full item or access token here to avoid leaking user tokens or PII.

  if (!username) throw new Error('username required');
  const tmdbId = parseTmdbId(item);
  if (!tmdbId) throw new Error('tmdbId is required to update status');

  const user = await prisma.user.upsert({
    where: { username },
    create: { username },
    update: {},
  });

  const media = await syncMediaItem(item);

  const statusVal = (typeof status === 'string' ? (status as string).toUpperCase() : status) as MediaStatus;

  // Minimal debug: log the user and tmdb id and intended status (no tokens or payloads)
  try {
    console.debug(`[DB Save] user=${username} tmdb=${tmdbId} status=${statusVal}`);
  } catch {}

  const upserted = await prisma.userMedia.upsert({
    where: { userId_mediaId: { userId: user.id, mediaId: media.id } },
    create: { userId: user.id, mediaId: media.id, status: statusVal },
    update: { status: statusVal },
  });

  return upserted;
}

export async function getUserData(username: string) {
  if (!username) return { watchedIds: [], watchlistIds: [], blockedIds: [] };

  const user = await prisma.user.findUnique({
    where: { username },
    include: { media: { include: { media: true } } },
  });

  if (!user) return { watchedIds: [], watchlistIds: [], blockedIds: [] };

  const watchedIds: number[] = [];
  const watchlistIds: number[] = [];
  const blockedIds: number[] = [];

  for (const um of user.media) {
    const tmdb = um.media?.tmdbId;
    if (!tmdb) continue;
    if (um.status === 'WATCHED') watchedIds.push(tmdb);
    else if (um.status === 'WATCHLIST') watchlistIds.push(tmdb);
    else if (um.status === 'BLOCKED') blockedIds.push(tmdb);
  }

  return { watchedIds, watchlistIds, blockedIds };
}

export async function getFullWatchlist(username: string) {
  if (!username) return [];

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return [];

  const entries = await prisma.userMedia.findMany({
    where: { userId: user.id, status: 'WATCHLIST' },
    include: { media: true },
    orderBy: { updatedAt: 'desc' },
  });

  return entries.map(e => ({
    tmdbId: e.media?.tmdbId ?? null,
    title: e.media?.title ?? '',
    posterUrl: e.media?.posterUrl ?? null, // Local path if downloaded, else proxy URL
    posterSourceUrl: e.media?.posterSourceUrl ?? null, // Original proxy/Jellyseerr URL
    overview: e.media?.overview ?? null,
    backdropUrl: e.media?.backdropUrl ?? null, // Local path if downloaded, else proxy URL
    backdropSourceUrl: e.media?.backdropSourceUrl ?? null, // Original proxy/Jellyseerr URL
    voteAverage: e.media?.voteAverage ?? null,
    language: e.media?.language ?? null,
    mediaType: e.media?.mediaType ?? 'movie',
    releaseYear: e.media?.releaseYear ?? '',
    status: e.status,
  }));
}

export async function removeFromWatchlist(username: string, item: any) {
  if (!username) throw new Error('username required');
  const tmdbId = parseTmdbId(item);
  if (!tmdbId) throw new Error('tmdbId required');

  try {
    // Delete by nested relation filters so we don't need to lookup user/media separately
    const result = await prisma.userMedia.deleteMany({
      where: {
        status: 'WATCHLIST',
        user: { username },
        media: { tmdbId },
      },
    });
    // result.count contains number of deleted records
    if (result.count && result.count > 0) return true;
    return false;
  } catch (e) {
    console.warn('Failed to remove watchlist entry', e);
    return false;
  }
}

export default prisma;
