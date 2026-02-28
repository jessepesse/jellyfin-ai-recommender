# Code Audit: Jellyfin AI Recommender

_Generated: 2026-02-28_

---

## CRITICAL (P0) — Immediate Exploitable Vulnerabilities

---

### 1. SSRF: `BLOCKED_HOSTS` array is dead code — metadata endpoints are fully accessible

`backend/src/utils/ssrf-protection.ts:14-20` defines the blocklist, but every exported function (`sanitizeUrl`, `validateRequestUrl`, `validateSafeUrl`, `validateBaseUrl`, `requireSafeUrl`) performs **protocol-only validation** and never references `BLOCKED_HOSTS`. The entire "PERMISSIVE MODE" designation is accurate but undersells the risk: a request to `http://169.254.169.254/latest/meta-data/` passes all four validation layers.

Compounded by the image proxy at `backend/src/routes/system.ts:39-42`:
```ts
if (path.startsWith('http://') || path.startsWith('https://')) {
    imageUrl = path; // raw, user-supplied absolute URL
}
const validatedUrl = validateRequestUrl(imageUrl); // only checks protocol
```
The `/api/proxy/image?path=http://169.254.169.254/latest/meta-data/iam/security-credentials/` request flows directly to an `axios.get()` call. The endpoint has no authentication requirement.

**Fix:** Remove the `BLOCKED_HOSTS` array's dead-letter status and enforce it in `sanitizeUrl`. Add private IP range blocking (RFC 1918 + link-local) with Node.js `dns.lookup` async resolution after parse, since `new URL()` does not resolve hostnames.

---

### 2. Unauthenticated system configuration mutations

`backend/src/routes/system.ts:262` (`POST /system/setup`) and `:319` (`PUT /system/config-editor`) apply zero auth middleware. Any client can overwrite Jellyfin URL, Jellyseerr URL, and all API keys.

`backend/src/index.ts` never applies `authMiddleware` or `requireAdmin` to the `/api/system` mount. The `setupLimiter` (20 req/5min per IP) is the only protection.

```ts
// routes/system.ts:319 — no authMiddleware, no requireAdmin
router.put('/config-editor', validateConfigUpdate, async (req: Request, res: Response) => {
```

**Fix:** Apply `authMiddleware` then `requireAdmin` to both `POST /setup` and `PUT /config-editor`. Post-initial-setup, `POST /setup` should also require admin.

---

### 3. Plaintext API key exfiltration via unauthenticated `GET /system/setup-defaults`

`backend/src/routes/system.ts:96-113` returns all API keys (Jellyseerr, TMDB, Gemini, OpenRouter) in plaintext with no authentication:

```ts
router.get('/setup-defaults', async (req, res) => {
    const defaults = {
        jellyseerrApiKey: process.env.JELLYSEERR_API_KEY || dbCfg?.jellyseerrApiKey || null,
        geminiApiKey: process.env.GEMINI_API_KEY || dbCfg?.geminiApiKey || null,
        // ...
    };
    res.json(defaults); // zero auth check
});
```

The general rate limiter allows 2000 requests/15min. This endpoint is explicitly listed in the rate-limiter skip list for GET requests:
```ts
const readOnlyPaths = ['/system/setup-defaults', ...];
return readOnlyPaths.some(path => req.path.includes(path)) && req.method === 'GET';
```
It's **rate-limit exempt AND unauthenticated**. Any network-adjacent party extracts all secrets with one curl.

**Fix:** Remove from the rate-limiter skip list. Apply `authMiddleware` + `requireAdmin`. Mask keys identically to how `GET /config-editor` does it (last 4 chars visible).

---

### 4. User identity spoofing via client-controlled request headers

The frontend sets `x-user-name` and `x-user-id` from `localStorage` on every API call (`frontend/src/services/api.ts:112-130`). The backend trusts these directly:

```ts
// routes/recommendations.ts:61-62
const userId = req.headers['x-user-id'] as string;
const userName = req.headers['x-user-name'] as string;

// routes/settings.ts:57-58
const userId = req.headers['x-user-id'] as string;
const userName = req.headers['x-user-name'] as string;
```

No route validates these match the bearer token identity. An authenticated user (any Jellyfin user) can set `x-user-name: admin` to import/export/modify data for any other user.

**Fix:** The `authMiddleware` already populates `req.user`. Remove `x-user-name`/`x-user-id` header consumption throughout all routes; source the identity exclusively from `req.user` which is set only after token verification.

---

## HIGH (P1) — Serious Defects Requiring Near-Term Fix

---

