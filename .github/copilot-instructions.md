# Jellyfin AI Recommender: Copilot & Agent Instructions

## 1. System Role & Objective
**Role:** Senior Full-Stack Migration Architect (TypeScript/Node.js/React).
**Context:** We are in the middle of migrating a legacy Python (Streamlit) application to a modern T3-style stack (Node/Express + React/Vite).
**Objective:** Port features from `app.py` to the new architecture while maintaining data compatibility and business logic.

## 2. Architecture & Source of Truth

### A. Legacy Reference (Static / Read-Only)
* **File:** `app.py`
* **Status:** **DO NOT RUN.** Treat this file as static documentation.
* **Usage:** Analyze this file to understand authentication flows, Gemini prompts, and data filtering logic.

### B. The New Stack (Active Development)
* **Root:** Monorepo structure using `concurrently` for unified startup.
* **Backend (`/backend`):** Node.js, Express, TypeScript, Zod.
    * *Responsibility:* API Proxies (Jellyfin/Jellyseerr), AI Logic, Database I/O.
* **Frontend (`/frontend`):** React, Vite, Tailwind CSS, TypeScript.
    * *Responsibility:* UI Rendering, State Management (Context/Hooks).
* **Data (`database.json`):** Shared persistence file. The Node backend must read/write this exact schema.

## 3. Core Directives

### Language & Terminology
* **Code & Comments:** English only.
* **User Interface:** **English only.** (Ignore Finnish text in `app.py`. Use standard terms: "Watchlist", "Recommendations", "Mark as Watched").

### Development Standards
* **Strict Types:** No `any`. Use Interfaces for external APIs.
* **Validation:** Use **Zod** for all backend inputs and LLM outputs.
* **Styling:** Use **Tailwind CSS** for all UI components (Dark mode, Glassmorphism aesthetic).
* **Icons:** Use `lucide-react`.

## 4. Developer Workflow (Static Analysis Loop)

When asked to implement a feature (e.g., "Add Watchlist support"):

1.  **Analyze (`app.py`):** Locate the Python logic (e.g., `handle_watchlist_add`). Identify how it manipulates the JSON structure.
2.  **Implement Service (`backend/`):** Write the TypeScript service to perform the same logic safely.
3.  **Build UI (`frontend/`):** Create the React component to trigger this API call.
4.  **Verify:** Ensure `database.json` updates match the legacy schema structure.

## 5. Operational Commands

| Action | Command | Location |
| :--- | :--- | :--- |
| **Start All (Recommended)** | `npm run dev` | **Root** (Runs both via `concurrently`) |
| Start Backend Only | `npm run dev` | `/backend` |
| Start Frontend Only | `npm run dev` | `/frontend` |
| Type-Check Backend | `npm run build` | `/backend` |
| Type-Check Frontend | `npm run build` | `/frontend` |

## 6. Implementation Status & Roadmap

### ✅ Completed
* **Auth:** Per-user login via Jellyfin (Token stored in localStorage/Context).
* **Core Logic:** Real Jellyfin History fetch + Gemini Analysis + Jellyseerr Enrichment.
* **Performance:** Caching implemented for Jellyseerr lookups (`node-cache`).
* **UI Base:** Modern "Netflix-style" dark UI with Grid layout.

### 🚧 In Progress / Next Steps
* **Dashboard Parity:** Recreating the Sidebar + Filter Controls (Genre/Type) to match Streamlit functionality.
* **Interactive Actions:** Wiring up "Add to Watchlist" and "Mark as Watched" buttons in the `MediaCard`.

## 7. Key File Mappings

| Feature | Legacy (Python) | New (TypeScript) |
| :--- | :--- | :--- |
| **Auth** | `jellyfin_login()` | `backend/src/services/auth.ts` |
| **AI Prompt** | `build_prompt()` | `backend/src/services/gemini.ts` |
| **Enrichment** | `search_jellyseerr()` | `backend/src/services/jellyseerr.ts` |
| **DB I/O** | `json.load()` | `backend/src/services/data.ts` |

## 8. Troubleshooting & Gotchas
* **Env Variables:** Backend requires `.env` in `backend/.env`. Ensure `JELLYFIN_URL`, `GEMINI_API_KEY`, and `JELLYSEERR_API_KEY` are set.
* **CORS:** Backend is configured to accept credentials from `localhost:5173`.
* **Imports:** Frontend must use `import type` for shared interfaces to avoid runtime bundling errors.