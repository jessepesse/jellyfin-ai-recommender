import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';

// Hardcoded model name (clean ID, no "models/" prefix)
const modelName = 'gemini-2.5-flash-lite';
console.log('⚠️ USING HARDCODED MODEL:', modelName);

// Initialize SDK client with API key from env (constructor accepts api key string)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Zod schema for validated AI output
// NOTE: Gemini must NOT return any IDs. We only accept title, media_type, release_year and reason.
const RecommendationSchema = z.array(z.object({
  title: z.string(),
  media_type: z.union([z.literal('movie'), z.literal('tv'), z.string()]).optional(),
  // release_year may be number or string (some models produce strings)
  release_year: z.union([z.string(), z.number()]),
  reason: z.string().optional(),
}));

export class GeminiService {
  // Build prompt similar to legacy implementation

  private static buildPrompt(username: string, userData: any, candidates: any[], filters?: { type?: string; genre?: string }): string {
    // Prefer Jellyfin history if available (contains titles). Otherwise fall back to empty lists.
    const history = Array.isArray(userData?.jellyfin_history) ? userData.jellyfin_history : [];
    const watched = history.map((m: any) => `${m.Name || m.title || m.name || '(unknown)'} (${m.MediaType || m.media_type || 'movie'})`).join('\n');

    // userData may contain only tmdb ID arrays (watchedIds/watchlistIds/blockedIds). We can't resolve titles here,
    // so include counts to give Gemini context without exposing raw IDs.
    const watchlistCount = Array.isArray(userData?.watchlistIds) ? userData.watchlistIds.length : 0;
    const blacklistCount = Array.isArray(userData?.blockedIds) ? userData.blockedIds.length : 0;

    const watchlist = watchlistCount ? `${watchlistCount} items in watchlist` : '(none)';
    const blacklist = blacklistCount ? `${blacklistCount} items blacklisted` : '(none)';

    // Exclude any candidates that are already watched, in watchlist, or blocked according to userData IDs.
    const watchedIds = Array.isArray(userData?.watchedIds) ? new Set(userData.watchedIds.map((i: any) => Number(i))) : new Set<number>();
    const watchlistIds = Array.isArray(userData?.watchlistIds) ? new Set(userData.watchlistIds.map((i: any) => Number(i))) : new Set<number>();
    const blockedIds = Array.isArray(userData?.blockedIds) ? new Set(userData.blockedIds.map((i: any) => Number(i))) : new Set<number>();

    const normalize = (s: string) => (s || '').toString().toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\bthe |\ba /g, '').trim();
    const watchedTitlesNormalized = new Set(history.map((m: any) => normalize(m.Name || m.title || m.name || '')).filter(Boolean));

    const filteredCandidates = (candidates || []).filter((m: any) => {
      const tmdb = Number((m as any).tmdb_id ?? (m as any).tmdbId ?? 0) || 0;
      const titleNorm = normalize(m?.Name ?? m?.title ?? m?.name ?? '');
      // Exclude by trusted TMDB id
      if (tmdb) {
        if (watchedIds.has(tmdb) || watchlistIds.has(tmdb) || blockedIds.has(tmdb)) return false;
      }
      // Exclude by title match to user's history/watchlist titles
      if (titleNorm && watchedTitlesNormalized.has(titleNorm)) return false;
      return true;
    });

    const candidateList = filteredCandidates.slice(0, 100).map(m => `${m.Name || m.title || m.name || 'Unknown'} (${m.MediaType || m.media_type || 'movie'})`).join('\n');

    const system = `You are an assistant that suggests movies and TV series for a user. Respond ONLY with a JSON array. For each recommendation, include exactly: {"title": string, "media_type": "movie"|"tv", "release_year": number|string, "reason": string}. Do NOT include any TMDB IDs or other identifiers. Do not include any extra text.`;

    const filterNotes: string[] = [];
    if (filters?.type) filterNotes.push(`Only recommend content of type: ${filters.type}`);
    if (filters?.genre) filterNotes.push(`Prefer only the following genres: ${filters.genre}`);

    // Build explicit exclusion lists (titles) from explicit Jellyfin history when available.
    const watchedTitles = history.map((m: any) => (m.Name || m.title || m.name || '').trim()).filter(Boolean);

    const prompt = [
      system,
      `User: ${username}`,
      `Watched (most relevant first):\n${watched || '(none)'} `,
      `Watchlist:\n${watchlist} `,
      `Do not recommend (blacklist):\n${blacklist} `,
      `Candidate pool (only consider these):\n${candidateList || '(none)'} `,
      // Also explicitly tell Gemini to never recommend titles we already know the user has seen or listed.
      watchedTitles.length ? `Do NOT recommend these exact titles (user has watched or already listed):\n${watchedTitles.slice(0,50).join('\n')}` : '',
      `Return up to 10 recommendations in JSON. Filter out anything already watched or blacklisted. Prefer high-rated, recent, and genre-similar items.`,
      ...(filterNotes.length ? [`Constraints: ${filterNotes.join('; ')}`] : []),
    ].join('\n\n');