### 5. Local token signature verification is permanently broken — offline auth fails silently

Token generation in `backend/src/routes/auth.ts:41-44` encodes `"userId:timestamp:hmac"`:
```ts
const payload = `${localUser.id}:${timestamp}`;
const signature = crypto.createHmac('sha256', localUser.passwordHash).update(payload).digest('hex');
const tokenPayload = Buffer.from(`${payload}:${signature}`).toString('base64');
// base64 of: "42:1706345678:abc123def..."
```

Verification in `backend/src/middleware/auth.ts:70-92` destructures with a naive split:
```ts
const [payload, signature] = decoded.split(':');
// decoded = "42:1706345678:abc123def..."
// payload  = "42"          ← just userId, NOT "userId:timestamp"
// signature = "1706345678" ← the timestamp, NOT the HMAC
const expectedSignature = crypto.createHmac('sha256', user.passwordHash).update(payload).digest('hex');
// HMAC of "42" vs timestamp string — NEVER matches
```

Local-only authentication **always returns 401**. This is masked in practice because hybrid mode (Jellyfin reachable) replaces the local token with a real Jellyfin token before returning to the client. Offline-mode users (Jellyfin unreachable) can never authenticate despite the "offline mode" being a documented feature.

**Fix:**
```ts
const parts = decoded.split(':');
const signature = parts.pop()!;      // last segment = HMAC hex
const payload = parts.join(':');     // everything before = "userId:timestamp"
const [userIdStr, timestampStr] = parts;
```

---

### 6. Ghost-session bypass: auth middleware calls `next()` without `req.user` on deleted cached users

`backend/src/middleware/auth.ts:124-138`:
```ts
if (cached) {
    const user = await prisma.user.findUnique({ where: { id: cached.userId } });
    if (user) {
        req.user = { ... };
    }
    return next(); // ← called regardless of whether user was found
}
```

If a user is deleted from the DB while their token is cached (5-minute TTL), every cached request proceeds as an unauthenticated request (`req.user = undefined`) for up to 5 minutes. Routes that use `req.user?.isSystemAdmin` without a prior `requireAdmin` guard silently treat the request as a non-admin guest.

**Fix:** Add `return res.status(401).json(...)` when `!user` inside the cache-hit branch.

---

### 7. Background enrichment stampede during bulk import — Jellyseerr DoS

`backend/src/services/data.ts:183-185`:
```ts
enrichMedia(media.id).catch(...); // fire-and-forget per item
```

This fires for every `updateMediaStatus` call. A 1000-item import triggers 1000 concurrent unawaited `enrichMedia()` calls, each making multiple HTTP requests to Jellyseerr (keywords, credits, similar, recommendations). Jellyseerr has no built-in rate-limit for localhost clients. This can:
- Crash Jellyseerr under OOM pressure
- Exhaust the Node.js event loop with 4000+ pending I/O operations
- Lock SQLite write access as all enrichment jobs race to `prisma.media.update`

**Fix:** Replace fire-and-forget with a bounded queue (e.g., p-queue with concurrency 2-3). During bulk import, defer enrichment entirely until post-import completion via a single batch pass.

---

### 8. Admin enforcement is client-side only

`frontend/src/components/Dashboard.tsx:172`:
```tsx
localStorage.getItem('jellyfin_isAdmin') === 'true' ? <SettingsView /> : <AccessDenied />
```

