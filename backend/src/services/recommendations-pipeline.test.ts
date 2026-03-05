import {
  filterViewCacheByExclusions,
  hasMoodSignal,
  matchesSelectedGenres,
  shouldGenerateWhenViewCacheMiss,
  shouldIncludeTmdbId,
} from './recommendations-pipeline';

describe('recommendations pipeline helpers', () => {
  describe('exclusion and duplicate rules', () => {
    it('excludes IDs already in excluded set', () => {
      const excludedIds = new Set<number>([101, 202]);
      expect(shouldIncludeTmdbId(101, excludedIds)).toBe(false);
      expect(shouldIncludeTmdbId(303, excludedIds)).toBe(true);
    });

    it('blocks duplicates already in existing set', () => {
      const excludedIds = new Set<number>();
      const existingIds = new Set<number>([42]);
      expect(shouldIncludeTmdbId(42, excludedIds, existingIds)).toBe(false);
      expect(shouldIncludeTmdbId(43, excludedIds, existingIds)).toBe(true);
    });
  });

  describe('genre filters', () => {
    it('matches when at least one selected genre matches candidate genres', () => {
      const candidateGenres = ['Science Fiction', 'Thriller'];
      const selectedGenres = ['Comedy', 'Action', 'Science Fiction'];
      expect(matchesSelectedGenres(candidateGenres, selectedGenres)).toBe(true);
    });

    it('rejects when no selected genres match candidate genres', () => {
      const candidateGenres = ['Drama', 'Romance'];
      const selectedGenres = ['Horror', 'Animation'];
      expect(matchesSelectedGenres(candidateGenres, selectedGenres)).toBe(false);
    });
  });

  describe('mood filters', () => {
    it('matches mood from keywords', () => {
      const keywords = ['Plot Twist', 'Psychological'];
      const moodKeywords = ['plot twist', 'dream'];
      expect(hasMoodSignal(keywords, 'No overview needed', moodKeywords)).toBe(true);
    });

    it('matches mood from overview fallback', () => {
      const keywords: string[] = [];
      const overview = 'A surreal and dreamlike journey through memory.';
      const moodKeywords = ['dream', 'nonlinear timeline'];
      expect(hasMoodSignal(keywords, overview, moodKeywords)).toBe(true);
    });

    it('rejects mood when neither keywords nor overview match', () => {
      const keywords = ['friendship', 'small town'];
      const overview = 'A quiet comedy about neighborhood life.';
      const moodKeywords = ['serial killer', 'revenge'];
      expect(hasMoodSignal(keywords, overview, moodKeywords)).toBe(false);
    });
  });

  describe('view cache behavior', () => {
    it('does not generate when refresh=false and view cache miss', () => {
      expect(shouldGenerateWhenViewCacheMiss(false, 0)).toBe(false);
    });

    it('generates when refresh=true regardless of cache count', () => {
      expect(shouldGenerateWhenViewCacheMiss(true, 0)).toBe(true);
      expect(shouldGenerateWhenViewCacheMiss(true, 5)).toBe(true);
    });

    it('filters acted-upon items from cached view', () => {
      const cached = [
        { tmdbId: 1, title: 'A' },
        { tmdbId: 2, title: 'B' },
        { tmdbId: null, title: 'Invalid' },
      ] as any;
      const excluded = new Set<number>([2]);
      const filtered = filterViewCacheByExclusions(cached, excluded);
      expect(filtered.map((x: any) => x.tmdbId)).toEqual([1]);
    });
  });
});
