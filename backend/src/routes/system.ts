/**
 * System routes - Configuration, setup, health checks, and image proxy
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import ConfigService from '../services/config';
import { sanitizeUrl, validateRequestUrl, validateSafeUrl } from '../utils/ssrf-protection';
import { validateConfigUpdate } from '../middleware/validators';

const router = Router();

/**
 * Image Proxy Endpoint - Routes images through backend to avoid 403 from external Jellyseerr
 */
router.get('/proxy/image', async (req, res) => {
    try {
        const path = req.query.path as string;
        const type = (req.query.type as string) || 'poster';
        
        if (!path) {
            return res.status(400).json({ error: 'Missing path parameter' });
        }

        // Get Jellyseerr config (supports dynamic runtime config)
        const config = await ConfigService.getConfig();
        const jellyseerrUrl = config.jellyseerrUrl;
        
        if (!jellyseerrUrl) {
            return res.status(503).json({ error: 'Jellyseerr URL not configured' });
        }

        // Handle two cases: 
        // 1. Absolute URLs (http://...) - proxy them directly
        // 2. Relative paths (/xxx.jpg) - construct Jellyseerr URL
        let imageUrl: string;
        
        if (path.startsWith('http://') || path.startsWith('https://')) {
            imageUrl = path;
        } else {
            const baseUrl = jellyseerrUrl;
            let upstreamPrefix = '/imageproxy/tmdb/t/p/w300_and_h450_face'; // Default: Poster
            if (type === 'backdrop') {
                upstreamPrefix = '/imageproxy/tmdb/t/p/w1920_and_h800_multi_faces';
            }
            imageUrl = `${baseUrl}${upstreamPrefix}${path}`;
        }
        
        const validatedUrl = validateRequestUrl(imageUrl);
        const headers: Record<string, string> = {};
        if (config.jellyseerrApiKey) {
            headers['X-Api-Key'] = config.jellyseerrApiKey;
        }

        // codeql[js/request-forgery] - False positive: URL validated 2x (validateRequestUrl, validateSafeUrl). Self-hosted design allows internal URLs.
        const response = await axios.get(validateSafeUrl(validatedUrl), {
            responseType: 'arraybuffer',
            headers,
            timeout: 10000
        });

        const contentType = response.headers['content-type'] || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(response.data);
    } catch (error: any) {
        console.error('Image proxy error:', error?.message || error);
        if (error?.response?.status) {
            res.status(error.response.status).json({ 
                error: `Failed to fetch image: ${error.response.status}` 
            });
        } else {
            res.status(500).json({ error: 'Failed to fetch image' });
        }
    }
});

/**
 * GET /system/status - Check if system is configured
 */
router.get('/status', async (req, res) => {
    try {
        const cfg = await ConfigService.getConfig();
        const configured = !!cfg && !!cfg.isConfigured;
        res.json({ configured });
    } catch (e) {
        console.error('Failed to read system config status', e);
        res.status(500).json({ error: 'Failed to read system config status' });
    }
});

/**
 * GET /system/setup-defaults - Pre-fill values for Setup Wizard
 */
router.get('/setup-defaults', async (req, res) => {
    try {
        const dbCfg = await ConfigService.getConfig();
        const defaults = {
            jellyfinUrl: process.env.JELLYFIN_URL || dbCfg?.jellyfinUrl || null,
            jellyseerrUrl: process.env.JELLYSEERR_URL || dbCfg?.jellyseerrUrl || null,
            jellyseerrApiKey: process.env.JELLYSEERR_API_KEY || dbCfg?.jellyseerrApiKey || null,
            geminiApiKey: process.env.GEMINI_API_KEY || dbCfg?.geminiApiKey || null,
            geminiModel: process.env.GEMINI_MODEL || dbCfg?.geminiModel || 'gemini-2.5-flash-lite',
        };
        res.json(defaults);
    } catch (e) {
        console.error('Failed to fetch setup defaults', e);
        res.status(500).json({ error: 'Failed to fetch setup defaults' });
    }
});

/**
 * POST /system/verify - Verify connectivity to external services
 */
