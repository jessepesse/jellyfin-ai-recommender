## Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

[2.0.0] - NOT RELEASED

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

        Added Optimistic UI updates: Cards disappear instantly upon action without waiting for server response.

        Added Rich Metadata: Media cards now display rating badges (⭐️ 7.8) and release years.

🧠 AI & Intelligence Upgrades

    "Trust No AI" Pipeline: Backend now strictly verifies every Gemini suggestion against Jellyseerr (Title + Year check) before displaying it. Prevents hallucinations and broken links.

    Dynamic Taste Profile: Implemented a background service that analyzes user watch history to generate a text-based "Taste Profile" for better context-aware recommendations.

    Semantic Filtering: Recommendation logic now understands "Positive" (Watchlist/History) vs "Negative" (Blocked) signals to avoid suggesting unwanted content.

    External Discovery Mode: Logic tuned to strictly exclude any content already present in the Jellyfin library to ensure new discoveries.

    Auto-Replenishment: Backend automatically loops requests to Gemini until 10 valid, non-duplicate items are found.

🛠️ Functional Improvements

    Robust Data Mapping: Standardized Media (Movie vs TV) handling across the entire stack (title/name, releaseDate/firstAirDate).

    Jellyseerr Integration:

        Fixed encoding issues with special characters (e.g., "Mission: Impossible").

        Enforced strict payloads (seasons: [] for TV) to fix 500 errors.

        Added caching (node-cache) for enrichment results to speed up repeated fetches.

        **NEW:** Direct metadata lookup via `/api/v1/movie/{id}` and `/api/v1/tv/{id}` endpoints for faster enrichment.

    Authentication: Implemented user-centric auth where the Jellyfin Session Token is passed securely from Frontend to Backend APIs.

    Legacy Data Import: Added a non-destructive Import Tool in Settings to migrate data from the old v1 database.json.

    **NEW: Jellyfin Watch History Sync:**

        Added `POST /api/sync/jellyfin` endpoint to bulk import watch history from Jellyfin.

        Extracts TMDB IDs from Jellyfin's `ProviderIds.Tmdb` field.

        Enriches items with Jellyseerr metadata before saving to database.

        Smart deduplication: Only syncs new items not already in database.

        Performance optimized: 100ms delay between items to avoid rate limiting.

    **NEW: Jellyfin Data Normalization:**

        Created `jellyfin-normalizer.ts` helper to extract TMDB IDs from Jellyfin's ProviderIds structure.

        Recommendations now use extracted TMDB IDs as primary exclusion source.

        Fixes issue where watched movies were appearing in recommendations.

    **NEW: System Configuration Editor (Settings Page):**

        Added `GET /api/system/config-editor` endpoint to fetch configuration with masked API keys.

        Added `PUT /api/system/config-editor` endpoint to update configuration securely.

        Created `ConfigEditor.tsx` component with glassmorphism styling.

        Users can now update Jellyfin URL, Jellyseerr URL/API Key, Gemini API Key, and Gemini Model directly from the UI.

        API keys are masked (e.g., `********1234`) to prevent exposure in browser network tabs.

        "Test Connections" button verifies all services before saving.

        Changes are persisted to the SystemConfig table in the database.

        Eliminates need for manual `.env` file editing or container rebuilds.

🐛 Fixes

    Fixed "Ghost Cards" by enforcing strict ID validation in the backend.

    Fixed "Missing Metadata" bugs where TV shows saved without titles/years.

    Fixed Styling issues by correctly configuring PostCSS/Tailwind v3.4.

    Fixed Database corruption risks by moving to atomic SQL transactions via Prisma.

    Fix(frontend): Resolved React Hook ordering error in `App.tsx` that caused runtime crashes.
    Fix(types): Corrected `ErrorBoundary` TypeScript import issues to allow successful builds.
    Fix(css): Converted PostCSS/Tailwind configs to CommonJS and corrected plugin keys so Tailwind utilities generate correctly.
    Fix(security): Removed noisy `console.log` calls that could leak sensitive tokens or PII during runtime.
    Fix(config): Added DB-backed `SystemConfig` and `SetupWizard` UI; services now prefer DB config with env fallback.
    Fix(backend): Runtime construction of Gemini/Jellyseerr clients, and safer Jellyfin base URL probing and persistence.
    Fix(docker): Adjusted backend Dockerfile and `docker-compose.prod.yml` to run `prisma generate` during build and map frontend host port to `3000`.
    **Fix(recommendations):** Watched items now properly excluded from recommendations by extracting TMDB IDs from Jellyfin's `ProviderIds.Tmdb` field.
    **Fix(types):** Enhanced `JellyfinItem` interface with `Type`, `ProductionYear`, `ProviderIds`, and `UserData` fields for complete metadata support.


