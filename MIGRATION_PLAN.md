# Migration Plan: Python/Streamlit to Node.js/React

This document tracks the migration of the Jellyfin AI Recommender from a Python-based prototype to a production-ready web application.

## 1. Analysis

- [x] Analyze the existing Python/Streamlit application.
- [x] Identify core features to be migrated.

## 2. Scaffolding

- [x] Create a new project structure for the Node.js backend and React frontend.
- [x] Set up `package.json`, `tsconfig.json`, and ESLint for both projects.
- [x] Set up Vite for the frontend.
- [x] Set up Express/Node.js for the backend.

## 3. Logic Migration (Backend)

- [x] Rewrite Python recommendation logic in TypeScript (`backend/src/recommender.ts`).
- [x] Implement Jellyfin API calls in TypeScript (`backend/src/jellyfin.ts`).
- [x] Create backend API endpoints (`backend/src/routes/api.ts`).
- [x] Handle environment variables securely (`.env`).

## 4. UI Implementation (Frontend)

- [x] Build the main application layout (`frontend/src/App.tsx`).
- [x] Create React components to replace Streamlit widgets:
    - [x] `LibrarySelector.tsx`
    - [x] `ItemList.tsx`
    - [x] `SearchBar.tsx`
- [x] Remove client-side settings management (`SettingsSidebar.tsx`, `SettingsContext.tsx`).
- [x] Connect the frontend to the backend API (`frontend/src/services/api.ts`).

## Next steps
## Planned Work: Authentication & UI polish

1) Authentication (Login) — High priority
- Goal: Allow users to authenticate with Jellyfin and use their own user context for recommendations and watch history.
- Tasks:
    - Implement backend endpoint `POST /api/login` that accepts username/password and authenticates with the Jellyfin server (use Jellyfin's authentication endpoint). Return or store the resulting access token and user ID securely.
    - Implement a frontend `Login` component that supports:
        - Username/password flow (preferred for per-user sessions)
        - Optional API-key input as a simpler alternative for advanced users (API key stored in backend or used per-session)
    - Update backend to proxy Jellyfin requests using the authenticated user's token (avoid exposing tokens in the frontend where possible).
- Acceptance criteria:
    - User can sign in and the app uses their Jellyfin account to fetch libraries and items.
    - Tokens are not leaked in client-side logs; backend stores or proxies tokens safely (http-only cookie or server session) or returns a short-lived token for frontend use.

2) Frontend UI polish — Medium priority
- Goal: Improve visual design, spacing, typography and responsiveness so the app is readable and pleasant out of the box.
- Tasks:
    - Improve header and sidebar spacing, add clear visual hierarchy for the page title and buttons.
    - Update `ItemList` layout to use card-style tiles with consistent paddings/margins and nicer fallback images.
    - Ensure colors and contrast meet basic accessibility requirements and mobile responsiveness.
    - Add small UX touches: loading spinners, disabled states, and clearer error messages.
- Acceptance criteria:
    - The main view is visually balanced with readable typography and consistent spacing on desktop and mobile.
    - Loading/network operations show progress states and actionable error messages.

Assign owners and time estimates for each task when planning a sprint. Both tasks can be implemented independently; UI polish can be started immediately while work on authentication proceeds on the backend.

## Code Review: `app.py` — Authentication Summary & Recommendations

Summary:
- `app.py` is the original Streamlit application and contains a number of critical behaviors and helpers that the migration must preserve or intentionally replace. The file reads environment variables at startup for integrations and relies on them throughout the codebase.
- Authentication and integration-related environment variables used by `app.py`:
  - `JELLYFIN_URL` — base URL for Jellyfin API
  - `JELLYFIN_API_KEY` — API key or token used for Jellyfin requests (must be present for current startup path)
  - `JELLYSEERR_URL` — Jellyseerr instance URL used for metadata / TMDB lookups
  - `JELLYSEERR_API_KEY` — Jellyseerr API key
  - `GEMINI_API_KEY` — key for Gemini/LLM integration (optional depending on whether LLM is used)

Key findings from code review:
- `app.py` expects `JELLYFIN_API_KEY` (or equivalent) to exist at startup; without it the app intentionally raises and aborts. This behavior previously caused the backend service to fail when `.env` was in the repo root instead of `backend/.env`.
- There are two implicit auth models in the codebase:
  1. Service-level API-key (server-managed, present in `.env`) — easiest to maintain during migration but limits per-user personalization.
  2. Per-user authentication (user/password → token) handled inside Streamlit (not currently implemented in migrated TS backend). `app.py` contains logic that expects to operate in a fully authenticated context and reads user IDs from Jellyfin endpoints.
- `app.py` also contains higher-level concerns (retry/backoff, rate-limiting for Gemini, and migration helpers) that assume authenticated access when calling external APIs.

Recommendations (Authentication roadmap):
1. Short-term / migration-safe approach (Phase 1):
    - Continue supporting a server-side `JELLYFIN_API_KEY` in the backend `.env` so `app.py` behavior can be reproduced and validated during migration. Keep `app.py` available as a canonical reference and fallback.
    - Implement backend proxy endpoints that require no immediate per-user authentication, but allow the UI to run end-to-end for validation and QA.