router.post('/verify', async (req, res) => {
    try {
        const payload = req.body || {};
        const jellyfinUrlRaw = payload.jellyfinUrl as string | undefined;
        const jellyseerrUrlRaw = payload.jellyseerrUrl as string | undefined;
        const jellyseerrApiKey = payload.jellyseerrApiKey as string | undefined;
        const geminiApiKey = payload.geminiApiKey as string | undefined;

        // Jellyfin check
        const jellyfinCheck = (async () => {
            try {
                let base = sanitizeUrl(jellyfinUrlRaw);
                if (!base) return { ok: false, message: 'No Jellyfin URL provided or invalid' };
                if (base.endsWith('/')) base = base.slice(0, -1);
                const url = validateRequestUrl(`${base}/System/Info/Public`);
                // codeql[js/request-forgery] - False positive: URL validated 3x (sanitizeUrl, validateRequestUrl, validateSafeUrl)
                const resp = await axios.get(validateSafeUrl(url), { timeout: 8000 });
                if (resp.status === 200) {
                    const ver = resp.data?.Version || resp.data?.ServerVersion || resp.data?.version || '';
                    return { ok: true, message: ver ? `Connected to ${ver}` : 'Connected' };
                }
                return { ok: false, message: `HTTP ${resp.status}` };
            } catch (e: any) {
                const msg = e?.response ? `${e.response.status} ${e.response.statusText || ''}`.trim() : (e?.message || String(e));
                return { ok: false, message: msg };
            }
        })();

        // Jellyseerr check
        const jellyseerrCheck = (async () => {
            try {
                const base = sanitizeUrl(jellyseerrUrlRaw);
                if (!base) return { ok: false, message: 'No Jellyseerr URL provided or invalid' };
                const url = validateRequestUrl(`${base}/api/v1/status`);
                const headers: Record<string, string> = {};
                if (jellyseerrApiKey) headers['X-Api-Key'] = String(jellyseerrApiKey);
                // codeql[js/request-forgery] - False positive: URL validated 3x (sanitizeUrl, validateRequestUrl, validateSafeUrl)
                const resp = await axios.get(validateSafeUrl(url), { headers, timeout: 8000 });
                if (resp.status === 200) {
                    const info = resp.data?.status || resp.data?.message || 'OK';
                    return { ok: true, message: String(info) };
                }
                return { ok: false, message: `HTTP ${resp.status}` };
            } catch (e: any) {
                const msg = e?.response ? `${e.response.status} ${e.response.statusText || ''}`.trim() : (e?.message || String(e));
                return { ok: false, message: msg };
            }
        })();

        // Gemini check
        const geminiCheck = (async () => {
            try {
                if (!geminiApiKey) return { ok: false, message: 'No Gemini API key provided' };
                let client: any;
                try {
                    client = new (GoogleGenerativeAI as any)({ apiKey: String(geminiApiKey) });
                } catch {
                    try { client = new (GoogleGenerativeAI as any)(String(geminiApiKey)); } catch (i2) { throw i2; }
                }
                try {
                    if (typeof client.listModels === 'function') {
                        await client.listModels({ pageSize: 1 });
                    } else if (typeof client.models?.list === 'function') {
                        await client.models.list({ pageSize: 1 });
                    }
                } catch (callErr: any) {
                    return { ok: false, message: String(callErr?.message || callErr) };
                }
                return { ok: true, message: 'OK' };
            } catch (e: any) {
                return { ok: false, message: String(e?.message || e) };
            }
        })();

        const [jRes, jsRes, gRes] = await Promise.all([jellyfinCheck, jellyseerrCheck, geminiCheck]);
        res.json({ jellyfin: jRes, jellyseerr: jsRes, gemini: gRes });
    } catch (err: any) {
        console.error('Verification endpoint error', err);
        res.status(500).json({ error: 'Verification failed', detail: String(err?.message || err) });
    }
});

/**
 * GET /system/config - Debug endpoint for full config (requires x-debug header)
 */
