import prisma from '../db';

interface ExportedItem {
  title: string;
  tmdb_id: number;
  media_type: string;
  release_year?: number;
  poster_url?: string;
  overview?: string;
  rating?: number;
  added_at?: string;
}

interface ExportData {
  username: string;
  exported_at: string;
  data: {
    movies: ExportedItem[];
    series: ExportedItem[];
    watchlist: {
      movies: ExportedItem[];
      series: ExportedItem[];
    };
    do_not_recommend: ExportedItem[];
  };
}

/**
 * Export user's database state to legacy JSON format
 */
export async function exportUserData(username: string): Promise<ExportData> {
  // Find user by username to get the correct userId
  const user = await prisma.user.findUnique({
    where: { username }
  });

  if (!user) {
    // Return empty export if user doesn't exist
    return {
      username,
      exported_at: new Date().toISOString(),
      data: {
        movies: [],
        series: [],
        watchlist: { movies: [], series: [] },
        do_not_recommend: []
      }
    };
  }

  // Fetch all user media records with associated media details
  const userMediaRecords = await prisma.userMedia.findMany({
    where: { userId: user.id },
    include: { media: true },
    orderBy: { updatedAt: 'desc' }
  });

  // Initialize export structure matching legacy format
  const exportData: ExportData = {
    username,
    exported_at: new Date().toISOString(),
    data: {
      movies: [],
      series: [],
      watchlist: {
        movies: [],
        series: []
      },
      do_not_recommend: []
    }
  };

  // Map database records to legacy format
  for (const record of userMediaRecords) {
    const media = record.media;

    const item: ExportedItem = {
      title: media.title,
      tmdb_id: media.tmdbId,
      media_type: media.mediaType,
      release_year: media.releaseYear ? parseInt(media.releaseYear) : undefined,
      poster_url: media.posterUrl || undefined,
      overview: media.overview || undefined,
      rating: media.voteAverage || undefined,
      added_at: record.updatedAt.toISOString()
    };

    // Route to appropriate list based on status and media type
    if (record.status === 'WATCHED') {
      if (media.mediaType === 'movie') {
        exportData.data.movies.push(item);
      } else if (media.mediaType === 'tv') {
        exportData.data.series.push(item);
      }
    } else if (record.status === 'WATCHLIST') {
      if (media.mediaType === 'movie') {
        exportData.data.watchlist.movies.push(item);
      } else if (media.mediaType === 'tv') {
        exportData.data.watchlist.series.push(item);
      }
    } else if (record.status === 'BLOCKED') {
      exportData.data.do_not_recommend.push(item);
    }
  }

  return exportData;
}

/**
 * Export all users' data (admin only)
 * Returns a map of username -> user data
 */
export async function exportAllUsersData(): Promise<Record<string, ExportData>> {
  const users = await prisma.user.findMany({
    select: { username: true }
  });

  const allData: Record<string, ExportData> = {};

  for (const user of users) {
    allData[user.username] = await exportUserData(user.username);
  }

  return allData;
}