2. Mid-term: per-user login (Phase 2):
    - Design `POST /api/login` in the TypeScript backend which authenticates a user against Jellyfin and returns a short-lived session token, or stores the token server-side and uses a secure cookie. Prefer the server-side proxy model for production to avoid exposing tokens to the browser.
    - Implement frontend `Login` component and session state; after login, use per-user context for fetching libraries and watch history.

3. Long-term: hybrid & security hardening (Phase 3):
    - Support both API-key admin mode and per-user mode; document how to enable each mode clearly.
    - Add secure secret management (Vault/Docker secrets) and recommendations for production deployment.

Acceptance criteria for authentication work:
- Phase 1: Backend can run and proxy Jellyfin endpoints using `JELLYFIN_API_KEY`; frontend connects, fetches libraries and items, and demonstrates the same flows that `app.py` provides.
- Phase 2: Users can authenticate with credentials and perform the same actions using their account context (fetching personal watch history and recommendations). Tokens are not leaked to console logs and are stored/proxied securely.
- Phase 3: Production deployment uses secret management; documentation includes clear steps to switch modes.

## Migration safeguard: protect `app.py`

Rule: Do not remove or permanently delete `app.py` from the repository until the full migration is validated.

Rationale:
- `app.py` is the canonical implementation and test-oracle for many flows (authentication assumptions, migration steps, Gemini prompt-engineering, backup/restore and UI behavior). During migration we must be able to run and compare behavior between the original Streamlit app and the new Node/React stack.

Safeguard actions:
- Add `app.py` to the repository and ensure it remains available in the feature branch (do not remove in PRs). If it must be renamed for repo cleanliness, keep a copy under `legacy/app.py` and document the location.
- Add a checklist item to PR templates or the migration plan: `Verify parity with app.py before deprecating` — this must be signed off by the maintainer.

Add these authentication tasks to the migration backlog and assign owners and estimates. Use `app.py` as a reference implementation during testing and acceptance.

## Missing features (added)

Below are features and topics that are not present in this migration plan but are required or recommended based on the repository documentation and current code. Add these to the plan to ensure full migration and production readiness.

### High priority
- Gemini / LLM integration: specify where AI calls will be made (backend endpoint), model selection, API key (`GEMINI_API_KEY`), prompt engineering requirements (JSON-only responses), rate limits and retry/backoff strategy, and localization rules.
- Jellyseerr integration: search/request endpoints, required API keys (`JELLYSEERR_API_KEY`), error handling and offline behavior.
- Database / `database.json` handling: schema, watchlist/blacklist/manual entries, backup & restore, sync behavior and atomic updates.
- User and session handling: clear plan for user ID selection (do not assume `/Users[0]`), per-user data storage, authentication/authorization requirements.
- Configuration and secrets management: add `.env.example`, list required env variables (`JELLYFIN_URL`, `JELLYFIN_API_KEY`, `GEMINI_API_KEY`, `USER_ID`), and recommend secure secret handling (Docker secrets, CI vault).
- Recommendation feedback endpoints and UI: "Mark as Watched", "Do Not Recommend", "Add to Watchlist" APIs and persistence logic.

### Medium priority
- Error handling and logging: centralized logging (e.g. `app.log`), structured error responses, and monitoring (Sentry or similar).
- Rate limiting and cost controls for Gemini API: cooldowns, request quotas, and cost-tracking.
- Caching and performance: server-side caching for Jellyfin/Jellyseerr responses and image thumbnails (TTL), and frontend caching strategies.
- Concurrency and parallel requests: plan for async request handling, safe parallel fetches, and rate control.
- Scalability for large libraries: pagination/streaming, lazy loading, and search limits.

### Low priority
- Testing and CI: unit and integration tests, GitHub Actions or other CI configuration, linting and formatting enforcement.
- Containerization and deployment: `docker-compose.yml` and deployment guidance for production.
- Documentation and `.env` examples: update README and add `.env.example` with Windows PowerShell copy commands.
- Localization and accessibility: UI localization guidance (Finnish texts), ARIA support, and keyboard accessibility.
- Security and CORS: hardening, input validation, CORS policies and production readiness checks.
- Image and metadata handling: thumbnail strategy, CDN/proxy recommendations, and fallback behavior.

### Plan inconsistencies to resolve
- Client-side settings: the plan indicates removal of client-side settings, but `SettingsContext.tsx` and `SettingsProvider` are still present in the code. Decide to remove or fully integrate settings into the plan.
- AI vs heuristic recommender: README and `GEMINI.md` expect Gemini-based recommendations while `backend/src/recommender.ts` currently uses a simple heuristic. Decide whether to use LLM, heuristic, or hybrid approach and document the migration steps.
- Jellyfin user selection: code currently uses the first `/Users` entry; add a clear UX or backend config to select the correct Jellyfin user ID or require `USER_ID` in configuration.

Add these items to the migration plan and assign owners/estimates to make the migration complete and production-ready.