router.get('/config', async (req, res) => {
    try {
        const debugHeader = req.headers['x-debug'];
        if (!debugHeader || String(debugHeader) !== '1') {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const cfg = await ConfigService.getConfig();
        res.json({ ok: true, config: cfg });
    } catch (e) {
        console.error('Failed to read system config', e);
        res.status(500).json({ error: 'Failed to read system config' });
    }
});

/**
 * POST /system/setup - Initial setup from wizard
 */
router.post('/setup', async (req, res) => {
    try {
        const payload = req.body || {};
        const allowed = {
            jellyfinUrl: payload.jellyfinUrl,
            jellyseerrUrl: payload.jellyseerrUrl,
            jellyseerrApiKey: payload.jellyseerrApiKey,
            geminiApiKey: payload.geminiApiKey,
            geminiModel: payload.geminiModel,
        };
        const result = await ConfigService.saveConfig(allowed);
        res.json({ ok: true, result });
    } catch (e) {
        console.error('Failed to save system config', e);
        res.status(500).json({ error: 'Failed to save system config' });
    }
});

/**
 * GET /system/config-editor - Fetch config with masked API keys for Settings UI
 */
router.get('/config-editor', async (req, res) => {
    try {
        const cfg = await ConfigService.getConfig();
        
        const maskApiKey = (key: string | null | undefined): string => {
            if (!key) return '';
            if (key.length <= 8) return '********';
            return `${'*'.repeat(key.length - 4)}${key.slice(-4)}`;
        };

        const masked = {
            jellyfinUrl: cfg.jellyfinUrl || '',
            jellyseerrUrl: cfg.jellyseerrUrl || '',
            jellyseerrApiKey: maskApiKey(cfg.jellyseerrApiKey),
            geminiApiKey: maskApiKey(cfg.geminiApiKey),
            geminiModel: cfg.geminiModel || 'gemini-2.5-flash-lite',
            isConfigured: cfg.isConfigured || false,
        };

        res.json({ ok: true, config: masked });
    } catch (e) {
        console.error('Failed to fetch config for editor', e);
        res.status(500).json({ error: 'Failed to fetch configuration' });
    }
});

/**
 * PUT /system/config-editor - Update config from Settings UI
 */
router.put('/config-editor', validateConfigUpdate, async (req: Request, res: Response) => {
    try {
        const payload = req.body || {};
        const currentConfig = await ConfigService.getConfig();
        
        const isMasked = (value: string | null | undefined): boolean => {
            if (!value) return false;
            return /^\*+[^\*]{0,4}$/.test(value) || value === '********';
        };

        const updatePayload: Record<string, string | null> = {
            jellyfinUrl: payload.jellyfinUrl || null,
            jellyseerrUrl: payload.jellyseerrUrl || null,
            geminiModel: payload.geminiModel || 'gemini-2.5-flash-lite',
        };

        if (payload.jellyseerrApiKey && !isMasked(payload.jellyseerrApiKey)) {
            updatePayload.jellyseerrApiKey = payload.jellyseerrApiKey;
        } else if (currentConfig.jellyseerrApiKey) {
            updatePayload.jellyseerrApiKey = currentConfig.jellyseerrApiKey;
        }

        if (payload.geminiApiKey && !isMasked(payload.geminiApiKey)) {
            updatePayload.geminiApiKey = payload.geminiApiKey;
        } else if (currentConfig.geminiApiKey) {
            updatePayload.geminiApiKey = currentConfig.geminiApiKey;
        }

        const jellyseerrUrlChanged = updatePayload.jellyseerrUrl && 
            updatePayload.jellyseerrUrl !== currentConfig.jellyseerrUrl;

        await ConfigService.saveConfig(updatePayload);
        
        if (jellyseerrUrlChanged) {
            console.log('[ConfigEditor] Jellyseerr URL changed. Run `npm run db:migrate-images` to re-download images.');
            res.json({ 
                ok: true, 
                message: 'Configuration updated. To re-download images, run: npm run db:migrate-images',
                jellyseerrUrlChanged: true
            });
        } else {
            res.json({ ok: true, message: 'Configuration updated successfully' });
        }
    } catch (e) {
        console.error('Failed to update config', e);
        res.status(500).json({ error: 'Failed to update configuration' });
    }
});

export default router;
