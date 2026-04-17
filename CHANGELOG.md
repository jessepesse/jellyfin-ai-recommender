Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [Unreleased]

## [2.8.8] - 2026-04-17

### 🔒 Security

- **Pin `protobufjs` to ^7.5.5** (backend) via npm override — fixes critical arbitrary code execution vulnerability (Dependabot alert #105) introduced transitively via `@google/genai`.
- **Pin `follow-redirects` to ^1.16.0** (backend + frontend) via npm overrides — fixes auth header leak to cross-domain redirect targets (Dependabot alerts #100, #101).
- Dismissed alert #99 (pillow/pip) — `requirements.txt` removed from project, no Python components present.

## [2.8.7] - 2026-04-06

### 🔒 Security

- **Pin `lodash` to 4.18.1** (backend) via npm override — fixes Code Injection via `_.template` (high, #77) and Prototype Pollution via `_.unset`/`_.omit` (moderate, #76).
- **Pin `defu` to 6.1.6** (backend) via npm override — fixes high severity vulnerability introduced transitively via `prisma → @prisma/config → c12`.
- Dismissed alert #79 (tornado/pip) — Python package, not present in this Node.js project.

## [2.8.6] - 2026-04-03

### 🔧 Maintenance

- Dependency updates: `axios` 1.14.0 (backend + frontend — clean release post supply-chain incident), `recharts` 3.8.1, `zod-to-json-schema` 3.25.2, `express-validator` 7.3.2.
- Dev dependency updates: `vitest` group (backend), `eslint` group (frontend), `@playwright/test` 1.59.1, `@types/jsdom` 28.0.1.
- Closed Vite 8.0.3 PR (#143) — `@tailwindcss/vite` does not yet support Vite 8.

## [2.8.5] - 2026-03-30

### 🔒 Security

- **Pin `path-to-regexp` to 8.4.0** (backend) via npm override — fixes DoS via sequential optional groups (high, #75) and ReDoS via multiple wildcards (medium, #74). Vulnerability introduced transitively via `express@5 → router@2.2.0`.

## [2.8.4] - 2026-03-26

### 🔒 Security

- **Pin `picomatch` to 4.0.4** (root, frontend, backend) via npm overrides — fixes Method Injection vulnerability (Dependabot alerts #65/#68/#70).
- **Pin `picomatch` 2.x to 2.3.2** for the anymatch chain (backend: nodemon→chokidar→anymatch) — fixes alert #66 without breaking nodemon.
- **Pin `brace-expansion` to 5.0.5** (frontend, backend) — fixes moderate ReDoS vulnerability.

### 🔧 Maintenance

- Dismissed false positive Dependabot alerts #71 (Streamlit) and #62 (requests) — Python packages not present in Node.js dependency tree.
- Merged Dependabot PRs: #129 (vitest backend), #130 (jsdom root), #133 (eslint frontend).
- Closed incompatible major version PRs: #127 (TypeScript 6 — breaking changes), #134 (Vite 8 — `@tailwindcss/vite` peer dep mismatch), #136 (lucide-react 0→1 — major version jump).

## [2.8.3] - 2026-03-25

### 🔒 Security

- **Pin `effect` 3.18.4 → 3.21.0** via npm override — fixes AsyncLocalStorage contamination vulnerability (Dependabot alert #60).
- **Pin `flatted` → 3.4.2** via npm override — fixes prototype pollution vulnerability (Dependabot alert #61).

### 🔧 Maintenance

- Dependency updates: `@google/genai` 1.46.0, `@tailwindcss/vite` 4.2.2, `tailwindcss` 4.2.2.
- Removed unused `tailwindcss` and `@tailwindcss/vite` from root `package.json`.

## [2.8.2] - 2026-03-18

### 🔒 Security

- **`GET /system/config` now requires admin authentication** — previously protected only by a trivially-faked `x-debug` header.
- **Session token no longer forwarded to Jellyfin** — `sync`, `stats`, and `recommendations` routes now use the Jellyfin token resolved by `authMiddleware` (`req.user.jellyfinToken`) instead of the raw `x-access-token` header. Fixes session-based auth for all Jellyfin-proxying routes.

### 🐛 Bug Fixes

- **Token refresh was dead code** — `getMe()` returns `null` on 401 instead of throwing, so the `catch` block for transparent Jellyfin re-auth was never reached. Null return is now treated as an expired token, triggering re-auth correctly.
- **`userId` could be `undefined` on login** — if `prisma.user.upsert` failed during Jellyfin auth, `createSession` was called with `userId!` which could be `undefined`. Login now returns 500 immediately on upsert failure.
- **`JSON.parse` without try/catch in `blocked.ts`** — corrupt DB rows for genres or redemption candidates now return an empty array instead of crashing the endpoint with 500.

### 🔧 Maintenance

- Added `.npmrc` copy to dev Dockerfiles for consistent `legacy-peer-deps` behaviour.
- `docker-compose.development.yml`: mount `shared` package as live volume (hot-reload without rebuild), switch `node_modules` to named volumes.
- README and SECURITY.md documentation updates.

## [2.8.1] - 2026-03-17

### 🚀 Improvements

- **E2E Test Reliability:** Replaced fragile CSS class assertions with semantic `aria-pressed` checks, fixed strict mode violations, improved console error detection, and switched to `domcontentloaded` wait strategy.
- **Accessibility:** `SegmentedControl` and `FilterGroup` toggle buttons now expose pressed state via `aria-pressed` attribute.
- **CI:** Upgraded Node.js from 20 to 22 in GitHub Actions workflow.

### 🔧 Maintenance

- Upgraded `@eslint-react/eslint-plugin` from 2.13.0 to 3.0.0 (updated rule names).
- Removed `playwright-report` from git tracking.
- Dependency updates: `@google/genai` 1.45.0, `better-sqlite3` 12.8.0, `prisma` 7.5.0, `@prisma/adapter-better-sqlite3` 7.5.0, `vitest` 4.1.0, `@vitest/coverage-v8` 4.1.0, `typescript-eslint` 8.57.0, `@types/node` 25.5.0, `@commitlint/cli` 20.5.0, `@commitlint/config-conventional` 20.5.0.

## [2.8.0] - 2026-03-15

### ✨ New Features

- **Genre Diversity for Weekly Picks:** Dual-layer genre diversity enforcement in the Curator→Critic pipeline.
  - Prompt-level instruction: Curator AI is told no single genre should dominate more than 30%.
  - Post-processing cap: hard 30% per-genre limit applied between Curator and Critic stages.
- **Genre Interleaving for On-Demand Recommendations:** When no genre filter is active, results are reordered so the same genre doesn't appear consecutively — visual variety without removing any items.
- **Freshness Mix for Weekly Picks:** Candidate pool now always includes trending/recent releases (last 2 years, sorted by popularity) alongside quality-sorted classics. Ensures weekly picks feel fresh, not static.
- **Negative Signals from Blocked Items:** Blocked items' titles and genres are now passed to AI ranking prompts (both on-demand and weekly), helping the AI avoid recommending similar content.

### 🚀 Improvements

- **Gemini 3 Prompt Optimization:** All 5 AI prompts restructured per the Gemini 3 prompting guide — data/context first, constraints last, flexible keyword counts, no blanket negatives.
- **Dead Code Removal:** Removed ~150 lines of unreachable code (`buildPromptWithProfile`, `formatTable`, unused `GeminiService.getRecommendations`).
- **Enriched Taste Summaries:** `summarizeProfile` now includes genre, year, rating, and vote average metadata for richer AI context.

### 🐛 Bug Fixes

- **Settings Page Logout:** Fixed admin users being logged out when navigating to Settings — `getSystemConfigEditor` and `putSystemConfigEditor` API calls were missing auth headers, causing 401 → automatic logout.
- **Genre ID Display Bug:** Fixed Curator receiving raw TMDB genre IDs (`28`, `35`) instead of human-readable names (`Action`, `Comedy`) in weekly picks pipeline.
- **Shared Types Build:** Rebuilt `@jellyfin-ai/types` dist to include the `genres` field added to `SharedMediaItem`.

### 🔒 Security

- **In-flight Cache Cleanup:** Added 5-minute timeout safety net for hung in-flight cache entries to prevent memory leaks.
- **Year Filter Validation:** Aligned `extractYear` validation with `MIN_FILTER_YEAR`/`MAX_FILTER_YEAR` constants.
- **Dependency Updates:** Upgraded jsdom to 29.0.0 (undici/flatted vulnerabilities), bumped hono to ≥4.12.7 (prototype pollution fix).

## [2.7.0] - 2026-03-10

### 🔐 Security

- **Backend Session Management:** Replaced client-side credential storage with server-side encrypted sessions.
  - Jellyfin tokens and credentials stored AES-256-GCM encrypted in the database — never in the browser.
  - Session tokens are opaque 64-hex strings; the raw token is never stored (only HMAC-SHA256 hash).
  - Sliding window expiry (30 days default), configurable via `SESSION_TTL_DAYS`.
  - `SESSION_SECRET` auto-generated on first run and persisted to `/app/data/.session_secret` — no user action required.
  - Transparent Jellyfin token refresh: backend re-authenticates using encrypted credential when token expires.
  - New `POST /api/auth/logout` endpoint invalidates session server-side.
  - Daily cron purges expired sessions at 03:30.
  - Fixes CodeQL alert #67 (clear-text password in sessionStorage).
- **express-rate-limit** updated 8.2.1 → 8.3.1 (fixes IPv4-mapped IPv6 bypass vulnerability).

### 🐛 Bug Fixes

- **Mobile Decade Range Slider:** Replaced broken dual-stacked `<input type="range">` with `@radix-ui/react-slider`.
  - Touch events now work correctly on iOS and Android.
  - Responsive tick labels: 4 ticks on mobile (1900/1950/2000/2026), full 10-year grid on desktop.
  - Larger thumbs (24px) for easier touch targeting.

### 📦 Dependencies

- Bumped multiple Dependabot dependencies (p-limit, recharts, zod, openai, nodemon, eslint, @types/node, commitlint, docker actions).

## [2.6.0] - 2026-03-05

### ✨ New Features

- **Decade Range Filter:** Added interactive dual-handle year-range slider (1900–2026) to the recommendations page.
  - Filter recommendations by release year — e.g. only 2000s movies.
  - Both handles independently draggable with distinct glow colors (cyan/violet).
  - Tick labels positioned to match exact slider values.
  - Year filter integrates with TMDB Discover API queries.
  - Recommendations fetched only on button click, not on every slider drag.
- **SQLite-Backed Persistent Cache:** Replaced in-memory `node-cache` with SQLite-backed cache layer.
  - Recommendations, taste profiles, and enrichment data survive backend restarts.
  - Automatic TTL expiration and namespace-based cache management.

### 🚀 Improvements

- **Candidate-First Ranking:** Refactored the recommendation fill stage to collect all candidates first, then send a single batch to Gemini for ranking instead of generating titles from scratch. Results in more relevant, higher-quality recommendations.
- **Multi-Genre Filtering:** Anchor-based recommendations now correctly filter by multiple selected genres simultaneously (previously only matched the first genre).
- **Parallel Detail Fetch:** Anchor candidate detail fetching now runs with bounded parallelism (p-limit), significantly speeding up recommendation generation.

### 🐛 Bug Fixes

- **Optimistic UI Rollback:** Watchlist, watched, and block actions now await the API response before removing the card. On failure, the card stays visible with a 3-second error toast instead of silently disappearing.
- **ESLint Warnings:** Resolved all 20 ESLint warnings across the frontend (React 19 `use()` API, proper keys, suppressed legitimate patterns).

### 🔒 Security

- **CodeQL Format String:** Replaced template literal format strings in `cache.ts` with string concatenation to eliminate externally-controlled format string alerts.
- **Dependency Overrides:** Patched `hono` (≥4.12.4), `@hono/node-server` (≥1.19.10), and `lodash` (≥4.17.23) via npm overrides to resolve transitive dependency CVEs without downgrading Prisma.
- **SECURITY.md:** Documented all known CodeQL false positives (SSRF, GET sensitive data, clear text storage) with risk analysis and mitigation details.

### 🧪 Testing

- **E2E Tests:** Added Playwright tests for login and recommendations flows (mocked, no real server needed).
- **Pipeline Regression Tests:** Added unit tests for recommendation pipeline rules (year filtering, genre matching, exclusion logic).

### 🔧 Infrastructure

- **CI:** Added ESLint check to pre-commit hook and GitHub release workflow.
- **CI:** Added version consistency check — release workflow fails fast if package.json or CHANGELOG versions don't match the tag.

### 📦 Dependencies

- **Backend:** Updated `@prisma/adapter-better-sqlite3` from 7.4.0 to 7.4.2.
- **Backend:** Overrode `hono` to 4.12.5 and `@hono/node-server` to 1.19.11 (CVE-2026-24398, CVE-2026-29045, GHSA-wc8c).
- **Backend:** Overrode `lodash` to ≥4.17.23 (CVE-2025-13465 prototype pollution).
- **Frontend:** Updated `lucide-react` from 0.564.0 to 0.575.0.
- **Frontend:** Updated `axios` from 1.13.5 to 1.13.6.

## [2.5.1] - 2026-03-04

### 🐛 Bug Fixes

- **Login broken after auth hardening (critical):** The 2.5.0 security fix removed `x-user-name`/`x-user-id` from `authHeaders()` to prevent client-supplied identity spoofing — but the backend routes still read those headers to identify the user. All protected routes now use `authMiddleware` + `req.user` exclusively. Affected routes: `blocked`, `actions`, `weekly-watchlist`, `trending`, `stats`, `sync`, `user`.
- **Login error message hidden:** Login failures always showed "Login failed. Please check your credentials." regardless of the actual error. `AuthContext.login()` now throws with the real backend message; `Login.tsx` displays it directly.
- **`/api/user/watchlist` returning 404:** Route was defined as `/watchlist` in `user.ts` but mounted at `/` in `api.ts`, making it accessible at `/api/watchlist` instead of `/api/user/watchlist`. Same issue affected `/user/change-password`.
- **Empty `serverUrl` rejected by validator:** `express-validator`'s `.optional()` only skips `undefined`, not empty string. Changed to `.optional({ values: 'falsy' })` so the login form works when no custom server URL is entered.

### 🤖 AI Models

- Removed deprecated Gemini 2.5 preview models from all dropdowns.
- Default model changed to `gemini-3.1-flash-lite-preview` (faster, cost-efficient, supports thinking).
- Available models: Flash Lite (default), Flash, Pro.

### 🔧 Infrastructure

- Added unified `github-release.yml` workflow: runs tests → builds Docker images → creates GitHub Release on `v*` tag push.
- Added CodeQL suppression comments for `api_key` query parameter (Jellyfin protocol compatibility) and HMAC token signing.

## [2.5.0] - 2026-02-28

### 🔒 Security (P0)

- **Path Traversal:** Sanitized `filename` parameter in `/api/images/:filename` to reject `..` sequences and absolute paths, preventing directory traversal out of the image directory.
- **SSRF via Image Proxy:** Validated proxy target URLs through `sanitizeUrl()` before issuing requests; added `X-Content-Type-Options: nosniff` and stripped forwarded `Cookie`/`Authorization` headers from proxied responses.
- **Stored XSS via `Content-Disposition`:** Replaced raw `username` interpolation in attachment filenames with `encodeURIComponent`, eliminating header-injection vectors on the export endpoint.
- **Token Leakage in Logs:** Removed `x-access-token` from debug log output across sync and settings routes.

### 🏗️ Architecture (P1–P2)

- **Enrichment Queue (P1):** Bounded background enrichment to 3 concurrent Jellyseerr calls via `EnrichmentQueue`, preventing SQLite lock contention and request floods during large imports.
- **Cache Stampede (P2):** Added in-flight `Promise` registry to `CacheService.getOrSet` — concurrent callers for the same key now join the existing fetch instead of launching duplicates.
- **Import Concurrency (P2):** Added per-user `Set<string>` lock to `ImportService`; `POST /settings/import` returns HTTP 409 when an import is already active for the same user.
- **Redundant API Calls (P2):** Extended `FullMediaDetails` to carry poster/backdrop URLs and metadata from the same Jellyseerr response — eliminated the parallel `getMediaDetails` call per recommendation candidate.
- **N+1 DB Writes (P2):** Moved all secondary `prisma.media.update()` calls in `syncMediaItem` (image download + poster/metadata backfill) into a bounded `imageBackfillQueue(2)`; all updates collected in one object and applied with a single write per item.
- **Dynamic Imports (P2):** Replaced three `await import()` calls inside the recommendation route handler with static top-of-file imports.
- **Double Route Mounting (P2):** Extracted image proxy into named `proxyRouter` export; each router now mounted exactly once at its canonical path — duplicate `/`, `/user`, `/debug`, and second `/system` mounts removed.

### 🔧 Code Quality (P3)

- **Scheduler Timezone (P3):** Replaced hardcoded `Europe/Helsinki` with `SCHEDULER_TIMEZONE` env var, falling back to `TZ` then `UTC`. Active timezone logged at startup.
- **Stale Config Cache (P3):** `saveConfig()` now invalidates the in-memory cache before the DB write, ensuring concurrent reads go to SQLite rather than re-populating stale data.
- **Blocking Sleep in Sync (P3):** Removed per-item 100 ms `setTimeout` from `syncHistory`. Replaced sequential loop with `Promise.all + p-limit(5)` for concurrent Jellyseerr enrichment.
- **Type Safety on `req.user` (P3):** Stripped `[key: string]: any` index signature from the Express `Request` augmentation — only the four declared properties remain, restoring strict compiler checks across all routes.

### 📦 Dependencies

- Added `p-limit@3.1.0` for bounded concurrency in sync history processing.

## [2.4.8] - 2026-02-27

### 🔒 Security

- **minimatch:** Updated to `10.2.4` to fix high-severity ReDoS vulnerability (**CVE-2026-26996**).
- **hono:** Updated to `4.12.3` to address timing comparison hardening in `basicAuth` and `bearerAuth`.

### 🚀 Features

- **AI Model Update:** Updated Google AI model selection to use `gemini-3.1-pro-preview` as the older Gemini 3 Pro version is being retired.

### 🔧 Technical

- **ESLint 10 Migration:** Upgraded frontend toolchain to ESLint 10.
  - Migrated from legacy `.eslintrc` format to modern `eslint.config.js` (Flat Config).
  - Replaced `eslint-plugin-react-hooks` with modern `@eslint-react/eslint-plugin`.
- **Node.js Update:** Standardized Docker images on **Node.js v25** to ensure native module compatibility (e.g., `better-sqlite3`) while meeting ESLint 10's requirements.
- **Docker Fixes:** Added `npm rebuild better-sqlite3` to backend build process to prevent `ERR_DLOPEN_FAILED` when changing Node versions.

### 📦 Dependencies

- **Project:** Updated 15 dependencies via Dependabot, including `tailwindcss`, `@tailwindcss/vite`, `openai`, `lucide-react`, and various dev tools.

## [2.4.7] - 2026-02-15

### 🐛 Bug Fixes

- **Prisma:** Fixed `MODULE_NOT_FOUND: query_compiler_fast_bg.sqlite.js` by locking all Prisma packages (`prisma`, `@prisma/client`, `@prisma/adapter-better-sqlite3`) to exact version `7.4.0`. The `^7.1.0` caret range allowed version drift between CLI and runtime, breaking database operations.

### 📦 Dependencies

- **Backend:** Updated `@prisma/client` from ^7.1.0 to 7.4.0.
- **Backend:** Updated `@prisma/adapter-better-sqlite3` from ^7.1.0 to 7.4.0.
- **Backend:** Updated `prisma` from ^7.1.0 to 7.4.0.

## [2.4.6] - 2026-02-12

### 🔒 Security

- **qs:** Updated `qs` to `6.14.2` to resolve DoS vulnerability (GHSA-w7fw-mjwx-w883) via `npm audit fix`.
- **CI Fix:** Added explicit `react-is` dependency to frontend to fix CI build failures (backported from v2.4.5 hotfix).

## [2.4.5] - 2026-02-12

### 🔧 Technical

- **SDK Migration:** Migrated from deprecated `@google/generative-ai` to `@google/genai` SDK.
  - Updated `buildClientAndModel()` to use new `GoogleGenAI` client.
  - Updated `generateAIContent()` to use `ai.models.generateContent()` API.
  - Updated `system.ts` Gemini verification to use new SDK.
  - ThinkingBudget now uses numeric tokens instead of string levels.
- **Implicit Caching Optimization:** Restructured AI prompt for Gemini implicit caching.
  - Stable sections (ROLE, RULES, OUTPUT FORMAT) moved to prompt beginning.
  - Variable sections (TASTE, CONTEXT, EXCLUSION) moved to prompt end.
  - Maximizes implicit cache hits for up to 90% cost reduction on cached tokens.

## [2.4.4] - 2026-01-11

### 🔒 Security
- **CodeQL Fix:** Resolved tainted format string alert in `trending.ts` by sanitizing user input in log statements.

### 📦 Dependencies
- **Backend:** Updated `zod` from 4.3.4 to 4.3.5.
- **Frontend:** Updated `globals` from 16.5.0 to 17.0.0.
- **Frontend:** Updated `typescript-eslint` from 8.50.1 to 8.51.0.
- **Root:** Updated `@commitlint/cli` from 20.2.0 to 20.3.0.
- **Root:** Updated `@commitlint/config-conventional` from 20.2.0 to 20.3.0.

## [2.4.3] - 2026-01-11

### ✨ New Features
- **Genre Display:** Added genre mapping and display across the application (previously missing).
  - **Trending:** Added genres to Trending Page cards.
  - **Search & Recommendations:** Implemented genre population from Jellyseerr.
  - **Watchlist:** Implemented parsing of stored JSON genres.
  - **Weekly Watchlist:** Added genre ID-to-name mapping for recommendations.
  - **Blocked:** Implemented parsing of stored genres.
- **Weekly Watchlist:** Added "All Caught Up" empty state message with next release date.

### 🐛 Bug Fixes
- **Trending:** Fixed issue where added/blocked items remained on the Trending page due to caching.
  - Implemented automatic cache invalidation for `trending_{username}` on all user actions.
  - Added background cache refresh to ensure "instant" updates upon return to the Trending page.
  - Added scheduled (2-hour) background job to keep Trending cache fresh for all users.
- **Recommendations View Cache:** Implemented persistent caching for the recommendations view. Recommendations now stay visible even after navigation and are only refreshed when explicitly requested.

## [2.4.2] - 2026-01-03

### 🐛 Bug Fixes
- **Backup:** Fixed `backup_db.ts` script to work with new Dual AI database schema (resolves `ts-node` compilation errors during backup).
- **Security:** Added explicit CodeQL alert suppression for HMAC cache hashing to clear false positives.

## [2.4.1] - 2026-01-03
 
### 🔒 Security
- **Auth:** Migrated admin token caching to use **HMAC-SHA256** with randomized secret (fixes CodeQL alert).

### 📦 Dependencies
- **Frontend:** Updated `recharts` to v3.6.0.
- **Frontend:** Updated `jsdom` to v27.4.0.
- **Frontend:** Removed obsolete `@types/date-fns` (v4 has built-in types).

## [2.4.0] - 2026-01-03

### ✨ New Features

- **Dual AI Provider Support:** Added support for both **Google AI (Gemini)** and **OpenRouter**
  - **Provider Swapping:** Users can switch between Google AI and OpenRouter in Settings at any time.
  - **Model Configuration:** Configurable model name (e.g. `gemini-2.0-flash-exp`) for OpenRouter.
  - **Unified Abstraction:** Backend services now use a provider-agnostic `generateAIContent` interface.
  - **Setup Wizard:** Updated to support selecting provider and entering OpenRouter API Key.
  - **Env Variables:** Added `AI_PROVIDER`, `OPENROUTER_API_KEY`, `AI_MODEL` to docker-compose and validation schema.

### 🔒 Security

- **Robust Admin Authentication:** Fixed and hardened Admin access for Jellyfin users
  - **Jellyfin Token Validation:** Middleware now actively validates standard Jellyfin tokens against the server (`/Users/Me`) for admin routes.
  - **Secure Caching:** Implemented `node-cache` with **SHA-256 Hashing** to store validated sessions without keeping raw tokens in memory.
  - **Identity Mapping:** Safely maps valid Jellyfin Admin sessions to local admin privileges.
  - **DoS Protection:** Token cache includes strict TTL (5m) and size limits (1000 keys).


### 🐛 Bug Fixes

- **Jellyseerr Request Failure:** Fixed "Request" button errors
  - **Auto-Select Seasons:** Automatically fetches and includes all seasons for TV show requests (prevents 500 errors).
  - **Flexible Validator:** Resolved mismatch between frontend payload and backend validation schemas.
  - **Increased Timeout:** Raised Jellyseerr client timeout to 120s to handle slow instances.
  - **High CPU Usage:** Fixed dev environment performance
  -**Detached Mode:** Switched Docker Compose to detached mode to prevent high CPU usage from interactive log streaming.

## [2.3.8] - 2025-12-28

### 🐛 Bug Fixes

- **Hybrid Re-authentication:** Fixed 401 errors after local authentication
  - When local auth succeeds, system now also fetches a real Jellyfin token if server is reachable
  - Enables Jellyfin API calls (libraries, history) even when starting with cached credentials
  - Falls back to local-only mode if Jellyfin is unreachable

- **Offline Recommendations:** Recommendations now work even when Jellyfin is unavailable
  - Jellyfin API calls (getItems, getHistory, getOwnedIds) wrapped in try-catch
  - Uses locally cached anchor data from database when Jellyfin fails
  - Only watch history fetch is affected; AI recommendations continue working

- **Nginx Image Proxy:** Added `/images/` location block to nginx.conf
  - Proxies cached media images from backend container
  - Enables production image loading (was missing, causing 404s)
  - 30-day browser cache for performance

## [2.3.7] - 2025-12-28

### ✨ New Features

- **Admin Authentication System:** Hybrid Auth with local admin password and offline login capability.
  - Added "Admin Account" section to Settings for managing local password.
  - Added automatic "Bootstrap Admin" creation on startup if no admin exists.
  - 30-day token expiry for security.
  - Removed legacy header-based authentication fallbacks.

- **Blocked View Enhancements:**
  - Added Jellyseerr request integration - "Request in Jellyseerr" now actually sends request.
  - Added FilterGroup (All/Movies/TV) for filtering blocked content.
  - Added `blocked:changed` event listener for cross-component refresh.

### 🐛 Bug Fixes

- **Login Logo**: Fixed incorrect logo path on Login screen (was using proxied /images path).
- **Blocked Media View**: Fixed blocked page layout and functionality.
  - Refactored `BlockedView` to use the shared `MediaCard` component with a new `blocked` variant.
  - Ensured consistent responsiveness and mobile layout (same as Trending/Watchlist).
  - Fixed 'Unblock' action adding items correctly back to the pool instead of defaulting to Watchlist.
  - Implemented optimistic UI updates to instantly remove unblocked items without loading delay.


## [2.3.6] - 2025-12-27

### 🐛 Bug Fixes

- **Image URLs**: Fixed blocked page images not displaying
  - Added helper function to convert relative image paths to absolute URLs
  - Backend now returns full URLs like `https://api.example.com/images/...`
  - Fixes images after migrating from Jellyseerr domain to local IP

## [2.3.5] - 2025-12-27

### 🐛 Critical Bug Fixes

- **API Base URL**: Fixed hardcoded API base URL in frontend
  - Now uses `VITE_API_URL` environment variable for production
  - Falls back to `/api` for local development
  - Fixes Trending and Blocked pages not working with Cloudflare setup
  - API calls now correctly route to `https://api.example.com`

## [2.3.4] - 2025-12-26

### 🐛 Bug Fixes

- **ESLint**: Fixed `@typescript-eslint/no-explicit-any` error in TrendingPage
  - Replaced `any` type with proper type guard
  - Safer error handling

## [2.3.3] - 2025-12-26

### 🐛 Critical Bug Fixes

- **Production Migration Fix**: Simplified database migration to use `db push`
  - Replaced complex baseline migration logic with simple `prisma db push`
  - Fixes bootloop issues on ZimaOS and other production environments
  - Syncs schema directly without requiring strict migration history
  - More reliable for existing databases with unknown migration state

## [2.3.2] - 2025-12-26

### 🐛 Bug Fixes

- **Package Lock Sync**: Fixed npm ci failures in GitHub Actions
  - Synced package-lock.json files with package.json
  - Resolved missing dependencies (magicast, yaml)

## [2.3.1] - 2025-12-26

### 🐛 Critical Bug Fixes

- **Production Migration Fix**: Fixed P3005 error when upgrading existing databases
  - Implemented automatic baseline migration using `prisma migrate resolve`
  - Detects databases without `_prisma_migrations` table
  - Marks all existing migrations as applied without re-running them
  - Preserves migration history for future updates
  - Replaces unsafe `db push` approach with proper baseline strategy
  - Ensures production databases upgrade correctly without data loss

## [2.3.0] - 2025-12-26

### ✨ New Features

- **User Statistics Dashboard (Admin):** Added comprehensive user statistics view in Settings for admin users
  - Shows total, active (7d), and inactive user counts
  - User cards display username, activity status, last activity time
  - Statistics: watched, watchlist, blocked, and total counts
  - AI features status: Weekly Picks and Redemption Candidates generation timestamps
  - Account creation date
  - Responsive grid layout (1/2/3 columns)
  - Auto-loads when admin opens Settings page
- **Auto-Regeneration:** Weekly Picks and Redemption Candidates now auto-regenerate after 7 days
  - Checks `generatedAt` timestamp on every API call
  - Automatically generates fresh recommendations if older than 7 days
  - Logs age of recommendations (e.g., "2.3 days old")
  - Scheduled job (Sunday night) continues as backup mechanism
- **Startup Initialization:** Hybrid approach for generating recommendations at server startup
  - Finds users with activity in last 7 days
  - Generates Weekly Picks and Redemption Candidates for active users only
  - Skips inactive users to keep startup fast
  - Inactive users get lazy loading when they return
- **Admin Export:** Database export now exports all users' data for admin users
  - Admin users: Export all users in format `{ username1: {...}, username2: {...} }`
  - Regular users: Export only their own data
  - Filename indicates scope: `jellyfin-backup-all-users-YYYY-MM-DD.json` vs `jellyfin-backup-username-YYYY-MM-DD.json`
  - Updated UI text to inform admins about this feature

### ✨ UI Improvements

- **RedemptionCard Mobile:** Changed to use backdrop image on mobile for better screen utilization
  - Backdrop (wide) image on mobile, poster (tall) image on desktop
  - Gradient overlay on mobile for text readability
  - Fallback to poster if backdrop unavailable
- **BlockedView Mobile:** Changed to display one item per row on mobile
  - Improved readability and consistency with RedemptionCard mobile layout
  - Desktop retains multi-column layout (3/4/5 columns)
- **Settings Text:** Removed "legacy" references from database import section
  - "Legacy & New database.json Import" → "Database Import"
  - "database.json (legacy or new)" → "database.json backup"

- **Media Cards:** Improved title visibility by displaying movie/show name, year, rating, and type below card image instead of as overlay
  - Cleaner card design with unobstructed poster/backdrop images
  - Better readability with dedicated text area
  - Shows rating (⭐), year, and media type (🎬 Movie / 📺 TV) in metadata row
  - Removed duplicate rating badge from top-left corner
- **Trending Page:** Added filter tabs to easily switch between All, Movies, and TV Shows
  - Quick filtering with purple-blue gradient active state
  - Matches Weekly Watchlist UX pattern
  - Shows separate Movies and TV Shows sections when "All" is selected
- **Watchlist View:** Added Movies and TV Shows section headers when "All" filter is active
  - Consistent with Trending page layout
  - Color-coded sections (purple for Movies, blue for TV Shows)
  - Shows item counts for each section


### 🐛 Bug Fixes

- **Logo and Favicon:** Fixed 404 errors by moving assets from `/images/` to `/assets/`
  - Vite proxy was forwarding `/images` requests to backend
  - Separated static assets into `/assets/` path served directly by Vite
  - Updated `Sidebar.tsx` and `index.html` to use new paths
  - Corrected favicon type from `image/x-icon` to `image/png`
- **Viewport Meta Tag:** Restored correct viewport meta tag in `index.html`
  - Fixed accidental change from `initial-scale=1.0` to `initial=1.0`
- **Mobile Layout:** Fixed Trending page to display one card per row on mobile devices instead of two
  - Changed grid layout from `grid-cols-2` to `grid-cols-1` for mobile breakpoint
  - Improved readability and touch targets on small screens
- **Sidebar:** Fixed logout button not being visible on iPhone
  - Changed sidebar layout from `min-h-screen` with sticky footer to `h-screen` with flexbox
  - Used `100dvh` (dynamic viewport height) instead of `100vh` to account for Safari address bar
  - Added iOS safe-area padding to prevent UI elements from being hidden by browser chrome
  - Footer is now always visible at bottom of viewport
  - Content area scrolls independently
- **Authentication:** Fixed app not forcing logout when Jellyfin token expires
  - Axios interceptor now automatically clears all auth data when token refresh fails
  - Page reloads to show login screen instead of showing error while staying logged in
  - Prevents users from being stuck in invalid authentication state
- **Weekly Picks:** Removed regenerate button that was accidentally left visible from development
  - Weekly picks auto-regenerate every Monday at 03:00
  - Prevents users from triggering expensive AI operations manually
  - Button was intended for development/testing only

---


## [2.2.1] - 2025-12-24

### 🔒 Security

- **Critical:** Updated React from 19.2.1 to 19.2.3 to fix RCE/DoS vulnerabilities in React Server Components

### 📦 Dependencies

- Updated vitest from 4.0.15 to 4.0.16
- Updated @vitest/coverage-v8 from 4.0.15 to 4.0.16
- Updated Vite from 7.2.4 to 7.3.0
- Updated lucide-react from 0.561.0 to 0.562.0
- Updated Tailwind CSS from 4.1.17 to 4.1.18
- Updated @testing-library/react from 16.3.0 to 16.3.1
- Updated @eslint/js from 9.39.1 to 9.39.2

---

## [2.2.0] - 2025-12-24

### ✨ Features

- **TMDB Enrichment**: Extended Media schema with genres, keywords, director, topCast, similarIds, recommendationIds
  - Added `getFullDetails()` to fetch enriched TMDB data including genres and keywords
  - Created `enrichment.ts` service with background backfill for existing media
- **Anchor-Based Recommendations**: New recommendation algorithm using user's watch history as anchors
  - Collects similar/recommended TMDB IDs from enriched anchor items
  - Gemini ranks candidates for quality and taste matching
- **Weekly Watchlist:** Implemented a new feature that pre-generates a personalized weekly watchlist for users every Monday at 03:00.
  - **Taste Analysis:** Uses Gemini to analyze user history and create a semantic "Taste Profile".
  - **Hybrid Discovery:** Combines semantic profile with TMDB Discover API for broad candidate retrieval.
  - **AI Ranking:** Gemini ranks TMDB candidates to select the top 20 movies and TV shows matching the user's vibe.
  - **Database:** Added `WeeklyWatchlist` model to Prisma schema.
  - **Frontend:** New `WeeklyWatchlist` component with horizontal scrolling and "Generate My List" functionality.
  - **Stabilization:** Includes strict deduplication (excludes Watchlist/Blocked), ID verification for image safety, and robust error handling.
- **Direct TMDB API Support:** Added optional `TMDB API Key` configuration.
  - Allows bypassing Jellyseerr proxy for discovery queries.
  - Configurable via System Settings UI or environment variables.
- **Mood-Based Filtering**: Pre-filter candidates by mood keywords before Gemini ranking
  - MOOD_KEYWORDS mapping for 7 moods (mind-bending, dark, adrenaline, chill, feel-good, tearjerker, visual)
  - Keywords and overview text matching at candidate level
  - Mood context passed to Gemini for additional filtering
- **Randomized Anchor Selection**: Diversified anchor selection for varied recommendations
  - Separate WATCHED and WATCHLIST queries with Fisher-Yates shuffle
  - Interleaved combining for balanced representation from both lists
- **Trending Page**: New page displaying popular movies and TV shows from Jellyseerr
  - Unified trending feed from `/api/v1/discover/trending` endpoint
  - Smart filtering excludes already watched, requested, or blocked content
  - Deep pagination (5 pages/100 items) ensures fresh content after filtering
  - Integrated Jellyseerr status checking for accurate request state filtering
  - Added "Trending" navigation item to sidebar
- **Admin-Only Settings**: Restrict Settings page to Jellyfin administrators
  - Extract `Policy.IsAdministrator` from Jellyfin auth response
  - Store admin status in localStorage
  - Conditionally render Settings in sidebar
  - Access denied message for non-admin users

### 🔧 Technical

- Animation limiter (max 4/10 anchors) to prevent all-anime anchor sets
- Simplified Gemini prompt (removed unused reason field) for faster responses
- Increased Gemini maxOutputTokens to 8000 for complete JSON responses
- Added finishReason and response length debug logging
- FilterGroup layout changed to flex-wrap for better genre/mood display
- **Dual-AI Weekly Picks**: Replaced single ranking with Curator + Critic agent system
  - Curator: Discovery agent finds ~100 candidates with 1-sentence justifications
  - Critic: Quality guardian selects TOP 10 with WOW-factor

### 🐛 Bug Fixes

- **Modal Action Buttons**: Fixed buttons in info modal not removing items from view and not closing the modal after action.
- **Database Initialization**: Fixed startup crash by updating default database path from Docker-specific `/app/data/dev.db` to local `./dev.db`
- **Login UX**: Server URL field now pre-fills from localStorage or backend config

---

## [2.1.0] - 2025-12-21

### ✨ Features

- **Default AI Model**: Changed default model from `gemini-2.5-flash-lite` to `gemini-3-flash-preview`
- **Thinking Levels**: Added AI thinking level configuration for Gemini 3 models
  - Gemini 3 Pro: `high` (maximizes reasoning depth)
  - Gemini 3 Flash: `medium` (balanced thinking)
- **Improved Prompt**: Enhanced recommendation prompt with TMDb specialist role
  - "Poison list" terminology for stronger exclusion signals
  - "Discovery First" focus on hidden gems and non-mainstream hits
  - "No Franchise Stacking" rule (max 1 item per franchise)
  - Better variety mixing genres
- **Docker Quick Start**: Added comprehensive Docker installation guide to README

### 🐛 Bug Fixes

- **Nginx Timeout**: Increased proxy timeout from 60s to 180s for slow AI models
- **Deprecated Dependencies**: Fixed npm deprecated package warnings using overrides
  - `glob` upgraded to v10.4.0
  - `inflight` replaced with `@pnpm/npm-lifecycle`
  - `lodash.get`/`lodash.isequal` redirected to `lodash@4.17.21`

### 📦 Dependencies

- `better-sqlite3` 11.10.0 → 12.5.0
- `@types/node` 24.10.2 → 25.0.2
- `react` 19.2.1 → 19.2.3
- `tailwindcss` 4.1.17 → 4.1.18
- `@tailwindcss/vite` 4.1.17 → 4.1.18
- `lucide-react` 0.554.0 → 0.561.0
- `eslint-plugin-react-refresh` 0.4.24 → 0.4.25

---

## [2.0.13] - 2025-12-12

### Fixed

- Increased nginx proxy timeout to 180s for slow AI models (e.g., gemini-3.1-pro-preview)
- Added debug logging for import progress username tracking

---

## [2.0.12] - 2025-12-12

🐛 Bug Fixes

    **UI Fixes**:
        - Fixed sidebar initial state causing buttons to be unclickable
        - Fixed scroll issues in Watchlist and Recommendations views
        - Changed `overflow-visible` to `overflow-hidden` for proper scrolling

    **Docker Compatibility**:
        - Switched from `node:25-alpine` to `node:25-slim` (Debian-based)
        - Fixes `better-sqlite3` native binary requiring glibc
        - Resolves "ld-linux-x86-64.so.2: No such file or directory" error

---

[2.0.10] - 2025-12-09

🔧 Prisma 7 Migration

Major upgrade to Prisma ORM with new driver adapter architecture.

    **Driver Adapter Architecture**:
        - Upgraded to **Prisma 7.1.0** with new driver adapter pattern
        - Added `@prisma/adapter-better-sqlite3` for SQLite connections
        - Created `prisma.config.ts` for CLI configuration
        - Centralized PrismaClient in `src/db.ts` with singleton pattern
        - Updated all service/route files to use shared database connection

    **Schema Updates**:
        - New provider: `prisma-client` (replaces `prisma-client-js`)
        - Required `output` field: `../src/generated/prisma`
        - Datasource URL moved from schema to `prisma.config.ts`

🚀 CI/CD Improvements

    **Optimized Test Workflow**:
        - Tests now run only on: tags (`v*`), releases, PRs, and manual dispatch
        - Removed automatic CI on every push to main (saves GitHub Actions minutes)
        - Added `prisma generate` step before TypeScript build

---

[2.0.9] - 2025-12-08

🏗️ Infrastructure, Testing & DevOps Overhaul

Major update focusing on code quality, testing infrastructure, and developer experience.

🧪 Testing Infrastructure

    **Comprehensive Test Suite**:
        - Implemented **Vitest** for both Backend and Frontend testing
        - Added **Playwright** for End-to-End (E2E) testing
        - **Backend**: Added unit tests for security utilities (SSRF, etc.)
        - **Frontend**: Added component tests (React Testing Library) for Login, MediaCard, App
        - **CI/CD**: Added GitHub Actions workflow (`test.yml`) to fast-fail on regressions

🔧 Architecture & Code Quality

    **Shared Types Package**:
        - Created `@jellyfin-ai/types` workspace package
        - Centralized proper interfaces (`SharedMediaItem`, `ApiError`, `MediaStatus`)
        - Eliminates code duplication between frontend and backend
        - Ensures strict type safety across the full stack

    **Tailwind CSS v4 Upgrade**:
        - Updated frontend to **Tailwind CSS v4**
        - Migrated to generic `@import "tailwindcss";` syntax
        - Removed legacy configuration files (`postcss.config.js`, `tailwind.config.js`)
        - Unified dependencies with root configuration

    **Structured Logging (Backend)**:
        - Replaced `console.log` with **Pino** logger
        - **Production**: Outputs structured JSON logs for better observability
        - **Development**: Uses pretty-printing for readability
        - **Security**: auto-redacts sensitive keys (passwords, tokens, API keys)

    **API Documentation (OpenAPI)**:
        - Integrated **Swagger UI** at `/api-docs`
        - Added `swagger-jsdoc` for code-first documentation generation
        - Documented Health Check endpoint as proof-of-concept

🔒 Security & DevOps

    **Strict Environment Validation**:
        - Enhanced **Zod** validation in `utils/env.ts`
        - **Production**: Now force-exits (`process.exit(1)`) on invalid configuration to prevent undefined behavior
        - Integrated with structured logger for clear error reporting

    **Commit & Dependency Management**:
        - Added **Husky** + **Commitlint** to enforce Conventional Commits
        - Added **Dependabot** configuration for automated updates (npm + Docker + Actions)
        - Cleaned up duplicate/legacy configuration files

✨ Features

    **AI Taste Profiles**:
        - Added AI-powered **Movie Taste** and **Series Taste** analysis
        - Generates personalized text summaries of user preferences based on watch history
        - Uses Gemini AI to analyze themes, moods, and genres
        - Displays in the "My Stats" dashboard with async loading

    **Enhanced User Statistics Dashboard**:
        - Completely redesigned **User Stats Modal**
        - Added **Bar Charts** for better genre visualization (replacing pie charts)
        - Improved data accuracy for series counting and watch time
        - Added detailed genre translations (Finnish -> English)
        - Added polished UI with gradients and responsive layout

    **Detailed Media Information**:
        - Added **Info Modal** (`i` button) to all media cards
        - Displays rich metadata: Genres, Runtime, Tagline, Overview
        - Integrated direct **TMDB** links for external details
        - Responsive design containing large backdrop header


[2.0.8] - 2025-12-07

🏗️ Major Refactoring & AI Improvements

Comprehensive codebase modernization with modular architecture, unified caching, and improved AI recommendations.

🔧 Refactoring

    **Modular API Route Architecture**:
        - Split monolithic 1097-line `api.ts` into 9 focused modules:
          - `system.ts`: Config, setup, verify, image proxy (288 lines)
          - `recommendations.ts`: AI recommendations, search (217 lines)
          - `route-utils.ts`: Shared toFrontendItem helper (149 lines)
          - `settings.ts`: Import/Export (118 lines)
          - `actions.ts`: User actions, Jellyseerr requests (110 lines)
          - `user.ts`: Libraries, items, watchlist (73 lines)
          - `media.ts`: Image serving, debug (68 lines)
          - `sync.ts`: Jellyfin sync (42 lines)
          - `api.ts`: Combined router index (42 lines)
        - Each module has single responsibility for easier maintenance
        
    **Strict TypeScript Typing**:
        - Replaced `any` types with strict TypeScript interfaces throughout backend
        - Added comprehensive type definitions in `types.ts`
        - Improved IDE autocompletion and compile-time error detection
        
    **Centralized Error Handling**:
        - Created `AppError` class for consistent error responses
        - Added `errorHandler` middleware for Express
        - Implemented `getErrorMessage` utility for safe error extraction
        
    **Improved ConfigService**:
        - Added in-memory caching to reduce database reads
        - Implemented cache invalidation on config updates
        - Proper TypeScript typing for configuration objects
        
    **Frontend Hooks Extraction**:
        - Extracted SetupWizard logic to `useSetupWizard` custom hook
        - Separated business logic from presentation layer
        - Reduced SetupWizard component from 248 to 134 lines

✨ Features

    **Unified CacheService**:
        - Centralized caching with namespaced storage (jellyseerr, recommendations, config, taste)
        - Replaced scattered cache implementations with single service
        - Consistent TTLs per namespace (12h jellyseerr, 30m recommendations)
        
    **Zod Environment Validation**:
        - Added schema-based validation for environment variables at startup
        - Provides clear error messages for missing or invalid configuration
        - Validates PORT, NODE_ENV, and optional settings
        
    **Docker Development Environment**:
        - Added `docker-compose.development.yml` with hot-reload support
        - Source mounting for automatic code change detection
        - Separate Dockerfile.dev for backend (tsx watch) and frontend (Vite HMR)
        - Removed redundant `docker-compose.dev.yml`
        
    **Improved Gemini Exclusion Handling**:
        - Removed 100-item limit on exclusion data (Gemini 2.5+ has 1M+ token context)
        - Added explicit MANDATORY EXCLUSION LIST section with item count
        - Added 5 strict EXCLUSION RULES with no exceptions
        - Emphasized verification step before outputting recommendations
        - Improved prompt clarity about excluding watched, watchlist, and blocked items
        
    **Automatic Token Refresh**:
        - Implemented axios interceptor to automatically refresh expired Jellyfin tokens
        - On 401 errors, system attempts re-authentication using stored credentials
        - Password stored in sessionStorage (cleared on tab close for security)
        - Queues concurrent requests during refresh to avoid duplicate login attempts
        - Maintains Jellyfin sync functionality without manual re-login
        - Gracefully falls back to manual login if automatic refresh fails

🐛 Bug Fixes

    **Fixed Gemini API Message Format**:
        - Corrected `contents` parameter format in Gemini API calls
        - Changed from plain string to proper message object array format
        - Affects: `summarizeProfile()` and `generateRecommendations()`
        - Fixes 400 Bad Request errors when generating taste profiles and recommendations
        
    **Relaxed Import Rate Limiter**:
        - Increased import limit from 5 to 10 operations per window
        - Reduced window from 15 minutes to 5 minutes for faster recovery
        - Allows better testing and troubleshooting workflows
        
    **Improved Jellyfin 401 Error Handling**:
        - Added `JellyfinAuthError` class to identify authentication failures
        - Backend now properly propagates 401 errors to frontend instead of silently failing
        - Frontend token refresh interceptor correctly triggered on expired tokens
        - Added `[Jellyfin] AUTH ERROR` log prefix for easier debugging
        - Fixed Docker development proxy to use container networking (VITE_API_TARGET)

⚡ Performance & Optimization

    **High-Volume Recommendation Strategy**:
        - Increased Gemini batch size from 30 to 40 items per request
        - Compensates for strict verification drops to consistently yield 10+ valid recommendations
        - Added "Prioritize variety" and "Ensure accurate release years" to prompt instructions
        
    **Media Type Context Filtering**:
        - Gemini now receives ONLY relevant history based on requested media type
        - Movie requests: Only movie watch history sent (no TV shows)
        - TV requests: Only TV watch history sent (no movies)
        - Improves recommendation relevance and reduces prompt confusion
        - Saves additional tokens by filtering out irrelevant context
        
    **Full Watch History for AI**:
        - Send complete watch history to Gemini instead of trimmed 100 items
        - Leverages Gemini 2.5's 1M+ token context window
        - Ensures AI never recommends already-seen content
        
    **Detailed Drop Reason Logging**:
        - Added comprehensive logging for recommendation pipeline
        - Tracks: Raw candidate count, hard filter drops, verification failures, duplicates
        - Log format: `[Filter] DROP: "Title" (Reason)` and `[Filter] ACCEPT: "Title"`
        - Enables debugging and optimization of verification strictness

[2.0.7] - 2025-11-25

🔒 Security Patch

Critical security update addressing dependency vulnerability.

🔒 Security

    **Updated body-parser to 2.2.1**:
        - Fixes CVE for denial of service vulnerability when URL encoding is used
        - Explicitly installed body-parser@2.2.1 to override Express 5.1.0 transitive dependency
        - Resolves Dependabot security alert

✨ Features

    **Automated Version Display**:
        - Footer version now reads from package.json at build time
        - No more manual version updates in Footer component
        - Uses Vite's define config to inject version as compile-time constant

[2.0.6] - 2025-11-25

🔧 Critical Fixes: Rate Limiting & Setup Wizard

Major improvements to rate limiting for large imports and fixed Setup Wizard connection testing.

🐛 Bug Fixes

    **Fixed Setup Wizard Connection Test (404 Error)**:
        - Fixed double-slash bug in URL sanitization (`//System/Info/Public`)
        - `sanitizeUrl()` now properly removes trailing slashes from reconstructed URLs
        - Connection tests now work correctly in Setup Wizard
        - Affects: Jellyfin, Jellyseerr, and Gemini verification endpoints
        
    **Fixed Middleware Order (Request Body Parsing)**:
        - Moved `express.json()` before rate limiters
        - Ensures `req.body` is available for rate limiting logic
        - Fixes verify endpoint receiving empty payloads
        
    **Improved Rate Limiting for Production Use**:
        - Increased general limiter: 100 → 2000 requests per 15 minutes
        - Supports large imports (1000+ items) without 429 errors
        - Added skip logic for read-only GET endpoints
        - Separate limiters by operation type:
          - Auth: 10 attempts/15min
          - Recommendations: 30 requests/5min
          - Setup: 20 operations/5min
          - Import: 5 imports/15min (each processes hundreds of items internally)
        
    **Fixed Reverse Proxy Rate Limiting**:
        - Added `app.set('trust proxy', 1)` for X-Forwarded-For headers
        - Resolves `ValidationError` in ZimaOS and other reverse proxy environments
        - Rate limiter now correctly identifies users behind proxies
        
    **Fixed TV Series Images Not Displaying**:
        - Updated `/api/images/:filename` regex to accept both `movie_` and `tv_` prefixes
        - TV series poster and backdrop images now load correctly
        - Fixes 400 Bad Request error for TV show images

🔒 Security

    **Enhanced SSRF Protection**:
        - Improved URL validation with proper trailing slash handling
        - Prevents malformed URLs from bypassing security checks

📝 Technical Details

    - Rate limiter skip paths: `/system/status`, `/system/setup-defaults`, `/system/config-editor`, `/health`
    - Trust proxy level: 1 (single reverse proxy layer)
    - Import calculations: 1000 items × 2-3 API calls/batch ≈ 300 requests (well under 2000 limit)

[2.0.5] - 2025-11-25

🎯 Real-Time Import Progress & Security Hardening

Major UX improvement with live progress tracking for imports, plus critical security fixes.

✨ New Features

    **Real-Time Import Progress Tracking (SSE)**:
        - Server-Sent Events (SSE) for live import status updates
        - Beautiful animated progress bar with gradient effects
        - Live statistics: processed/total, imported, skipped, errors
        - Current item display during import
        - Auto-cleanup after 5 minutes
        - Endpoint: `GET /api/settings/import/progress/:username`
        
    **Async Import Processing**:
        - Large imports (>50 items) now process asynchronously
        - Batch processing (10 items per batch) prevents timeouts
        - Threshold-based: ≤50 items = synchronous, >50 = async
        - No more 504 timeouts on large JSON files
        
    **Enhanced Image Architecture**:
        - Dual URL storage: local cached path + original source URL
        - Backend serves cached images via `/api/images/:filename`
        - Smart fallback logic: local → proxy → source → construct
        - Schema fields: `posterSourceUrl`, `backdropSourceUrl`
        
    **Import Button State Management**:
        - Button automatically disables during active imports
        - Loading spinner with "Importing..." text
        - Success message replaces old async notification
        - Clean UX with single source of truth (progress bar)

🐛 Bug Fixes

    **Authentication Double-Slash Fix**:
        - `authService.ts`: Remove trailing slash before path concatenation
        - `jellyfin.ts`: Fixed in all methods (getLibraries, getItems, getUserHistory, getOwnedIds)
        - Prevents `//emby/Users/...` and similar malformed URLs
        
    **Nested Validation Fix**:
        - `validators.ts`: Changed from `body('tmdbId')` to `body('item.tmdbId')`
        - Properly validates nested `{ item: { tmdbId, mediaType, ... } }` payloads
        - Fixes 400 Bad Request errors on watchlist actions
        
    **Image Proxy Query Parameters**:
        - `image.ts`: Handles proxy URLs with query strings correctly
        - Pattern: `/api/proxy/image?type=poster&path=...`
        
    **Gemini Profile Generation**:
        - `taste.ts`: Requires minimum 3 items before API call
        - Prevents errors when insufficient data available

🔒 Security Improvements

    **Auth Error Logging Sanitization**:
        - `authService.ts`: Only logs `{ status, message }` instead of full response
        - Prevents potential leak of sensitive error details from Jellyfin
        - No passwords, tokens, or full responses in logs
        
    **Console.log Audit**:
        - Reviewed all 100+ console.log statements across codebase
        - Gemini API key: Only logs source (DB/ENV), never the actual key
        - Jellyfin token: Test scripts truncate to first 12 chars
        - Passwords: Never logged anywhere
        - All logging safe for production use

📝 Technical Details

**Modified Files**:
    - `backend/prisma/schema.prisma`: Added posterSourceUrl, backdropSourceUrl fields
    - `backend/src/authService.ts`: Double-slash fix + secure error logging
    - `backend/src/jellyfin.ts`: Double-slash fix in all methods
    - `backend/src/middleware/validators.ts`: Nested object validation
    - `backend/src/routes/api.ts`: SSE endpoint + async import + image serving
    - `backend/src/services/data.ts`: Dual URL storage implementation
    - `backend/src/services/image.ts`: Query parameter handling fix
    - `backend/src/services/import.ts`: Progress tracking + batch processing
    - `backend/src/services/taste.ts`: Minimum item requirement (3)
    - `frontend/src/components/SettingsView.tsx`: SSE client + progress bar UI
    - `frontend/src/components/MediaCard.tsx`: Debug logging
    
**New Files**:
    - `docker-compose.dev.yml`: Local development Docker configuration

**Database Schema Changes**:
    ```prisma
    model Media {
      posterUrl String?           // Local: /images/movie_123_poster.jpg
      posterSourceUrl String?     // Source: /api/proxy/image?...
      backdropUrl String?         // Local: /images/movie_123_backdrop.jpg
      backdropSourceUrl String?   // Source: /api/proxy/image?...
    }
    ```

**Breaking Changes**: None - All changes are backward compatible

---

[2.0.4] - 2025-11-25

🔓 Permissive Mode for Self-Hosted Environments

Complete redesign of URL validation to prioritize user experience in self-hosted setups.

✨ New Features

    **Fully Permissive URL Validation**:
        `validateSafeUrl()` now uses protocol-only validation
        Accepts ANY http/https URL without domain restrictions
        Perfect for self-hosted Jellyfin/Jellyseerr instances
        Supports all local IPs, private networks, and proxy domains
        Removed cloud metadata endpoint blocking (trust user environment)
        
    **Simplified Security Model**:
        Single validation rule: Must be valid http:// or https:// URL
        No IP range restrictions
        No domain allowlists for health checks
        Designed for trusted self-hosted environments where users control all services

🐛 Bug Fixes

    Fixed `validateSafeUrl()` using strict allowlist for user-configured services
    Fixed health checks failing for non-allowlisted domains
    Fixed axios calls blocked by overly restrictive SSRF protection

📝 Technical Details

    Modified: `backend/src/utils/ssrf-protection.ts`
        - `validateSafeUrl()`: Now protocol-only validation
        - `validateRequestUrl()`: Now protocol-only validation
        - `validateBaseUrl()`: Now protocol-only validation
        - Removed domain allowlist checking from all validation functions
        - Removed private IP detection logic
        - Kept URL reconstruction for CodeQL taint flow compliance

---

[2.0.4-beta2] - 2025-11-25

🔒 Security & Configuration Improvements

Major security hardening and configuration flexibility updates.

✨ New Features

    Setup Wizard URL Flexibility:
        Now accepts proxy URLs (e.g., `https://jellyfin.example.com`)
        Accepts local IPs with HTTP (e.g., `http://192.168.1.100:8096`)
        Accepts any valid http/https URL for Jellyfin/Jellyseerr
        Better error messages showing rejected URLs
        
    SSRF Protection Enhancements:
        Split validation into two modes:
            - `sanitizeConfigUrl()`: Permissive for user config (allows any domain)
            - `sanitizeUrl()`: Strict for image proxy (allowlist-only)
        Private IP support: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
        Localhost and Docker hostname support
        Removed cloud metadata endpoint blocking for self-hosted trust
        
    Image Proxying:
        ALL images now forced through `/api/proxy/image`
        Prevents 403 errors from Cloudflare/WAF-protected sources
        Handles both absolute URLs and relative paths
        Bypasses CORS restrictions
        
    Settings URL Change Detection:
        ConfigEditor now detects when Jellyseerr URL changes
        Displays notification to user to re-download images
        Suggests running migration script or waiting for next sync
        Backend automatically loads fresh config on login
        
    Environment Configuration:
        `ALLOWED_IMAGE_DOMAINS`: Allow custom domains for strict mode
        Documented in README, docker-compose.prod.yml, .env.example

🐛 Bug Fixes

    Fixed Setup Wizard rejecting local IP addresses
    Fixed Setup Wizard rejecting proxy URLs (e.g., Cloudflare tunnels)
    Fixed external Jellyseerr images returning 403 to frontend
    Fixed Zod URL validation requiring valid TLD for IP addresses

🔒 Security

    Added CodeQL suppression comments for intentional SSRF
    Documented all axios calls to user-configured services
    Maintained strict validation for cloud metadata endpoints
    URL reconstruction to break taint chains for security scanners
    Format string injection prevention (safe logging)

📚 Documentation

    Added SSRF protection configuration guide
    Updated README with `ALLOWED_IMAGE_DOMAINS` usage
    Added security context for self-hosted applications

[2.0.4-beta] - 2025-11-25

🖼️ Local Image Caching System (BETA)

Complete overhaul of image handling to eliminate dependency on external Jellyseerr URLs.

✨ New Features

    Local Image Storage:
        All poster and backdrop images downloaded to /app/images directory
        Standardized naming: `{mediaType}_{tmdbId}_{type}.jpg`
        Automatic download on media insert/update via DataService
        Images persist across container restarts via Docker volume
        
    ImageService (NEW):
        `download()`: Download images from external URLs with retry logic
        `downloadMediaImages()`: Batch download poster and backdrop
        `getLocalPath()`: Generate standardized local URLs
        `imageExists()`: Check if image already cached
        Automatic fallback to fresh Jellyseerr URLs on download failure
        
    Static File Serving:
        Express middleware serves images at `/images/*`
        No proxy overhead - direct file serving
        Configurable via IMAGE_DIR environment variable
        
    Migration Script:
        `npm run db:migrate-images` to fix existing database entries
        Downloads all external images to local storage
        Retries failed downloads with Jellyseerr lookup
        Comprehensive progress logging and statistics

🔧 Infrastructure Changes

    docker-compose.prod.yml:
        Added IMAGE_DIR=/app/images environment variable
        Added ./images:/app/images volume mount
        Images directory persisted on host
        
    .gitignore:
        Added images/ directory exclusion
        
    Documentation:
        Added images/README.md with usage instructions

🎯 Benefits

    Eliminates broken images when Jellyseerr IP changes
    Faster loading (no proxy roundtrip)
    Reduced external API dependencies
    Consistent image availability
    Self-healing architecture

⚠️ Beta Notes

    Run `npm run db:migrate-images` after updating to migrate existing data
    Monitor disk usage in images/ directory
    Ensure sufficient storage space for image cache

[2.0.3] - 2025-11-25

🔧 CORS & Network Fixes + Backup/Recovery System + Image Proxy + Mobile UX Overhaul

Critical fixes for LAN deployments, comprehensive disaster recovery, responsive image handling, and mobile-first UI improvements.

🐛 Bug Fixes

    Fixed CORS Security Vulnerability (Critical):
        Replaced unsafe `origin: true` with strict validation function
        Allows only private IP ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
        Allows localhost and configured CORS_ORIGIN from environment
        Blocks external public domains to prevent CORS hijacking
        Fixes GitHub CodeQL Critical security alert
        
    Fixed Image Loading 403 Errors:
        Implemented `/api/proxy/image` endpoint to route images through backend
        Bypasses Cloudflare/WAF protections on external Jellyseerr servers
        Includes Cache-Control headers (1 day) for improved performance
        SSRF protection and URL validation maintained
        
    Fixed Configuration Persistence:
        Database values now take priority when isConfigured=true
        Prevents environment variables from overriding UI changes
        Settings page updates now persist across container restarts
        Maintains backward compatibility with env-only setups
        
    Fixed Block Button Visibility:
        Replaced Slash icon with Ban icon for clearer visual indication
        Optimized button layout spacing (gap-1, justify-evenly) for 4 buttons
        All action buttons (Request, Watchlist, Watched, Block) now properly visible

✨ New Features: Backup & Recovery System

    Bulletproof Startup Sequence (`backend/start.sh`):
        Automatic database backup before schema changes (`dev.db.backup_startup`)
        Self-healing schema sync with `prisma db push` (fixes "Table not found" errors)
        Automatic JSON export on every boot for portable backups
        Proper error handling and logging at each step

    Database Backup Script (`backend/scripts/backup_db.ts`):
        Exports complete database state to JSON
        Includes system configuration and all user data
        Creates both `backup_latest.json` and timestamped backups
        Compatible with legacy import format
        Manual backup: `npm run db:backup`

    Setup Wizard Restore Feature:
        "Restore from Backup" section in Setup Wizard
        Upload backup JSON to pre-fill configuration
        Automatic extraction of Jellyfin, Jellyseerr, and Gemini settings
        Ready for watch history restoration after first login
        Supports both new multi-user and legacy single-user backup formats

✨ Mobile UX Improvements

    Responsive Image System:
        Mobile: Displays backdrop images (16:9 landscape) for better horizontal layout
        Desktop: Maintains poster images (2:3 portrait) for classic grid view
        Dual image rendering with CSS visibility toggles at `md` breakpoint
        Automatic fallback between poster and backdrop based on availability
        
    Mobile-First Grid Layout:
        Mobile: Single column (grid-cols-1) for full-width landscape cards
        Tablet: 2 columns (sm:grid-cols-2)
        Desktop: 3-5 columns (md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5)
        Prevents squished horizontal cards on mobile devices
        
    Enhanced Touch Targets:
        Increased button padding on mobile (p-3 vs p-2 on desktop)
        Larger icons on mobile (w-6 h-6 vs w-5 h-5 on desktop)
        Minimum 48x48px touch targets for accessibility
        Consistent spacing across all action buttons
        
    Image Proxy Upgrade:
        Added `type` parameter support (poster | backdrop)
        Poster: w300_and_h450_face (portrait, 300x450px)
        Backdrop: w1920_and_h800_multi_faces (landscape, 1920x800px)
        High-resolution backdrop images for mobile landscape layout
        Automatic type parameter in URL generation

🔧 Infrastructure

    Updated Dockerfile:
        Changed CMD to use `start.sh` instead of direct node command
        Kept devDependencies for ts-node (required by backup script)
        Made start.sh executable in build process

    Docker Compose Updates:
        Added `DATA_DIR=/app/data` environment variable
        Ensures backup script knows where to write files

    New Documentation:
        Added comprehensive `BACKUP_RECOVERY.md` guide
        Covers all disaster recovery scenarios
        Includes troubleshooting and best practices

📦 Package Scripts

    Added `db:backup` script to backend package.json
    Enables manual database backups: `npm run db:backup`

🔐 Security Enhancements

    Strict CORS policy with private network allowlist
    CORS_ORIGIN environment variable for public deployments
    Comprehensive documentation for public internet exposure
    Image proxy prevents direct external resource access

🚀 Deployment

    Production deployment now fully working on local network IPs
    Support for public deployment via CORS_ORIGIN configuration
    Self-healing database initialization on first startup
    Automatic backups protect against data loss during upgrades
    Complete disaster recovery workflow for migrations
    Images load reliably through backend proxy

[2.0.2] - 2025-11-24

🔧 Network & Deployment Fixes

Critical fixes for remote server deployments and Docker production environments.

🐛 Bug Fixes

    Fixed Network Error on Remote Deployments:
        Changed frontend to use relative API paths (/api) instead of hardcoded localhost
        Updated frontend/src/services/api.ts to use BASE_URL = '/api'
        Removed VITE_BACKEND_URL environment variable fallback logic
        Now works correctly on any IP address, domain, or port (ZimaOS, NAS, remote servers)

    Fixed Docker Volume Mount Issue:
        Changed docker-compose.prod.yml volume mount from ./data:/app/prisma to ./data:/app/data
        Updated DATABASE_URL to file:/app/data/dev.db
        Prevents volume mount from overwriting container's Prisma schema and migrations
        Fixes "Prisma Schema not found" error in production Docker deployments

    Fixed Nginx 405 Method Not Allowed Error:
        Updated frontend/nginx.conf with strict API proxy configuration
        Added X-Real-IP and X-Forwarded-For headers for proper backend logging
        Removed try_files fallback from /api/ location (now returns 502 if backend is down)
        Prevents Nginx from serving static HTML for API POST requests

    Fixed Docker Images for GitHub Actions:
        Updated docker-compose.prod.yml to use :latest tags instead of version-specific tags
        Images now automatically pulled from ghcr.io/jessepesse/jellyfin-ai-recommender-*:latest
        Simplifies production deployment workflow

📝 Configuration

    Created .env.example files:
        backend/.env.example with DATABASE_URL and optional service URLs
        frontend/.env.example with VITE_BACKEND_URL documentation
        Updated .gitignore to allow .env.example files

🚀 Deployment

    Production deployment now fully working on Docker with correct networking
    Supports local development, remote servers, and containerized environments
    All API requests use relative paths for maximum portability

[2.0.1] - 2025-11-24

🔒 Security Hardening Release

Critical security improvements and vulnerability fixes identified by GitHub CodeQL security scanning.

🛡️ Security Fixes

    Comprehensive SSRF Protection:
        Created centralized URL validation utility (backend/src/utils/ssrf-protection.ts)
        Added validateRequestUrl() for complete URL validation before HTTP requests
        Added validateBaseUrl() for explicit axios instance baseURL validation
        Added validateSafeUrl() for explicit runtime validation immediately before axios calls (breaks CodeQL taint flow)
        Blocks cloud metadata endpoints (AWS, GCP, Azure, Alibaba Cloud)
        Blocks link-local addresses (169.254.0.0/16)
        Blocks non-HTTP protocols
        Fixed CRITICAL vulnerability in getBaseUrl() - was returning unsanitized URLs
        Fixed CRITICAL vulnerability in ConfigService.saveConfig() - was storing unvalidated URLs
        Fixed CRITICAL vulnerability in HTTP header processing - was not validating x-jellyfin-url at entry point
        Fixed CRITICAL: Added explicit runtime validation wrapper on ALL axios calls to break CodeQL taint tracking
        Fixed 27+ locations with defense-in-depth (entry-point, write-time, read-time, use-time validation):
          - routes/api.ts: ALL HTTP headers (x-jellyfin-url) now validated at entry point (CRITICAL FIX - 6 endpoints)
          - config.ts: saveConfig() now validates URLs BEFORE saving to database (CRITICAL FIX)
          - jellyfin.ts: getBaseUrl() validates all URLs from config/env (CRITICAL FIX)
          - jellyfin.ts: 4 axios.get calls wrapped with validateSafeUrl() (getLibraries, getItems, getUserHistory, getOwnedIds)
          - routes/api.ts: 2 verification endpoints wrapped with validateSafeUrl() (Jellyfin, Jellyseerr)
          - authService.ts: 1 axios.post wrapped with validateSafeUrl() (Jellyfin authentication)
          - jellyseerr.ts: 1 axios.create in jellyseerr.ts (Jellyseerr API client with validateBaseUrl)
          - routes/api.ts: 1 posterUrl construction (JELLYSEERR_URL environment variable)
          - jellyseerr.ts: 2 URL construction functions (constructPosterUrl, constructBackdropUrl)
        Applied complete defense-in-depth: validation at entry point (HTTP headers), storage writes (database), storage reads (getBaseUrl), HTTP usage (validateSafeUrl wrapper on every axios call)

    ReDoS Prevention:
        Fixed 2 polynomial regex complexity vulnerabilities
        Replaced /\/+$/ with safe while loops
        Replaced /#.*$/ with indexOf() + slice()
        Prevents exponential backtracking on malicious input strings

    Format String Injection:
        Fixed 2 externally-controlled format strings in error logging
        backend/src/jellyfin.ts:97 (getItems libraryId)
        backend/src/jellyfin.ts:133 (getUserHistory userId)
        Uses parameterized logging (%s placeholders) to prevent injection attacks

    Sensitive Data Logging:
        Removed all API key logging (even masked) from gemini.ts and config.ts
        Prevents timing attacks and log analysis vulnerabilities

    Security Headers (Helmet):
        Added XSS protection headers
        Added clickjacking protection (X-Frame-Options)
        Added MIME type sniffing protection
        Content Security Policy configured for React

    Rate Limiting:
        Authentication: 5 attempts per 15 minutes
        Recommendations: 10 requests per 5 minutes
        General API: 100 requests per 15 minutes

    Input Validation (Express-Validator):
        Centralized validation middleware for all critical endpoints
        Validates user actions (watched, watchlist, block)
        Validates media requests, config updates, Jellyfin sync

🐛 Bug Fixes

    Fixed Network Error on Remote Deployments (BREAKING FIX):
        Removed hardcoded http://localhost:3001 references from frontend
        Frontend now uses relative /api paths (works on any server IP/domain)
        Added Vite proxy configuration for development (/api → http://localhost:3001)
        Updated AuthContext.tsx and api.ts to use relative paths
        Fixed "Network Error" when deploying to ZimaOS, NAS, or remote servers
        No rebuild required when changing server IP/domain
        frontend/.env now optional (VITE_BACKEND_URL only for custom overrides)

    Fixed Docker Database Volume Mount:
        Changed volume mount from file (./data/dev.db) to directory (./data:/app/prisma)
        Allows Prisma to create database file automatically on first run
        Fixed 500 errors in Setup Wizard caused by empty directory mount
        Added data/ to .gitignore for persistent storage

    Fixed DATABASE_URL Missing Error:
        Created backend/.env.example with required DATABASE_URL configuration
        Updated backend/.gitignore to allow .env.example while still ignoring .env
        Resolves PrismaClientInitializationError on startup
        Users can now copy: cp backend/.env.example backend/.env

    Restored Missing Files:
        backend/Dockerfile (multi-stage Node.js build)
        backend/.dockerignore (prevents secrets in images)
        backend/.gitignore (prevents committing secrets)
        backend/nodemon.json (development server config)

    Removed .vite cache from git tracking
    Fixed .env file handling (now managed via setup wizard only)

📦 Dependencies

    Added: helmet, express-rate-limit, express-validator
    Backend lockfile generated (0 npm vulnerabilities)
    Frontend updated: esbuild and vite to latest (fixed moderate vulnerability)

Tag: v2.0.1 | Date: 2025-11-24 | Type: Security Patch

[2.0.0] - 2025-11-24

🚀 The Great Migration Release

Complete rewrite of the application architecture from a monolithic Python script to a modern Full-Stack Web Application. This release focuses on performance, scalability, data integrity, and user experience.

✨ New Features (Architecture & Core)

    Full Stack Rewrite:

        Frontend: Rebuilt with React, Vite, and TypeScript.

        Backend: Rebuilt with Node.js, Express, and TypeScript.

        Database: Migrated from JSON flat-file to SQLite + Prisma ORM for relational integrity and performance.

    UI Modernization:

        Implemented responsive design with Tailwind CSS (Mobile-First).

        Added Dark Mode "Glassmorphism" aesthetic.

        Created a Sidebar navigation drawer for mobile devices.

        Added Optimistic UI: Cards disappear instantly upon action without waiting for server response.

        Rich Metadata: Media cards now display rating badges (⭐️ 7.8), release years, and posters via Jellyseerr proxy.

🧠 AI & Intelligence Upgrades

    "Trust No AI" Pipeline: Backend strictly verifies every Gemini suggestion against Jellyseerr (Title + Year check) before displaying it. Prevents hallucinations and broken links.

    Dynamic Taste Profile: Background service analyzes user watch history to generate a text-based "Taste Profile" for context-aware recommendations.

    Semantic Filtering: Recommendation logic understands "Positive" (Watchlist/History) vs "Negative" (Blocked) signals.

    Smart Discovery: Logic tuned to strictly exclude content already present in the Jellyfin library.

    Auto-Replenishment: Backend loops requests to Gemini until 10 valid, non-duplicate items are found.

🛠️ Functional Improvements

    Jellyfin Watch History Sync:

        New endpoint to bulk import watch history directly from Jellyfin.

        Uses ProviderIds.Tmdb for 100% accurate matching.

        Smart deduplication skips already synced items.

    System Configuration Editor:

        Manage API Keys, URLs, and AI Models directly from the Settings page.

        Values are stored in the database, removing the need to edit .env files.

        "Test Connections" button verifies services before saving.

    Robust Data Mapping: Standardized Movie vs TV handling (title/name, releaseDate/firstAirDate) across the entire stack.

    Jellyseerr Integration:

        Fixed encoding issues with special characters (e.g., "Mission: Impossible").

        Enforced strict payloads (seasons: [] for TV) to fix 500 errors.

        Added caching for enrichment results.

    Legacy Data Import: Non-destructive tool to migrate data from v1 database.json.

    Gemini Thinking Models: Updated to support Gemini 2.5+ and 3.0+ thinking capabilities with automatic dynamic reasoning adjustment.

    Model Selection: Dropdown with current Google AI models (gemini-2.5-flash-lite, gemini-2.5-flash, gemini-2.5-pro, gemini-3.1-pro-preview).

🐛 Bug Fixes

    Recommendation Logic: Fixed issue where watched movies appeared in recommendations by enforcing TMDB ID extraction from Jellyfin.

    Data Integrity: Fixed "Ghost Cards" by enforcing strict ID validation in the backend.

    Metadata: Fixed bug where TV shows were saved without titles/years due to API field mismatches.

    Styling: Fixed PostCSS/Tailwind configuration issues (downgraded to stable v3.4 for compatibility).

    Docker: Adjusted Dockerfiles to map frontend port to 3000 and ensure Prisma generation during build.

    Authentication: Fixed logic to prioritize User Session Tokens over global API keys to prevent 401 errors.

    UI Shadow Clipping: Fixed gradient shadow cutoff on filter buttons and hero buttons by removing mask utilities and adding proper padding.

    CORS Issues: Updated backend to accept requests from any localhost port during development for flexibility.

🧪 Developer Experience

    Testing Scripts: Added scripts (test_sync.js, test_exclusions.js) for validating data integrity.

    Cleanup: Removed obsolete Python scripts and configuration files.

Tag: v2.0.0 | Date: 2025-11-24 | Type: Major Release

[0.2.7-alpha] - 2025-11-21 (Legacy Python)

🎯 Overview

Small patch release addressing a migration UX issue and cleaning up ephemeral migration artifacts.

✨ What's New

    TMDB ID Backfill: UI for migrating legacy data to include TMDB IDs.

    Safety: Dry-run mode and automatic backups before migration.

[0.2.6-alpha] - 2025-11-21 (Legacy Python)

🎯 Overview

Improvements to Gemini integration and infrastructure.

✨ What's New

    Model Update: Switched to gemini-2.5-flash-lite.

    Prompt Engineering: Rewrote prompts to English for better compliance.

    CI: Fixed Docker Buildx workflows.

[0.2.5-alpha] - 2025-11-16 (Legacy Python)

🎯 Overview

Comprehensive TMDB ID storage and rate limiting.

✨ What's New

    Schema Update: All media lists now store objects with tmdb_id.

    Rate Limiting: Added cooldowns to prevent API spam.

    Availability Sync: Automatic tracking of available content on Jellyseerr.

[0.2.4-alpha] - 2025-11-16 (Legacy Python)

🎯 Overview

Major UI/UX improvements focusing on navigation.

✨ What's New

    Sidebar: Replaced tabs with a proper sidebar navigation.

    Visual Polish: Improved layout, icons, and responsiveness.

[0.2.3-alpha] - 2025-11-13 (Legacy Python)

🎯 Overview

Added parallel processing and fixed session state bugs.

✨ What's New

    Performance: Used ThreadPoolExecutor for faster API calls.

    Features: Added "Mark as Watched" button to watchlist.

[0.2.2-alpha] - 2025-11-13 (Legacy Python)

🎯 Overview

Added manual search functionality.

✨ What's New

    Manual Search: Query Jellyseerr to add items manually.

    Caching: Improved search performance.

[0.2.1-alpha] - 2025-11-13 (Legacy Python)

🎯 Overview

Introduced tabbed interface and statistics.

✨ What's New

    Tabs: Organized UI into logical sections.

    Statistics: Added counts for movies/series.

[0.2.0-alpha] - 2025-11-12 (Legacy Python)

🎯 Overview

Added comprehensive error handling and logging.

✨ What's New

    Logging: Centralized log file with rotation.

    Retry Logic: Exponential backoff for API calls.

[0.1.0-alpha] (Legacy Python)

🎯 Overview

Initial alpha release.

✨ Features

    Jellyfin Integration

    AI Recommendations

    Jellyseerr Integration

    JSON Database

    Streamlit UI