Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

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

🐛 Bug Fixes

    Recommendation Logic: Fixed issue where watched movies appeared in recommendations by enforcing TMDB ID extraction from Jellyfin.

    Data Integrity: Fixed "Ghost Cards" by enforcing strict ID validation in the backend.

    Metadata: Fixed bug where TV shows were saved without titles/years due to API field mismatches.

    Styling: Fixed PostCSS/Tailwind configuration issues (downgraded to stable v3.4 for compatibility).

    Docker: Adjusted Dockerfiles to map frontend port to 3000 and ensure Prisma generation during build.

    Authentication: Fixed logic to prioritize User Session Tokens over global API keys to prevent 401 errors.

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