    return prompt;
  }

  public static async getRecommendations(username: string, userData: any, candidates: any[], filters?: { type?: string; genre?: string }): Promise<any[]> {
    const prompt = this.buildPrompt(username, userData, candidates, filters);

    try {
      console.log('Attempting to call Gemini via official SDK with model:', modelName);
      console.log('GEMINI_API_KEY present:', !!process.env.GEMINI_API_KEY);

      const model: any = genAI.getGenerativeModel({ model: modelName });
      // Ensure prompt is a string
      const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

      // Prefer structured JSON response via zod->JSON Schema when available.
      // This reduces parsing errors and enforces our expected schema on the model output.
      let response: any;
      try {
        const { zodToJsonSchema } = await import('zod-to-json-schema');
        // Cast to any to avoid TypeScript incompatibilities between zod versions/types.
        const schema = (zodToJsonSchema as any)(RecommendationSchema as any);
        // Try the higher-level API on the SDK if present (some SDK versions expose `models.generateContent`)
        if ((genAI as any)?.models && typeof (genAI as any).models.generateContent === 'function') {
          response = await (genAI as any).models.generateContent({
            model: modelName,
            contents: promptText,
            config: { responseMimeType: 'application/json', responseJsonSchema: schema },
          });
        } else {
          // Fall back to model instance method but pass a config object if it accepts one
          // (older SDKs accept a plain string; we try an object and fall back if it errors)
          try {
            response = await model.generateContent({ contents: promptText, config: { responseMimeType: 'application/json', responseJsonSchema: schema } });
          } catch (inner) {
            // If the SDK doesn't support structured response, fall back to simple call
            response = await model.generateContent(promptText);
          }
        }
      } catch (e) {
        // If zod-to-json-schema isn't available or something went wrong, fall back to existing behavior
        response = await model.generateContent(promptText);
      }

      // Extract text from the SDK response
      let text = '';
      try {
        const body = response?.response;
        if (body && typeof body.text === 'function') {
          const maybe = body.text();
          text = (maybe instanceof Promise) ? await maybe : maybe;
        } else if (typeof response?.response === 'string') {
          text = response.response;
        } else {
          text = JSON.stringify(response);
        }
      } catch (e) {
        console.warn('Failed to extract text from Gemini SDK response, falling back to JSON stringify', e);
        text = JSON.stringify(response);
      }

      if (!text) {
        console.warn('Gemini SDK returned no text; using heuristic fallback');
        throw new Error('Empty Gemini response');
      }

      // Extract JSON array from text. Only attempt JSON.parse when a JSON array is found.
      const first = text.indexOf('[');
      const last = text.lastIndexOf(']');
      if (first === -1 || last === -1 || last <= first) {
        console.warn('No JSON array found in Gemini output; skipping parse. Raw output:', text.substring(0, 200));
      } else {
        const jsonText = text.substring(first, last + 1);
        try {
          const parsed = JSON.parse(jsonText);
          const validated = RecommendationSchema.safeParse(parsed);
          if (validated.success) {
            // Return parsed items but importantly DO NOT include any TMDB id from Gemini.
            // We include release_year and reason so downstream enrichment can use year matching.
            return validated.data.map((p: any) => ({
              title: p.title,
              media_type: p.media_type || 'movie',
              release_year: p.release_year,
              reason: p.reason,
            }));
          } else {
            console.warn('Gemini output failed Zod validation:', validated.error);
          }
        } catch (e) {
          console.error('Failed to parse Gemini JSON output:', e);
        }
      }
    } catch (e: any) {
      try { console.error('Gemini SDK Error:', JSON.stringify(e, Object.getOwnPropertyNames(e), 2)); } catch { console.error('Gemini SDK Error (string):', String(e)); }
      console.error('Gemini SDK error.response:', (e as any)?.response);
      console.error('Gemini SDK error.message:', (e as any)?.message);
      console.error('Gemini SDK error.status:', (e as any)?.status || (e as any)?.response?.status);
      console.warn('Gemini SDK failed; using heuristic fallback');
    }

    // Fallback heuristic
    try {
      const scored = (candidates || []).slice().sort((a: any, b: any) => (b.CommunityRating ?? 0) - (a.CommunityRating ?? 0));
      return scored.slice(0, 10).map((s: any) => ({ title: s.Name || s.title || 'Unknown', media_type: s.MediaType || s.media_type || 'movie', tmdb_id: s.tmdb_id }));
    } catch (e) {
      console.error('Fallback recommender error:', e);
    }

    return [];
  }
}

