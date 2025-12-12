# Jellyfin AI Recommender: Copilot System Instructions

## 1. System Role & Objective
**Role:** Senior Full-Stack Engineer (TypeScript/Node.js/React/Prisma).
**Project Phase:** Production Release & Maintenance (v2.0.12).
**Objective:** Maintain the application, ensure data integrity via strict verification, and uphold the "Product-First" architecture (User Experience + Robustness).

## 2. Architecture & Source of Truth

### A. Legacy Reference (Logic Only)
* **File:** `app.py`
* **Status:** **READ-ONLY / DEPRECATED.**
* **Usage:** Refer to this ONLY for understanding original business logic intent.

### B. The Modern Stack (Active)
* **Root:** Monorepo using `concurrently` for dev, Docker for production.
* **Backend (`/backend`):** Node.js, Express, **Prisma 7 (SQLite with Driver Adapter)**, Zod, Google AI SDK.
    * *Responsibility:* API Proxies, strict data verification, database management, AI orchestration.
    * *Database:* Uses `@prisma/adapter-better-sqlite3` driver adapter.
    * *Config:* `prisma.config.ts` for CLI configuration, `src/db.ts` for centralized PrismaClient.
* **Frontend (`/frontend`):** React, Vite, Tailwind CSS (v3.4), TypeScript.
    * *Responsibility:* UI Rendering, Optimistic UI updates, **Relative API paths**.
* **Data (`/data/dev.db`):** SQLite database. Persisted via Docker volume.
* **Docker:** Uses `node:25-slim` (Debian-based) for glibc compatibility with `better-sqlite3`.

### C. Testing Infrastructure
* **Backend:** Vitest for unit tests (`npm run test`)
* **Frontend:** Vitest + React Testing Library (`npm run test`)
* **E2E:** Playwright (optional)
* **CI/CD:** GitHub Actions runs tests on tags, releases, PRs, and manual dispatch.

## 3. Core Directives (The "Memory Bank")

### 🛑 Rule #1: "Trust No AI" (Absolute Verification)
* **Never** trust IDs provided by Gemini prompts. They are often hallucinations.
* **Always** verify titles against Jellyseerr API (`JellyseerrService.searchAndVerify`) before accepting them.
* **Flow:** Gemini Suggests Title -> Backend Searches Jellyseerr -> Backend Matches Title & Year -> Backend saves trusted TMDB ID.

### 🛑 Rule #2: Data Normalization & Persistence
* **Single Source of Truth:** All media data entering the DB MUST be normalized via `JellyseerrService.normalize()`.
* **Rich Data:** We persist `overview`, `voteAverage`, and `backdropUrl` in SQLite to avoid re-fetching.
* **Action Handling:** The Frontend MUST send the full payload (including `tmdbId`, `mediaType`, `releaseYear`) to the Backend.

### 🛑 Rule #3: Layered Configuration (DB + Env)
* **Source:** Settings are stored in SQLite (`SystemConfig`), but can be overridden/pre-filled by `.env`.
* **Setup Wizard:** If config is missing, the UI must prompt the user.
* **Dynamic Loading:** Services (`Gemini`, `Jellyseerr`) must fetch config at **runtime**, not static startup time.

### 🛑 Rule #4: Backward Compatibility (Backups)
* **JSON Contract:** The Export/Import JSON structure (`{ movies: [], watchlist: ... }`) corresponds to the Legacy format.
* **Schema Changes:** If `schema.prisma` changes, `ImportService` MUST be updated to map old JSON keys to new schema fields. **Never break the ability to restore old backups.**

### 🛑 Rule #5: Docker & Networking
* **Relative Paths:** Frontend API calls MUST use relative paths (`/api/...`) to support reverse proxies (Nginx/ZimaOS). **Never hardcode localhost.**
* **Self-Healing:** The backend `start.sh` script is responsible for running `prisma db push` and backups on boot.
* **Base Image:** Use `node:25-slim` (Debian), NOT Alpine. `better-sqlite3` requires glibc.

