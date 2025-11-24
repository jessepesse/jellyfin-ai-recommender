import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import ConfigService from './config';

// Default model with thinking support enabled
// Gemini 2.5+ and 3.0+ models automatically use internal thinking for improved reasoning
// Thinking dynamically adjusts based on prompt complexity
const modelName = 'gemini-2.5-flash-lite';
console.debug('Using Gemini model:', modelName);

// Construct SDK client at runtime and return both the raw client, the generative model instance, and the resolved model name
async function buildClientAndModel(): Promise<{ client: any; model: any; modelName: string }> {
  const cfg = await ConfigService.getConfig();
  const rawKey = (cfg && cfg.geminiApiKey) ? String(cfg.geminiApiKey) : (process.env.GEMINI_API_KEY || '');
  const apiKey = rawKey ? rawKey.trim() : '';
  const source = (cfg && cfg.geminiApiKey) ? 'DB' : (process.env.GEMINI_API_KEY ? 'ENV' : 'NONE');
  if (!apiKey) {
    throw new Error('Gemini API key not configured');
  } else {
    try {
      const mask = (k: string) => {
        if (!k) return '***';
        if (k.length <= 8) return '****';
        return `${k.slice(0,4)}...${k.slice(-4)}`;
      };
      console.info(`Gemini key source: ${source}; key (masked): ${mask(apiKey)}`);
    } catch (e) {
      // best-effort logging only
    }
  }

  // Instantiate SDK client (pass API key as string directly)
  const client = new GoogleGenerativeAI(apiKey);

  // Obtain the model object from the client
  const modelNameFromCfg = cfg && cfg.geminiModel ? String(cfg.geminiModel).trim() : modelName;
  const model = client.getGenerativeModel({ model: modelNameFromCfg });
  
  return { client, model, modelName: modelNameFromCfg };
}

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
  /**
   * Formats a list of items into a compact table:
   * | Title | Year |
   */
  private static formatTable(list: any[]): string {
    if (!list || list.length === 0) return '(none)';

    const uniqueEntries = new Set<string>();
    const rows: string[] = [];

    list.forEach(item => {
      let title = '';
      let year = '';

      if (typeof item === 'string') {
        title = item;
      } else {
        title = item.title || item.Name || item.name || '';
        year = item.release_year || item.ProductionYear || item.releaseDate || item.year || '';
        if (typeof year !== 'string') year = String(year || '');
      }

      title = String(title).replace(/\|/g, '').trim();
      year = (year || '').toString().substring(0, 4);

      if (title) {
        const entryKey = `${title.toLowerCase()}:${year}`;
        if (!uniqueEntries.has(entryKey)) {
          uniqueEntries.add(entryKey);
          rows.push(`| ${title} | ${year} |`);
        }
      }
    });

    return rows.join('\n');
  }

  private static buildPrompt(username: string, userData: any, likedItems: any[], dislikedItems: any[], filters?: { type?: string; genre?: string }): string {
    // Backwards-compatible buildPrompt that can accept a precomputed tasteProfile and an exclusionTable
    return (username && userData) ? this.buildPromptWithProfile(username, userData, likedItems, dislikedItems, filters) : '';
  }

  // New prompt builder that prefers a provided taste profile and an explicit exclusion table
  private static buildPromptWithProfile(username: string, userData: any, likedItems: any[], dislikedItems: any[], filters?: { type?: string; genre?: string }, tasteProfile?: string, exclusionTable?: string) {
    const mediaType = filters?.type ? String(filters.type).toUpperCase() : 'MOVIE OR TV SERIES';
    const genreNote = filters?.genre ? `Focus strictly on the genre: "${filters.genre}".` : 'Recommend diverse genres that match the user\'s taste.';

    const hasProfile = !!tasteProfile && String(tasteProfile).trim().length > 10;
    const fallbackProfile = `No explicit taste profile is available for this user.\nFor the purposes of recommendation, assume a broadly-curated, mainstream taste that prefers well-rated, accessible titles across popular genres (drama, action, comedy, thriller, family).\nProvide diverse suggestions (mix of recent and classic titles) that would suit a general audience.\nEven if user history is empty, you MUST provide recommendations immediately. Do not ask clarifying questions.`;
    const profileSection = hasProfile ? tasteProfile as string : `${fallbackProfile}\n\nSeed Titles:\n${this.formatTable(Array.isArray(likedItems) ? likedItems.slice(0, 100) : [])}`;
    const exclusionSection = exclusionTable && exclusionTable.length > 0 ? exclusionTable : this.formatTable(Array.isArray(dislikedItems) ? dislikedItems : []);

    return `\n### 🧠 USER TASTE ANALYSIS\n${profileSection}\n\n### ⛔ EXCLUSION DATABASE (DO NOT SUGGEST THESE ITEMS)\n| Title | Year |\n|---|---|\n${exclusionSection}\n\n### TASK\nBased on the "Taste Analysis", recommend exactly 30 NEW items.\nStrictly avoid items in the "Exclusion Database".\n- TYPE: ${mediaType}\n- GENRE: ${genreNote}\n\n### IMPORTANT INSTRUCTIONS\n- Even if the user has no history or the profile is empty, you MUST produce recommendations immediately. Do not ask clarifying questions or for additional information.\n- DO NOT output any external IDs (TMDB, IMDB, etc.). Only return titles, type, year, and a short reason.\n\n### OUTPUT FORMAT\nRespond ONLY with a JSON array of objects with keys: title, media_type (movie|tv), release_year (YYYY), reason.\n`;
  }

  // Summarize a user's taste profile using Gemini (compact text)
  // Thinking is automatically enabled for 2.5+ and 3.0+ models
  public static async summarizeProfile(username: string, seedItems: any[], type: 'movie' | 'tv'): Promise<string> {
    try {
      const { client: genAIClient, model, modelName: runtimeModelName } = await buildClientAndModel();
      const titles = (seedItems || []).slice(0, 80).map((s: any) => typeof s === 'string' ? s : (s.title || s.Name || s.name || '')).filter(Boolean).slice(0, 80);
      const prompt = `Summarize the user's ${type} taste in 2-3 concise bullet points based on these titles:\n${titles.join('\n')}`;
      
      // Use modern API with thinking support
      const resp = await model.generateContent({ contents: prompt });
      let text = '';
      try {
        const body = resp?.response;
        if (body && typeof body.text === 'function') {
          const maybe = body.text();
          text = (maybe instanceof Promise) ? await maybe : maybe;
        } else if (typeof resp?.response === 'string') {
          text = resp.response;
        } else {
          text = String(resp);
        }
      } catch (e) {
        text = String(resp);
      }
      return (text || '').trim().substring(0, 2000);
    } catch (e) {
      console.warn('summarizeProfile failed', e);
      return '';
    }
  }

  public static async getRecommendations(username: string, userData: any, likedItems: any[], dislikedItems: any[], filters?: { type?: string; genre?: string }, tasteProfile?: string, exclusionTable?: string): Promise<any[]> {
    const prompt = this.buildPromptWithProfile(username, userData, likedItems, dislikedItems, filters, tasteProfile, exclusionTable);

    try {
      console.debug('Attempting to call Gemini via official SDK with model:', modelName);

      const { client: genAIClient, model, modelName: runtimeModelName } = await buildClientAndModel();
      // Ensure prompt is a string
      const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

      // Use modern Gemini API with thinking support (for 2.5+ and 3.0+ models)
      // Thinking is automatically enabled for supported models and adjusts dynamically based on prompt complexity
      let response: any;
      try {
        const { zodToJsonSchema } = await import('zod-to-json-schema');
        // Cast to any to avoid TypeScript incompatibilities between zod versions/types.
        const schema = (zodToJsonSchema as any)(RecommendationSchema as any);
        
        // Modern API call structure for thinking models
        // Use model.generateContent with proper request format
        response = await model.generateContent({
          contents: promptText,
          generationConfig: { 
            responseMimeType: 'application/json', 
            responseSchema: schema 
          }
        });
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
      const scored = (likedItems || []).slice().sort((a: any, b: any) => (b.CommunityRating ?? 0) - (a.CommunityRating ?? 0));
      return scored.slice(0, 10).map((s: any) => ({ title: s.Name || s.title || 'Unknown', media_type: s.MediaType || s.media_type || 'movie', tmdb_id: s.tmdb_id }));
    } catch (e) {
      console.error('Fallback recommender error:', e);
    }

    return [];
  }
}

