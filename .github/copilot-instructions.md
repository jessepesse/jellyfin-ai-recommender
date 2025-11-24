# Jellyfin AI Recommender: Copilot & Agent Instructions

## 1. System Role & Objective
**Role:** Senior Full-Stack Engineer (TypeScript/Node.js/React/Prisma).
**Context:** The project has successfully migrated from Python (Streamlit) to a modern T3-style stack. We are now in the **Optimization & Feature Hardening** phase.
**Objective:** Maintain the application, ensure data integrity via strict verification, and optimize the AI recommendation pipeline.

## 2. Architecture & Source of Truth

### A. Legacy Reference (Logic Only)
* **File:** `app.py`
* **Status:** **READ-ONLY / DEPRECATED.**
* **Usage:** Refer to this ONLY for understanding the original business logic (e.g., "how did the prompt look?"). **Do not** use it for data structure references anymore.

### B. The Modern Stack (Active)
* **Root:** Monorepo using `concurrently`.
* **Backend (`/backend`):** Node.js, Express, **Prisma (SQLite)**, Zod, Google AI SDK.
    * *Responsibility:* API Proxies, strict data verification, database management, AI orchestration.
* **Frontend (`/frontend`):** React, Vite, Tailwind CSS (v3.4), TypeScript.
    * *Responsibility:* UI Rendering, Optimistic UI updates, Client-side filtering/sorting.
* **Data (`backend/prisma/dev.db`):** SQLite database managed via Prisma. **`database.json` is obsolete and should be ignored.**

## 3. Core Directives

### "Trust No AI" Philosophy (CRITICAL)
1.  **No ID Hallucinations:** Never trust TMDB IDs provided by Gemini. They are often hallucinated.
2.  **Strict Verification:** All AI suggestions must be verified against Jellyseerr (Title + Year match) before being returned to the Frontend.
3.  **Normalization:** All data entering the DB or Frontend must be normalized via `JellyseerrService.normalize()` to ensure consistent fields (`tmdbId`, `mediaType`, `releaseYear`).

### Development Standards
* **Database:** Use **Prisma ORM** for all data operations. Never write to files directly.
* **Styling:** Use **Tailwind CSS** utility classes. Ensure config matches v3 standards.
* **Validation:** Use **Zod** for API inputs/outputs.
* **Language:** Code & Comments in **English**. UI Text in **English**.

## 4. Developer Workflow

When implementing features or fixing bugs:

1.  **Check Logic:** Does this feature exist in `app.py`? If so, replicate the *intent*, not the code.
2.  **Database Schema:** If data needs to change, update `backend/prisma/schema.prisma` and run `npm run db:migrate`.
3.  **Backend Service:** Implement logic in `services/`, ensuring strict type safety and normalization.
4.  **Frontend:** Update UI components to match the backend's strict data contract (`JellyfinItem` interface).

## 5. Operational Commands

### General
* **Start All (Dev):** `npm run dev` (Runs backend & frontend via concurrently)

### Backend
* **Start Backend:** `cd backend && npm run dev`
* **Prisma Migrate:** `npm run db:migrate` (Use this instead of npx to ensure .env loading via dotenv-cli)
* **Prisma Generate:** `npm run db:generate` (Refresh TypeScript types)
* **Prisma Studio:** `npm run db:studio` (GUI to view database data)

### Frontend
* **Start Frontend:** `cd frontend && npm run dev`
* **Build:** `cd frontend && npm run build`

## 6. Implementation Status

### ✅ Completed & Stable
* **Auth:** User-centric authentication (Jellyfin Token passed from Frontend to Backend).
* **Database:** SQLite + Prisma integration (User, Media, UserMedia tables).
* **Core Logic:**
    * **Gemini:** Context-aware prompts with "Taste Profile".
    * **Verification:** Strict "Title + Year" matching against Jellyseerr.
    * **Loop:** Backend loops until 10 valid, non-duplicate items are found.
* **UI:** Modern Dark Mode Dashboard, Sidebar, Watchlist, Search.
* **Actions:** Watched, Watchlist, Block, Request (all with Optimistic UI updates).

### 🧩 Key Logic Patterns
* **Taste Profile:** `TasteService` analyzes history to generate a text profile for Gemini to improve recommendations.
* **External Discovery:** The logic is tuned to find *new* content, strictly filtering out existing library items using `JellyfinService.getOwnedIds`.
* **JIT Lookup:** DataService attempts to fetch missing IDs via Jellyseerr before saving if the Frontend payload is incomplete.

## 7. Key File Mappings

| Logic | File Location |
| :--- | :--- |
| **AI Prompting** | `backend/src/services/gemini.ts` |
| **Data/Prisma** | `backend/src/services/data.ts` |
| **External API** | `backend/src/services/jellyseerr.ts` |
| **Auth Logic** | `backend/src/services/jellyfin.ts` |
| **Taste Analysis**| `backend/src/services/taste.ts` |
| **API Routes** | `backend/src/routes/api.ts` |

## 8. Troubleshooting Cheat Sheet
* **Frontend Style Missing:** Check `frontend/postcss.config.js`. It must use CJS format compatible with Tailwind v3.
* **Database Error:** "tmdbId is required" -> Check `jellyseerr.ts` normalization logic and Frontend `MediaCard` payload.
* **Prisma Error:** "Missing DATABASE_URL" -> Always use `npm run db:migrate` (it uses `dotenv-cli` to force load `.env`).
* **Jellyseerr 404:** Ensure the endpoint is `/api/v1/request` (singular, not plural) and the query is `encodeURIComponent`'d properly in `jellyseerr.ts`.