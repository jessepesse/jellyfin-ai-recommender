# Contributing to Jellyfin AI Recommender

Thank you for your interest in contributing! This document covers everything you need to get the project running locally, understand the codebase, and submit a pull request.

---

## Table of Contents

- [Ways to Contribute](#ways-to-contribute)
- [Before You Start](#before-you-start)
- [Local Development Setup](#local-development-setup)
- [Project Structure](#project-structure)
- [Running Tests](#running-tests)
- [Code Standards](#code-standards)
- [Commit Messages](#commit-messages)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Security Vulnerabilities](#reporting-security-vulnerabilities)

---

## Ways to Contribute

- **Bug reports** — Open a GitHub Issue with steps to reproduce
- **Feature requests** — Open an Issue describing the use case before writing code
- **Bug fixes** — Fork, fix, open a PR
- **New features** — Open an Issue first to discuss the approach; avoids duplicate or unwanted work
- **Documentation** — README improvements, inline comments, JSDoc
- **Tests** — Additional unit tests are always welcome

---

## Before You Start

- Search existing [Issues](../../issues) and [Pull Requests](../../pulls) to avoid duplicates
- For anything beyond a small bug fix, open an Issue first to align on the approach
- Security vulnerabilities must **not** be reported as public Issues — see [Reporting Security Vulnerabilities](#reporting-security-vulnerabilities)

---

## Local Development Setup

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20+ | 25 used in production Docker |
| npm | 10+ | Comes with Node.js |
| Git | any | |
| Jellyfin | any | Your existing server |
| Jellyseerr | any | Required for metadata enrichment |

### 1. Clone and install

```bash
git clone https://github.com/jessepesse/jellyfin-ai-recommender.git
cd jellyfin-ai-recommender

# Install root + workspace deps
npm install

cd backend && npm install
cd ../frontend && npm install
cd ..
```

### 2. Configure the backend

```bash
cp backend/.env.example backend/.env
# Edit backend/.env — set DATABASE_URL at minimum
```

Generate the Prisma client:

```bash
cd backend
npx prisma generate
npx prisma migrate dev   # creates the local SQLite database
cd ..
```

### 3. Start dev servers

```bash
# From repo root — starts frontend (Vite HMR) + backend (nodemon) concurrently
npm run dev
```

| Service | URL |
|---------|-----|
| Frontend (Vite HMR) | http://localhost:5173 |
| Backend API | http://localhost:3001 |

Open the app, complete the Setup Wizard, and you're running.

### Alternative: Docker dev environment (hot reload)

If you prefer containers:

```bash
docker compose -f docker-compose.development.yml up --build
```

Source directories are bind-mounted, so code changes reload automatically inside the containers.

---

## Project Structure

```
jellyfin-ai-recommender/
├── backend/               # Node.js + Express + Prisma API
│   ├── src/
│   │   ├── middleware/    # Auth, rate limiting, validation
│   │   ├── routes/        # Express route handlers
│   │   ├── services/      # Business logic (AI, sync, cache, config…)
│   │   └── utils/         # SSRF protection, logging, helpers
│   └── prisma/            # Schema and migrations (SQLite)
├── frontend/              # React + Vite + Tailwind CSS
│   └── src/
│       ├── components/    # UI components
│       ├── contexts/      # React context (Auth, Config)
│       └── hooks/         # Custom hooks
├── shared/                # Types shared between frontend and backend
├── .agent/workflows/      # Agent workflow checklists (release process)
└── .github/workflows/     # CI/CD (test, build, release)
```

### Key services (backend)

| File | Responsibility |
|------|---------------|
| `services/ai.ts` | Gemini / OpenRouter integration, taste profiling |
| `services/recommendations.ts` | Recommendation pipeline |
| `services/sync.ts` | Jellyfin watch history sync |
| `services/jellyseerr.ts` | Jellyseerr metadata enrichment + caching |
| `services/data.ts` | Prisma helpers, media upsert, image backfill |
| `services/cache.ts` | Unified in-memory cache with stampede prevention |
| `services/config.ts` | System configuration (DB-backed, env fallback) |
| `middleware/auth.ts` | JWT-style token validation (local + Jellyfin tokens) |
| `utils/ssrf-protection.ts` | URL sanitization — wrap all outbound HTTP calls |

---

## Running Tests

```bash
# Backend unit tests
cd backend && npm test

# Frontend unit tests
cd frontend && npm test

# Both (from root)
npm test
```

TypeScript must compile cleanly before a PR is accepted:

```bash
cd backend  && npx tsc --noEmit
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

---

## Code Standards

### TypeScript

- **Strict mode is on.** No `any` casts to work around type errors — fix the underlying type instead.
- `req.user` has a fixed shape (`id`, `username`, `isSystemAdmin`, `jellyfinUserId?`) — do not add ad-hoc properties.
- Prefer explicit return types on exported functions.

### Security

- **All outbound HTTP calls** must go through `sanitizeUrl()` / `validateSafeUrl()` from `utils/ssrf-protection.ts`.
- Never log access tokens, API keys, or user passwords — even at debug level.
- Never use raw user input in filenames, SQL, or shell commands without explicit sanitization.
- `Content-Disposition` headers that include user-controlled values must use `encodeURIComponent`.

### General

- No debug `console.log` left in committed code (`console.debug` is fine — it's filtered in production).
- Keep new dependencies minimal. Every new `npm install` is a permanent maintenance cost.
- Co-locate tests with the code they test (`*.test.ts` / `*.test.tsx`).

---

## Commit Messages

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>
```

| Type | When to use |
|------|-------------|
| `feat` | New user-facing feature |
| `fix` | Bug fix |
| `fix(security)` | Security patch |
| `chore` | Tooling, deps, version bumps |
| `refactor` | Code change with no behaviour change |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |

**Examples:**

```
feat(recommendations): add genre-based filtering to discovery pipeline
fix(sync): handle Jellyfin items with missing ProviderIds gracefully
fix(security): sanitize filename param in /api/images/:filename
chore: bump version to 2.5.0 and update changelog
```

Keep the subject line under 72 characters. Use the body for *why*, not *what*.

---

## Submitting a Pull Request

1. Fork the repository and create a branch from `main`:
   ```bash
   git checkout -b fix/my-bug-description
   ```

2. Make your changes. Add or update tests if the change touches business logic.

3. Verify everything passes locally:
   ```bash
   npm test
   cd backend  && npx tsc --noEmit
   cd frontend && npx tsc --noEmit -p tsconfig.app.json
   ```

4. Commit using Conventional Commits (see above).

5. Push and open a Pull Request against `main`. Fill in the PR description — what changed and why.

6. CI will run tests and TypeScript checks automatically. PRs with failing checks will not be merged.

The project maintainer reviews PRs as time allows. Smaller, focused PRs get reviewed faster than large multi-feature ones.

---

## Reporting Security Vulnerabilities

**Do not open a public GitHub Issue for security vulnerabilities.**

Please use [GitHub's private security advisory](../../security/advisories/new) feature. See [SECURITY.md](SECURITY.md) for the full policy and known false-positive CodeQL alerts.