## 4. Developer Workflow & Commands

| Action | Command | Notes |
| :--- | :--- | :--- |
| **Start All** | `npm run dev` | Runs backend & frontend concurrently. |
| **DB Generate** | `npm run db:generate` | Generates Prisma client (required after schema changes). |
| **DB Push** | `npm run db:push` | Syncs schema to database. |
| **DB Studio** | `npm run db:studio` | View data GUI. |
| **Run Tests** | `npm test` | Runs backend & frontend tests. |
| **Docker Dev** | `docker compose -f docker-compose.development.yml up -d --build` | Local build with hot reload. |
| **Docker Prod** | `docker compose -f docker-compose.prod.yml up -d` | Uses GHCR images (No build required). |

## 5. Release Process (Creating New Version)

When creating a new version, update the following files:

| File | What to Update |
| :--- | :--- |
| `package.json` (root) | `"version": "X.Y.Z"` |
| `backend/package.json` | `"version": "X.Y.Z"` |
| `frontend/package.json` | `"version": "X.Y.Z"` |
| `backend/package-lock.json` | Run `npm install` in backend to update |
| `frontend/package-lock.json` | Run `npm install` in frontend to update |
| `README.md` | Version badge/references if present |
| `CHANGELOG.md` | Add new version section at top with changes |

**Release Commands:**
```bash
# 1. Update version in package.json files
sed -i 's/"version": "OLD"/"version": "NEW"/g' package.json backend/package.json frontend/package.json

# 2. Update lock files
cd backend && npm install && cd ../frontend && npm install && cd ..

# 3. Commit and tag
git add -A
git commit -m "chore: release vX.Y.Z"
git push
git tag vX.Y.Z
git push origin vX.Y.Z
```

**Note:** Creating a tag matching `v*` triggers GitHub Actions to build and push Docker images to GHCR.

## 6. Feature Implementation Guidelines

### When modifying the Backend:
1.  **Check `api.ts`:** Ensure response mapping uses `toFrontendItem`.
2.  **Check `jellyseerr.ts`:** Ensure strict encoding (`encodeURIComponent`) for queries.
3.  **Check `data.ts`:** Ensure `updateMediaStatus` handles nested payloads robustly ("Smart Unwrap").
4.  **Check `src/db.ts`:** All database access should import `prisma` from here (centralized client).

### When modifying the Frontend:
1.  **Check `api.ts`:** Ensure `BASE_URL` is empty (`''`) to force relative paths.
2.  **Check `MediaCard.tsx`:** Ensure actions pass the FULL payload to prevent data loss.
3.  **Styles:** Use Tailwind classes (v3). Do not upgrade to v4 alpha.

## 7. Implementation Status

* ✅ **Core:** Migration from Python -> Node.js complete.
* ✅ **Database:** JSON -> SQLite + Prisma 7 (with driver adapter) complete.
* ✅ **Safety:** "Trust No AI" pipeline & Strict ID verification active.
* ✅ **Features:**
    * Setup Wizard & Config Editor.
    * Legacy Import & Universal JSON Export.
    * Jellyfin History Sync (ID-based).
    * Dynamic Taste Profile.
* ✅ **Infrastructure:** Self-healing Docker container & ZimaOS support.
* ✅ **Testing:** Vitest (Backend & Frontend), Playwright (E2E), GitHub Actions CI.

## 8. Troubleshooting Common Issues

* **"tmdbId is required":** Check `data.ts` Smart Unwrap logic vs Frontend payload.
* **"Network Error / CORS":** Frontend is likely trying to hit `localhost` instead of relative `/api`. Check `frontend/src/services/api.ts`.
* **"Jellyseerr 404":** Endpoint must be singular `/api/v1/request`.
* **"Table not found":** Run `npm run db:push` locally or restart container (triggers `start.sh`).
* **"ld-linux-x86-64.so.2 not found":** Docker using Alpine. Switch to `node:25-slim` (Debian).
* **"Cannot find module prisma/client":** Run `npm run db:generate` to regenerate Prisma client.