Any user who runs `localStorage.setItem('jellyfin_isAdmin', 'true')` in browser DevTools bypasses the UI gate and reaches `PUT /api/system/config-editor` — which has no server-side admin check (see finding #2).

The `isAdmin` flag is also sent as `x-is-admin: true` header from `frontend/src/services/api.ts:115-116`, trusted server-side in `settings.ts:125` for the all-users export decision — client-controlled privilege escalation.

---

## MEDIUM (P2) — Architectural Defects

---

### 9. Cache stampede in `CacheService.getOrSet`

`backend/src/services/cache.ts:134-148` has no mutex. Under concurrent requests, if 20 recommendation requests arrive simultaneously with a cold cache, all 20 call `fetcher()` — triggering 20 Gemini API calls and 20 × 80 Jellyseerr calls simultaneously. This is the most likely cause of API quota exhaustion in multi-user scenarios.

**Fix:** Use a `Promise` map as a pending-request registry: if a fetch is already in-flight for a key, queue subsequent callers on the same promise rather than starting new ones.

---

### 10. Import service: no per-user lock, concurrent imports corrupt state

`backend/src/services/import.ts:61` exposes a module-level singleton. Two concurrent POST requests for the same user:
1. Both call `initProgress(username)` — second silently overwrites first
2. Both iterate `queue` items in parallel with no transaction wrapping
3. `updateMediaStatus` → `prisma.userMedia.upsert` races without isolation

SQLite's serialized WAL mode prevents data corruption but silent overwrites of `progressMap` result in incorrect progress reporting and potential double-imports.

**Fix:** Add a `Set<string>` of active usernames. Reject concurrent imports with 409 Conflict.

---

### 11. `recommendations.ts` calls Jellyseerr twice per anchor candidate

`backend/src/routes/recommendations.ts:290` calls `getFullDetails(tmdbId)` then `:306` calls `getMediaDetails(tmdbId)` for the same ID in the same loop iteration. Both hit Jellyseerr. `getFullDetails` already contains the poster, overview, and vote average that `getMediaDetails` fetches.

**Fix:** Eliminate the second call; extract needed fields from `fullDetails` directly. This halves Jellyseerr load during anchor candidate resolution.

---

### 12. `syncMediaItem` N+1 write pattern — up to 3 DB writes + 2 external calls per item

`backend/src/services/data.ts:68-149`:
1. `prisma.media.upsert` (write 1)
2. `ImageService.downloadMediaImages` → external HTTP
3. `prisma.media.update` if images downloaded (write 2)
4. `jellySearch` → Jellyseerr if poster missing (external HTTP)
5. `prisma.media.update` × 2 if poster/metadata backfilled (writes 3-4)

During a 1000-item sync, this can execute 4000 DB writes and 2000 external API calls sequentially. Combine this with finding #7 (concurrent enrichments) and the system becomes unusable.

**Fix:** Batch the image downloads and backfill into a post-sync pass. Collect all `imageUpdate` and `posterUpdate` payloads in memory, then issue a single `updateMany` or chunked `$transaction` at the end.

---

### 13. Dynamic `import()` inside request hot-paths

`backend/src/routes/recommendations.ts:118,167,269`:
```ts
const { extractTmdbIds } = await import('../services/jellyfin-normalizer');
const { searchAndEnrich } = await (async () => await import('../services/jellyseerr'))();
const { getFullDetails } = await import('../services/jellyseerr');
```

Node.js module cache means these are effectively no-ops after first load, but the async overhead of checking the module registry on every request adds unnecessary microtask scheduling. The `(async () => await import(...))()` IIFE pattern is particularly pointless.

**Fix:** Move all imports to the top of the file statically.

---

### 14. Route mounting doubles expose unintended paths

`backend/src/routes/api.ts`:
```ts
router.use('/', systemRoutes);
router.use('/system', systemRoutes); // systemRoutes mounted TWICE
router.use('/', mediaRoutes);
router.use('/debug', mediaRoutes);  // mediaRoutes mounted TWICE
```

`/api/proxy/image` is reachable as both `/api/proxy/image` (via `/`) and potentially `/api/system/proxy/image` (via `/system`). This creates undocumented route aliases that rate limiters and path-based skip rules may not cover correctly.

---

## LOW (P3) — Code Quality Issues

---

### 15. Hardcoded `Europe/Helsinki` timezone in scheduler

`backend/src/services/scheduler.ts:33`: `{ timezone: 'Europe/Helsinki' }`. This is not configurable. All deployments run weekly watchlist generation at 3am Helsinki time regardless of server location.

---

### 16. `configCache` is a module-level variable with no process-boundary awareness

`backend/src/services/config.ts:21-23`: If the process ever ran in a cluster mode or with worker threads, the in-memory cache would be stale per-process. Additionally, after `saveConfig()` clears the cache, the 30-second TTL window on other in-flight requests means stale config is served for up to 30 seconds.

---

### 17. 100ms sleep per item in `syncHistory` makes large syncs unusably slow

`backend/src/services/sync.ts:134`:
```ts
await new Promise(resolve => setTimeout(resolve, 100));
```
1000 watched items = 100 seconds of artificial delay, on top of Jellyseerr RTT. This blocks the event loop's I/O pipeline for the entire sync duration. Replace with a proper rate-limiter (e.g., `bottleneck` or `p-throttle`) that gates concurrency without `await sleep`.

---

### 18. `req.user` extended type has unconstrained index signature

`backend/src/middleware/auth.ts:42`: `[key: string]: any` on `req.user`. This defeats TypeScript's type safety across the entire authentication chain — any misspelled property access (e.g., `req.user.isAdmin` instead of `req.user.isSystemAdmin`) silently returns `undefined` rather than a compile error.