🧪 Developer Experience

    **NEW: Testing Scripts:**

        `test_sync.js` - Interactive test for Jellyfin watch history sync with detailed statistics.

        `test_with_login.js` - Interactive test that prompts for credentials and shows watch history.

        `test_exclusions.js` - Verifies watched items are properly excluded from recommendations.

    **Cleanup:** Removed 18 obsolete development scripts (config management, redundant API tests, validation scripts).

    **Maintained:** Kept 6 essential scripts for database maintenance and feature testing.

Tag: v2.0.0 | Date: 2025-11-24 | Type: Major Release

[0.2.7-alpha] - 2025-11-21 (Legacy Python)

🎯 Overview

Small patch release addressing a migration UX issue and cleaning up ephemeral migration artifacts created during the TMDB ID backfill.

✨ What's New

    feat(migration): TMDB ID backfill migration UI and safety

    Dry-run mode and Apply mode for migrations.

    Safety features: persistent migration flag and rollback on error.

[0.2.6-alpha] - 2025-11-21 (Legacy Python)

🎯 Overview

Minor improvements to the Gemini integration and prompt engineering, plus infrastructure CI fixes.

✨ What's New

    feat: Switch Gemini model to gemini-2.5-flash-lite.

    feat(prompt): Rewrite prompts to English for better model compliance.

    ci: Fixed Docker Buildx issues and added automatic release workflows.

[0.2.5-alpha] - 2025-11-16 (Legacy Python)

🎯 Overview

Comprehensive TMDB ID and media_type storage for all media entries.

✨ What's New

    TMDB ID Storage: Extended database schema to store IDs for all lists.

    Jellyseerr Sync: Automatic syncing of available content.

    Rate Limiting: Added cooldowns to prevent API spam.

[0.2.4-alpha] - 2025-11-16 (Legacy Python)

🎯 Overview

Major UI/UX improvements focusing on navigation restructuring.

✨ What's New

    Sidebar Navigation: Replaced tabs with a proper sidebar.

    Visual Polish: Improved spacing, icons, and responsive layout.

[0.2.3-alpha] - 2025-11-13 (Legacy Python)

🎯 Overview

Added parallel processing for faster enrichment and fixed session state bugs.

✨ What's New

    Parallel Enrichment: Used ThreadPoolExecutor for API calls.

    Watched Button: Added "Mark as Watched" directly to watchlist items.

[0.2.2-alpha] - 2025-11-13 (Legacy Python)

🎯 Overview

Added manual search functionality via Jellyseerr integration.

✨ What's New

    Manual Search: Query Jellyseerr to add items to history/watchlist manually.

    Result Caching: Improved performance for repeated searches.

[0.2.1-alpha] - 2025-11-13 (Legacy Python)

🎯 Overview

Introduced the tabbed interface structure and basic statistics.

✨ What's New

    Tabs: Reorganized UI into logical sections.

    Statistics: Added counts for movies/series/blocked items.

[0.2.0-alpha] - 2025-11-12 (Legacy Python)

🎯 Overview

Added comprehensive error handling and logging infrastructure.

✨ What's New

    Logging: Centralized app.log with rotation.

    Retry Logic: Exponential backoff for API calls.

    Error UI: User-friendly error messages in Streamlit.

[0.1.0-alpha] (Legacy Python)

🎯 Overview

Initial alpha release with core features.

✨ Features

    Jellyfin Integration (History)

    AI Recommendations (Gemini)

    Jellyseerr Integration (Requests)

    JSON Database

    Streamlit UI