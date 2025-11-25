import prisma from './data';
import { JellyfinService } from '../jellyfin';
import { GeminiService } from './gemini';

const jellyfin = new JellyfinService();

export const TasteService = {
  async getProfile(username: string, type: 'movie' | 'tv') {
    if (!username) return '';
    try {
      const user = await prisma.user.findUnique({ where: { username } });
      if (!user) return '';
      const u: any = user as any;
      return type === 'tv' ? (u.tvProfile || '') : (u.movieProfile || '');
    } catch (e) {
      console.warn('Failed to get profile for', username, type, e);
      return '';
    }
  },

  async updateProfile(username: string, type: 'movie' | 'tv', accessToken?: string, userId?: string) {
    if (!username) throw new Error('username required');

    // Gather seed items: prefer Jellyfin history when accessToken+userId provided, else fall back to DB watchlist
    let seed: any[] = [];
    try {
      if (accessToken && userId) {
        const history = await jellyfin.getUserHistory(userId, accessToken);
        seed = Array.isArray(history) ? history.slice(0, 200) : [];
      }
    } catch (e) {
      console.warn('Failed to fetch Jellyfin history for profile update', e);
    }

    if (!seed || seed.length === 0) {
      // Fallback: use user's watchlist from DB
      try {
        const entries = await prisma.userMedia.findMany({ where: { user: { username }, status: 'WATCHLIST' }, include: { media: true }, take: 100 });
        seed = entries.map(e => ({ title: e.media?.title || '', release_year: e.media?.releaseYear || '' }));
      } catch (e) {
        console.warn('Failed to fetch watchlist entries for profile update', e);
      }
    }

    // Ask Gemini to generate a compact taste summary (only if enough data)
    if (seed && seed.length >= 3) {
      try {
        const summary = await GeminiService.summarizeProfile(username, seed, type);
        if (typeof summary === 'string') {
          const data: any = {};
          if (type === 'tv') data.tvProfile = summary;
          else data.movieProfile = summary;
          await prisma.user.upsert({ where: { username }, create: { username, ...data }, update: data });
          return summary;
        }
      } catch (e) {
        console.error('Failed to generate/save taste profile', e);
      }
    } else {
      console.debug(`[TasteService] Skipping profile generation: only ${seed?.length || 0} items (minimum 3 required)`);
    }

    return '';
  },

  // Fire-and-forget trigger; don't await in caller
  triggerUpdate(username: string, type: 'movie' | 'tv', accessToken?: string, userId?: string) {
    this.updateProfile(username, type, accessToken, userId).catch(e => console.warn('Background profile update failed', e));
  }
};

export default TasteService;
