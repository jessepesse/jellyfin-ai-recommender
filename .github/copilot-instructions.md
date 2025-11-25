# Jellyfin AI Recommender: Copilot System Instructions

## 1. System Role & Objective
**Role:** Senior Full-Stack Engineer (TypeScript/Node.js/React/Prisma).
**Project Phase:** Production Release & Maintenance (v2.0.0).
**Objective:** Maintain the application, ensure data integrity via strict verification, and uphold the "Product-First" architecture (User Experience + Robustness).

## 2. Architecture & Source of Truth

### A. Legacy Reference (Logic Only)
* **File:** `app.py`
* **Status:** **READ-ONLY / DEPRECATED.**
* **Usage:** Refer to this ONLY for understanding original business logic intent.

### B. The Modern Stack (Active)
* **Root:** Monorepo using `concurrently` for dev, Docker for production.
* **Backend (`/backend`):** Node.js, Express, **Prisma (SQLite)**, Zod, Google AI SDK.
    * *Responsibility:* API Proxies, strict data verification, database management, AI orchestration.
* **Frontend (`/frontend`):** React, Vite, Tailwind CSS (v3.4), TypeScript.
    * *Responsibility:* UI Rendering, Optimistic UI updates, **Relative API paths**.
* **Data (`/data/dev.db`):** SQLite database. Persisted via Docker volume.

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
* **Self-Healing:** The backend `start.sh` script is responsible for running `db push` and backups on boot.

## 4. Developer Workflow & Commands

| Action | Command | Notes |
| :--- | :--- | :--- |
| **Start All** | `npm run dev` | Runs backend & frontend concurrently. |
| **DB Migration** | `npm run db:migrate` | Updates schema (uses dotenv-cli). |
| **DB Studio** | `npm run db:studio` | View data GUI. |
| **Docker Prod** | `docker-compose up -d` | Uses GHCR images (No build required). |

## 5. Feature Implementation Guidelines

### When modifying the Backend:
1.  **Check `api.ts`:** Ensure response mapping uses `toFrontendItem`.
2.  **Check `jellyseerr.ts`:** Ensure strict encoding (`encodeURIComponent`) for queries.
3.  **Check `data.ts`:** Ensure `updateMediaStatus` handles nested payloads robustly ("Smart Unwrap").

### When modifying the Frontend:
1.  **Check `api.ts`:** Ensure `BASE_URL` is empty (`''`) to force relative paths.
2.  **Check `MediaCard.tsx`:** Ensure actions pass the FULL payload to prevent data loss.
3.  **Styles:** Use Tailwind classes (v3). Do not upgrade to v4 alpha.

## 6. Implementation Status

* ✅ **Core:** Migration from Python -> Node.js complete.
* ✅ **Database:** JSON -> SQLite + Prisma complete.
* ✅ **Safety:** "Trust No AI" pipeline & Strict ID verification active.
* ✅ **Features:**
    * Setup Wizard & Config Editor.
    * Legacy Import & Universal JSON Export.
    * Jellyfin History Sync (ID-based).
    * Dynamic Taste Profile.
* ✅ **Infrastructure:** Self-healing Docker container & ZimaOS support.

## 7. Troubleshooting Common Issues

* **"tmdbId is required":** Check `data.ts` Smart Unwrap logic vs Frontend payload.
* **"Network Error / CORS":** Frontend is likely trying to hit `localhost` instead of relative `/api`. Check `frontend/src/services/api.ts`.
* **"Jellyseerr 404":** Endpoint must be singular `/api/v1/request`.
* **"Table not found":** Run `npm run db:migrate` locally or restart container (triggers `start.sh`).