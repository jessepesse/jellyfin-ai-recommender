import type { FrontendItem } from '../types';

export function matchesSelectedGenres(candidateGenres: string[], selectedGenres?: string[]): boolean {
  if (!selectedGenres || selectedGenres.length === 0) return true;
  return selectedGenres.some(selectedGenre => {
    const selectedLower = selectedGenre.toLowerCase();
    return candidateGenres.some(candidateGenre => {
      const candidateLower = candidateGenre.toLowerCase();
      return candidateLower.includes(selectedLower) || selectedLower.includes(candidateLower);
    });
  });
}

export function hasMoodSignal(
  candidateKeywords: string[],
  overview: string | undefined,
  moodKeywords?: string[]
): boolean {
  if (!moodKeywords || moodKeywords.length === 0) return true;

  const keywordsLower = candidateKeywords.map(k => k.toLowerCase());
  const hasKeywordMatch = moodKeywords.some(mk =>
    keywordsLower.some(k => k.includes(mk.toLowerCase()) || mk.toLowerCase().includes(k))
  );

  if (hasKeywordMatch) return true;

  const overviewLower = (overview || '').toLowerCase();
  return moodKeywords.some(mk => overviewLower.includes(mk.toLowerCase()));
}

export function shouldIncludeTmdbId(
  tmdbId: number,
  excludedIds: Set<number>,
  existingIds?: Set<number>
): boolean {
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return false;
  if (excludedIds.has(tmdbId)) return false;
  if (existingIds && existingIds.has(tmdbId)) return false;
  return true;
}

export function filterViewCacheByExclusions(
  viewCached: FrontendItem[] | undefined,
  excludedIds: Set<number>
): FrontendItem[] {
  if (!Array.isArray(viewCached) || viewCached.length === 0) return [];
  return viewCached.filter(item => {
    const tmdbId = item.tmdbId;
    if (!tmdbId) return false;
    return !excludedIds.has(tmdbId);
  });
}

export function shouldGenerateWhenViewCacheMiss(forceRefresh: boolean, filteredViewCacheCount: number): boolean {
  if (forceRefresh) return true;
  return filteredViewCacheCount > 0;
}

export function extractYear(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const year = Math.trunc(value);
    return year >= 1800 && year <= 3000 ? year : null;
  }
  const str = String(value).trim();
  const match = str.match(/^(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

export function isYearInRange(
  value: string | number | undefined | null,
  yearFrom?: number,
  yearTo?: number
): boolean {
  if (!yearFrom && !yearTo) return true;
  const year = extractYear(value);
  if (!year) return false;
  if (yearFrom && year < yearFrom) return false;
  if (yearTo && year > yearTo) return false;
  return true;
}
