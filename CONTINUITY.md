# Continuity Ledger

## 1. Global Project Context
* **Core Goal:** AI-powered recommendation engine for Jellyfin media server with personalized suggestions
* **Tech Stack:** 
  - Frontend: React 19 + Vite + Tailwind CSS v4 + TypeScript
  - Backend: Node.js + Express 5 + TypeScript + Prisma 7 + SQLite
  - AI: Google Gemini 2.5/3.0 (configurable)
  - External APIs: Jellyfin, Jellyseerr, TMDB
* **Global Constraints:**
  - Mobile-first responsive design
  - Strict TypeScript typing (no `any` unless documented)
  - Security: SSRF protection, rate limiting, helmet, no hardcoded secrets
  - Self-hosted focus (Docker deployment)
  - All secrets in `.env` or database, never committed
* **Completed Epics:**
  - ✅ Core recommendation engine with Gemini AI
  - ✅ Jellyfin authentication and sync
  - ✅ Jellyseerr integration for requests
  - ✅ Local image caching system
  - ✅ TMDB enrichment with genres/keywords
  - ✅ Anchor-based recommendations
  - ✅ Weekly Watchlist with dual-AI (Curator + Critic)
  - ✅ Mood-based filtering
  - ✅ Trending page with smart filtering
  - ✅ Admin-only Settings (Jellyfin Policy.IsAdministrator)

## 2. Active Epic: Mobile UX Improvements
* **Epic Goal:** Optimize mobile user experience across all views
* **Success Criteria:** 
  - Trending page shows one card per row on mobile
  - All pages are readable and usable on small screens
  - Touch targets are appropriately sized
* **Key Decisions (Local):**
  - Use Tailwind's responsive grid classes (grid-cols-1 for mobile)
  - Maintain consistent spacing across breakpoints

## 3. State (Current Epic)
* **Done:**
  - Fixed Trending page mobile layout (grid-cols-1 instead of grid-cols-2)
  - Updated all three grid sections (loading, movies, TV shows)
* **Now:**
  - Testing mobile layout on different screen sizes
* **Next:**
  - Check other pages for similar mobile layout issues
  - Verify touch target sizes across the app

## 4. Open Questions / Risks
* Trending page "User not found" error needs better UX (partially addressed with helpful message)
* Weekly Watchlist performance with large user bases (not yet tested at scale)

## 5. Working Set (Active files/IDs)
* `backend/src/routes/trending.ts` - Trending page backend
* `frontend/src/components/TrendingPage.tsx` - Trending page UI
* `backend/src/routes/weekly-watchlist.ts` - Weekly recommendations
* `frontend/src/components/WeeklyWatchlist.tsx` - Weekly UI
* `backend/src/routes/auth.ts` - Admin flag extraction
* `.agent/workflows/github-release.md` - Release checklist
