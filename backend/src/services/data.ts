import { PrismaClient, MediaStatus } from '@prisma/client';
import { search as jellySearch } from './jellyseerr';

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

  const title = item?.title ?? item?.name ?? item?.Title ?? '';
  const mediaTypeRaw = item?.media_type ?? item?.mediaType ?? item?.type ?? 'movie';
  const mediaType = typeof mediaTypeRaw === 'string' && mediaTypeRaw.toLowerCase().startsWith('tv') ? 'tv' : 'movie';
  const posterUrl = item?.posterUrl ?? item?.poster_url ?? item?.poster_path ?? null;
  const releaseYear = item?.releaseYear ?? item?.release_year ?? (item?.year ? String(item.year) : null) ?? null;

  // Build update payload but avoid overwriting existing posterUrl with null/undefined
  const updateData: any = {
    title,
    mediaType,
    releaseYear,
  };
  if (posterUrl) updateData.posterUrl = posterUrl;

  const createData: any = {
    tmdbId,
    title,
    mediaType,
    posterUrl,
    releaseYear,
  };

  const media = await prisma.media.upsert({
    where: { tmdbId },
    update: updateData,
    create: createData,
  });

  // If posterUrl is missing in DB but available from incoming item or Jellyseerr, try to persist it
  try {
    if ((!media.posterUrl || media.posterUrl === null) && (item?.posterUrl || item?.title)) {
      // Prefer incoming posterUrl
      const incomingPoster = item?.posterUrl ?? item?.poster_url ?? item?.poster_path ?? null;
      if (incomingPoster) {
        await prisma.media.update({ where: { id: media.id }, data: { posterUrl: incomingPoster } });
        media.posterUrl = incomingPoster;
      } else if (item?.title) {
        // Attempt to search Jellyseerr for a poster
        try {
          const candidates = await jellySearch(item.title);
          if (Array.isArray(candidates) && candidates.length > 0) {
            const first = candidates.find(c => c.tmdb_id && Number(c.tmdb_id) === tmdbId) || candidates[0];
            const poster = first.posterUrl ?? null;
            if (poster) {
              await prisma.media.update({ where: { id: media.id }, data: { posterUrl: poster } });
              media.posterUrl = poster;
            }
          }
        } catch (inner) {
          // swallow search errors but log
          console.warn('Jellyseerr search failed during poster backfill for', item?.title, inner);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to persist posterUrl for media', tmdbId, e);
  }

  return media;
}

export async function updateMediaStatus(username: string, item: any, status: MediaStatus | string) {
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
    posterUrl: e.media?.posterUrl ?? null,
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
