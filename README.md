# 🎬 Jellyfin AI Recommender (v2.0)

A modern, AI-powered recommendation engine for your Jellyfin media server.
**Built with React (Vite), Node.js, TypeScript, and SQLite.**

![Screenshot](images/Screenshot.png)

## ✨ Features

- 🤖 **AI-Powered Discovery** — Uses **Google Gemini 2.5** to analyze your taste and find hidden gems you haven't seen yet.
- ✅ **"Trust No AI" Verification** — Every suggestion is strictly verified against Jellyseerr/TMDB to ensure valid metadata and functional links.
- 🧠 **Dynamic Taste Profile** — The system learns your preferences from your watch history and builds a text-based taste profile to guide the AI.
- 🚫 **Smart Filtering** — Automatically hides content you already own, have watched, or explicitly blocked.
- 📋 **Watchlist Management** — Organize your "To Watch" list with filtering (Movies vs. TV) and sorting.
- 🔗 **Jellyseerr Integration** — Request recommended media directly with one click (Optimistic UI).
- 💾 **Data Persistence** — Uses a local **SQLite** database (via Prisma) to store your history, ratings, and metadata safely.
- ⚙️ **UI Configuration** — Edit API keys and URLs directly in the browser via the Settings page.
- 🔄 **Legacy Import** — Non-destructive import tool to migrate data from the old v1 `database.json`.

## 🏗️ Architecture

This project is a full-stack monorepo split into a separate Frontend and Backend.

- **Frontend (`/frontend`)**: React + Vite + Tailwind CSS. Handles the UI, state management, and optimistic updates.
- **Backend (`/backend`)**: Node.js + Express + TypeScript. Handles API proxies, AI logic, database operations (Prisma), and Jellyseerr integration.
- **Database**: SQLite (`dev.db`) for user history and media metadata.

## 🚀 Quick Start

### 1. Prerequisites

- **Node.js** (v18+) & npm
- **Jellyfin Server** (accessible URL)
- **Jellyseerr Server** (for metadata enrichment & requests)
- **Google Gemini API Key** (for recommendations)

### 2. Installation

Clone the repo and install dependencies for both services:

```bash
git clone [https://github.com/jessepesse/jellyfin-ai-recommender.git](https://github.com/jessepesse/jellyfin-ai-recommender.git)
cd jellyfin-ai-recommender

# Install root tools (concurrently) and project dependencies
npm install
npm run install:all

### 3. Configuration (Two Options)

**Option A: Setup Wizard (Recommended)** Just start the app! You will be greeted by a Setup Wizard in the browser to enter your URLs and Keys. They will be saved to the local database.

**Option B: Environment Variables (Advanced)** Copy `backend/.env.example` to `backend/.env` and fill in your values:

cp backend/.env.example backend/.env
# Then edit backend/.env with your actual values

4. Database Setup

Initialize the SQLite database and apply the schema:

cd backend
npm run db:migrate
# This uses dotenv-cli to load your .env (if present) and run prisma migrate


5. Run the App (Development)

Start both the Frontend and Backend with a single command from the root directory:

npm run dev

Frontend (UI): http://localhost:5173
Backend (API): http://localhost:3001


🐳 Production (Docker)

This repo includes a production-ready `docker-compose.prod.yml`. It sets up the Node.js backend and serves the frontend via Nginx.

```bash
# Build and start containers
docker-compose -f docker-compose.prod.yml up -d --build
```

**Access:** The app is available at `http://localhost:5173` (frontend) and the backend API at `http://localhost:3001`.

    Persisted Data: The SQLite database is stored in a ./data folder in the project root.

📝 Usage Guide

    Login: Use your Jellyfin credentials. The app authenticates against your server.

    Get Recommendations:

        Select Movie or TV Series.

        Optionally select a Genre.

        Click "Get Recommendations". The AI will analyze your history and suggest 10 new items.

    Actions:

        👁️ Mark as Watched: Adds to your history.

        🔖 Add to Watchlist: Saves to your personal list.

        🚫 Block: Removes the item and signals the AI to avoid similar content.

        📥 Request: Sends a download request to Jellyseerr.

    Settings:

        System Config: Update your API keys/URLs at any time.

        Import: Paste your old database.json to migrate legacy data.

        Export: Download a backup of your current database.

📄 License

This project is licensed under the GNU Affero General Public License v3.0 (AGPLv3).

    ✅ Personal & Commercial use allowed

    ⚠️ Modifications must be open-sourced if distributed/hosted for others.

    See LICENSE for details.

---
Made with ❤️ for Jellyfin enthusiasts.