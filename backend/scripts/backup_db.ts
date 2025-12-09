import prisma from '../src/db';
import * as fs from 'fs';
import * as path from 'path';

interface BackupData {
  version: string;
  exported_at: string;
  system_config: {
    jellyfinUrl?: string;
    jellyseerrUrl?: string;
    jellyseerrApiKey?: string;
    geminiApiKey?: string;
    geminiModel?: string;
    isConfigured: boolean;
  } | null;
  users: Array<{
    username: string;
    movieProfile?: string;
    tvProfile?: string;
    data: {
      movies: any[];
      series: any[];
      watchlist: {
        movies: any[];
        series: any[];
      };
      do_not_recommend: any[];
    };
  }>;
}

/**
 * Backup script that exports the entire database state to JSON.
 * This creates a portable backup file that can be used for disaster recovery.
 */
async function backupDatabase() {
  try {
    console.log('🔄 Starting database backup...');

    // Fetch system configuration
    const systemConfig = await prisma.systemConfig.findUnique({
      where: { id: 1 }
    });

    // Fetch all users
    const users = await prisma.user.findMany({
      include: {
        media: {
          include: {
            media: true
          }
        }
      }
    });

    const backupData: BackupData = {
      version: '2.0.3',
      exported_at: new Date().toISOString(),
      system_config: systemConfig ? {
        jellyfinUrl: systemConfig.jellyfinUrl || undefined,
        jellyseerrUrl: systemConfig.jellyseerrUrl || undefined,
        jellyseerrApiKey: systemConfig.jellyseerrApiKey || undefined,
        geminiApiKey: systemConfig.geminiApiKey || undefined,
        geminiModel: systemConfig.geminiModel,
        isConfigured: systemConfig.isConfigured
      } : null,
      users: []
    };

    // Process each user's data
    for (const user of users) {
      const userData = {
        username: user.username,
        movieProfile: user.movieProfile || undefined,
        tvProfile: user.tvProfile || undefined,
        data: {
          movies: [] as any[],
          series: [] as any[],
          watchlist: {
            movies: [] as any[],
            series: [] as any[]
          },
          do_not_recommend: [] as any[]
        }
      };

      // Organize media by status and type
      for (const userMedia of user.media) {
        const media = userMedia.media;

        const item = {
          title: media.title,
          tmdb_id: media.tmdbId,
          media_type: media.mediaType,
          release_year: media.releaseYear || undefined,
          poster_url: media.posterUrl || undefined,
          overview: media.overview || undefined,
          backdrop_url: media.backdropUrl || undefined,
          vote_average: media.voteAverage || undefined,
          added_at: userMedia.updatedAt.toISOString()
        };

        if (userMedia.status === 'WATCHED') {
          if (media.mediaType === 'movie') {
            userData.data.movies.push(item);
          } else if (media.mediaType === 'tv') {
            userData.data.series.push(item);
          }
        } else if (userMedia.status === 'WATCHLIST') {
          if (media.mediaType === 'movie') {
            userData.data.watchlist.movies.push(item);
          } else if (media.mediaType === 'tv') {
            userData.data.watchlist.series.push(item);
          }
        } else if (userMedia.status === 'BLOCKED') {
          userData.data.do_not_recommend.push(item);
        }
      }

      backupData.users.push(userData);
    }

    // Determine output path
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
    const outputPath = path.join(dataDir, 'backup_latest.json');

    // Also create a timestamped backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const timestampedPath = path.join(dataDir, `backup_${timestamp}.json`);

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Write backup files
    const jsonContent = JSON.stringify(backupData, null, 2);
    fs.writeFileSync(outputPath, jsonContent, 'utf8');
    fs.writeFileSync(timestampedPath, jsonContent, 'utf8');

    const stats = {
      users: backupData.users.length,
      totalMedia: backupData.users.reduce((sum, u) =>
        sum + u.data.movies.length + u.data.series.length +
        u.data.watchlist.movies.length + u.data.watchlist.series.length +
        u.data.do_not_recommend.length, 0)
    };

    console.log('✅ Database backup completed successfully!');
    console.log(`📁 Latest backup: ${outputPath}`);
    console.log(`📁 Timestamped backup: ${timestampedPath}`);
    console.log(`📊 Backed up ${stats.users} user(s) with ${stats.totalMedia} media items`);

    return { success: true, outputPath, timestampedPath, stats };
  } catch (error) {
    console.error('❌ Database backup failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if executed directly
if (require.main === module) {
  backupDatabase().catch((error) => {
    console.error('Fatal error during backup:', error);
    process.exit(1);
  });
}

export { backupDatabase };
