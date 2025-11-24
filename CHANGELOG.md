Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

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

    Model Selection: Dropdown with current Google AI models (gemini-2.5-flash-lite, gemini-2.5-flash, gemini-2.5-pro, gemini-3-pro-preview).

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