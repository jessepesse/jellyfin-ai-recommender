# 🎬 Jellyfin AI Recommender (React + Node.js Version)

A web application for getting movie and TV show recommendations from your Jellyfin library, rebuilt with a modern web stack.

## ✨ Features

- **Jellyfin Integration** — Connects to your Jellyfin server to browse your libraries.
- **Similarity-Based Recommendations** — Select an item to get recommendations based on genre and community rating similarity.
- **Modern UI** — A clean and responsive user interface built with React and Tailwind CSS.
- **Search** — Quickly find movies and series across your libraries.

## 🏗️ Architecture

This project is a full-stack monorepo with a separate frontend and backend.

- **`frontend/`**: A [Vite](https://vitejs.dev/)-powered [React](https://react.dev/) application written in [TypeScript](https://www.typescriptlang.org/). It provides the user interface for interacting with the application.
- **`backend/`**: A [Node.js](https://nodejs.org/) server using [Express](https://expressjs.com/) and [TypeScript]. It acts as a secure proxy to the Jellyfin API and contains the recommendation logic.

## ⚙️ Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS
- **Backend:** Node.js, Express, TypeScript
- **API Communication:** Axios

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/en/download/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/get-npm)

### Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/jessepesse/jellyfin-ai-recommender.git
    cd jellyfin-ai-recommender
    ```

2.  **Set up the Backend:**
    ```bash
    # Navigate to the backend directory
    cd backend

    # Install dependencies
    npm install

    # Create an environment file from the example
    # On Windows (Command Prompt): copy .env.example .env
    # On Windows (PowerShell): cp .env.example .env
    # On Linux/macOS: cp .env.example .env
    
    # Edit the .env file with your Jellyfin server details
    # JELLYFIN_URL=http://your-jellyfin-ip:8096
    # JELLYFIN_API_KEY=your_jellyfin_api_key
    # USER_ID=your_jellyfin_user_id

    # Start the backend server
    npm run dev
    ```
    The backend will be running on `http://localhost:3001`.

3.  **Set up the Frontend:**
    (In a new terminal)
    ```bash
    # Navigate to the frontend directory
    cd frontend

    # Install dependencies
    npm install

    # Start the frontend development server
    npm run dev
    ```
    The frontend will be accessible at the URL provided by Vite (usually `http://localhost:5173` or a similar port).

## 📄 License

This project is licensed under the **GNU Affero General Public License v3.0** (AGPLv3).

### What this means:
- ✅ **Commercial use is allowed** — You can use this for business purposes
- ✅ **Modification is allowed** — You can modify the code for your needs
- ✅ **Distribution is allowed** — You can distribute modified versions
- ✅ **Network use triggers sharing** — If you run this as a web service, you must provide source code to users
- ⚠️ **Source code must be shared** — Any distributed version must include source code
- ⚠️ **Same license applies** — Modifications must also be licensed under AGPLv3

For full details, see the [LICENSE](LICENSE) file.
