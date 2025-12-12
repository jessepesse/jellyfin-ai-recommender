# Jellyfin AI Recommender: Agent Context Guide

> This file provides context for AI coding assistants (Gemini, Claude, etc.) working on this codebase.

## 📦 Project Overview

**Jellyfin AI Recommender** is a self-hosted media recommendation system that uses Google Gemini AI to suggest movies and TV shows based on user's watch history and taste profile.

| Component | Technology | Purpose |
|-----------|------------|---------|
| Backend | Node.js, Express, TypeScript | API, database, AI orchestration |
| Frontend | React, Vite, TypeScript | User interface |
| Database | SQLite + Prisma 7 | Persistent storage |
| AI | Google Gemini API | Recommendation generation |
| External | Jellyfin, Jellyseerr | Media library + request management |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
│   /frontend/src/components, /frontend/src/services/api.ts   │
└────────────────────────────┬────────────────────────────────┘
                             │ Relative /api/* calls
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                     Backend (Express)                        │
│              /backend/src/routes, /backend/src/services      │
└────────────┬──────────────────────────────┬─────────────────┘
             │                              │
             ▼                              ▼
┌────────────────────┐          ┌────────────────────────────┐
│  SQLite (Prisma 7) │          │  External APIs             │
│  /data/dev.db      │          │  - Jellyfin (media library)│
│  /backend/src/db.ts│          │  - Jellyseerr (requests)   │
└────────────────────┘          │  - Gemini (AI)             │
                                └────────────────────────────┘
```

## 📁 Key Files

### Backend
| File | Purpose |
|------|---------|
| `src/db.ts` | **Centralized PrismaClient** - All DB access imports from here |
| `src/index.ts` | Express app entry point |
| `src/routes/*.ts` | API endpoints |
| `src/services/data.ts` | Core data operations (CRUD for media/users) |
| `src/services/jellyseerr.ts` | Jellyseerr API wrapper + verification |
| `src/services/gemini.ts` | Gemini AI integration |
| `src/services/taste.ts` | User taste profile generation |
| `prisma/schema.prisma` | Database schema |
| `prisma.config.ts` | Prisma 7 CLI configuration |
| `start.sh` | Docker entrypoint (db push, backups, startup) |

### Frontend
| File | Purpose |
|------|---------|
| `src/App.tsx` | Main app with routing/auth |
| `src/components/Dashboard.tsx` | Recommendations view |
| `src/components/WatchlistView.tsx` | User's watchlist |
| `src/components/SettingsView.tsx` | Config + import/export |
| `src/services/api.ts` | API client (uses relative paths!) |

### Config
| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | Production (GHCR images) |
| `docker-compose.development.yml` | Development (local build) |
| `backend/Dockerfile` | Prod Docker (node:25-slim) |
| `backend/Dockerfile.dev` | Dev Docker with hot reload |

## 🔑 Critical Rules

### 1. Prisma 7 Driver Adapter
```typescript
// CORRECT: Import from centralized db.ts
import { prisma } from '../db';

// WRONG: Never create new PrismaClient directly
import { PrismaClient } from '../generated/prisma/client';
const prisma = new PrismaClient(); // ❌
```

### 2. Relative API Paths (Frontend)
```typescript
// CORRECT: Empty base URL = relative paths
const BASE_URL = '';
axios.get('/api/health'); // ✅

// WRONG: Hardcoded localhost breaks Docker/reverse proxy
axios.get('http://localhost:3001/api/health'); // ❌
```

### 3. Trust No AI (Verification)
```typescript
// Gemini suggestions are NEVER trusted directly
// Always verify against Jellyseerr first
const verified = await jellyseerr.searchAndVerify(title, year, type);
if (!verified) throw new Error('AI hallucination detected');
```

### 4. Docker Base Image
```dockerfile
# CORRECT: Debian-based for glibc (required by better-sqlite3)
FROM node:25-slim

# WRONG: Alpine uses musl-libc, breaks better-sqlite3
FROM node:25-alpine  # ❌
```

## 📊 Database Schema (Key Tables)

| Table | Purpose |
|-------|---------|
| `User` | Jellyfin users (username, taste profiles) |
| `Media` | Movies/shows (tmdbId, title, posterUrl, etc.) |
| `UserMedia` | User-media relations (status: watched/watchlist/blocked) |
| `SystemConfig` | App settings (API keys, URLs) |

## 🧪 Testing

```bash
# Run all tests
npm test

# Backend only
cd backend && npm test

# Frontend only  
cd frontend && npm test
```

## 🚀 Common Tasks

### Creating a New API Endpoint
1. Add route in `backend/src/routes/*.ts`
2. Register in `backend/src/index.ts`
3. Add types in `shared/types.ts` if needed
4. Add frontend API call in `frontend/src/services/api.ts`

### Modifying Database Schema
1. Edit `backend/prisma/schema.prisma`
2. Run `npm run db:push` (development)
3. Run `npm run db:generate` (regenerate client)
4. Update import service if schema affects backups

### Creating New Version
1. Update version in `package.json` (root, backend, frontend)
2. Run `npm install` in backend and frontend (updates lock files)
3. Update `CHANGELOG.md`
4. Commit and push
5. Create and push tag: `git tag vX.Y.Z && git push origin vX.Y.Z`

## ⚠️ Common Pitfalls

| Problem | Cause | Solution |
|---------|-------|----------|
| "Cannot find module prisma" | Missing generated client | `npm run db:generate` |
| "ld-linux-x86-64.so.2 not found" | Alpine Docker image | Use `node:25-slim` |
| Buttons not clickable | CSS pointer-events issue | Check App.tsx sidebar state |
| CORS errors | Hardcoded localhost in frontend | Use relative API paths |
| 500 on save config | Database connection issue | Check Prisma adapter setup |

## 🔗 External Integrations

| Service | Used For | Config Key |
|---------|----------|------------|
| Jellyfin | Watch history sync | `JELLYFIN_URL` |
| Jellyseerr | Search, request media, verify AI | `JELLYSEERR_URL`, `JELLYSEERR_API_KEY` |
| Google Gemini | AI recommendations | `GEMINI_API_KEY`, `GEMINI_MODEL` |
