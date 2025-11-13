# Jellyfin AI Recommender: AI Coding Agent Guidelines

## Project Overview
Jellyfin AI Recommender is a web application that provides personalized movie and TV show recommendations based on Jellyfin watch history, enhanced by Google Gemini AI. It integrates seamlessly with Jellyseerr for requesting media and allows manual tracking of watched content.

### Key Features:
- **Personalized Recommendations**: Uses Google Gemini AI to analyze viewing habits.
- **Jellyfin Integration**: Reads watch history directly from Jellyfin.
- **Jellyseerr Integration**: Allows requesting recommended media with one click.
- **Manual Tracking**: Users can add movies/series watched outside Jellyfin.
- **Feedback Mechanism**: Mark recommendations as watched or "do not recommend."
- **Watchlist Management**: Save recommendations to personal watchlist.
- **Database Backup/Restore**: Export and import user data as JSON.

---

## Codebase Architecture

### Major Components:
1. **`app.py`**: The main application logic, including:
   - User authentication and session management.
   - Fetching and displaying recommendations.
   - Handling user interactions (e.g., marking watched, blocking recommendations).
   - Watchlist and blacklist management.
   - Backup and restore functionality.
2. **`database.json`**: Stores user-specific data:
   - Manually tracked movies and series
   - "Do not recommend" lists
   - Watchlist items
   - Jellyfin sync metadata
3. **`docker-compose.yml`**: Defines the Docker setup for running the application.
4. **`requirements.txt`**: Lists Python dependencies, including `streamlit` for the web interface.

### Data Flow:
- **Input**: Jellyfin watch history, manual entries, user preferences, and watchlist.
- **Processing**: Google Gemini AI generates recommendations based on input data, filtered against watched and blacklisted content.
- **Output**: Recommendations displayed in the web interface, with options for user feedback, Jellyseerr requests, and watchlist management.

---

## Developer Workflows

### Running the Application:
1. Ensure Docker and Docker Compose are installed.
2. Configure `docker-compose.yml` with the required environment variables:
   - `JELLYFIN_URL`, `JELLYSEERR_URL`, `JELLYSEERR_API_KEY`, `GEMINI_API_KEY`.
3. Start the application:
   ```bash
   docker-compose up -d
   ```
4. Access the app at `http://<server-ip>:8501`.

### Local Development:
1. Create virtual environment: `python -m venv venv`
2. Activate: `source venv/bin/activate` (or `venv\Scripts\activate` on Windows)
3. Install dependencies: `pip install -r requirements.txt`
4. Set up `.env` file with credentials
5. Run: `streamlit run app.py`

### Debugging:
- Use `streamlit`'s built-in debugging tools to inspect session state and logs.
- Check `database.json` for user-specific data issues.
- Review `app.log` for application errors and warnings.

### Testing:
- No explicit test framework is defined. Use manual testing for now.
- Validate API integrations (Jellyfin, Jellyseerr, Google Gemini) with sample data.
- Test database operations with various user scenarios.

---

## Project-Specific Conventions

### Streamlit Patterns:
- **Session State**: Use `st.session_state` to manage user-specific data (e.g., `jellyfin_session`, `recommendations`, `media_type`).
- **UI Layout**: Use `st.columns` for aligning buttons and content. Avoid clutter by spacing elements with `st.markdown` and custom HTML.
- **Callbacks**: Use `on_click` callbacks for button actions to handle state updates cleanly.

### Recommendation Handling:
- **Watched Content**: Stored in `database.json` under `movies` or `series`.
- **Do Not Recommend**: Maintained as a simple list in `do_not_recommend` field.
- **Watchlist**: Structured as `{"movies": [], "series": []}` for organized tracking.
- **Filtering**: Always filter recommendations against "watched" and "do not recommend" lists before displaying.
- **Jellyseerr Search**: Cache media IDs for 6 hours using `@st.cache_data(ttl=6*60*60)`.

### Database Schema (database.json):
```json
{
  "username": {
    "movies": ["Movie A", "Movie B"],
    "series": ["Series A"],
    "do_not_recommend": ["Blocked Movie", "Blocked Series"],
    "watchlist": {
      "movies": ["Queued Movie"],
      "series": ["Queued Series"]
    },
    "jellyfin_synced_at": "2024-01-15 10:30:00",
    "jellyfin_total_watched": 150
  }
}
```

### API Integrations:
- **Jellyfin**: Fetch watch history using the user's session. Use `X-Emby-Token` header for authenticated requests.
- **Jellyseerr**: Handle media requests via `/api/v1/request` endpoint. Use `X-Api-Key` header.
- **Google Gemini**: Generate recommendations using `gemini-2.5-flash` model. Prompt should return valid JSON only.

### Code Documentation and Comments:
- **Language**: All code comments must be written in **English** for international developer accessibility and maintainability
- **Rationale**: English comments ensure clarity for future contributors, open-source collaboration, and professional standards
- **UI Text**: User-facing UI text remains in Finnish (application creator's language and primary user base)
- **Examples**: 
  - ✅ Good: `# Enrich recommendations with poster images and metadata from Jellyseerr`
  - ❌ Avoid: `# Rikasta suosituksia julistekuvilla ja metadatalla Jellyserrista`
- **Exception**: Documentation files (README, SETUP, etc.) can be in Finnish if targeting Finnish-speaking users, but English versions are preferred for broader accessibility

---

## Key Files and Examples

### `app.py` - Main Functions:
- `jellyfin_login()` — Authenticates user with Jellyfin
- `get_jellyfin_watched_titles()` — Fetches watched content and syncs to database
- `build_prompt()` — Constructs AI prompt with watch history, watchlist, and blacklist
- `get_gemini_recommendations()` — Calls Gemini API and parses JSON response
- `search_jellyseerr()` — Cached search function to find media IDs
- `handle_watched_add()` — Marks recommendation as watched
- `handle_watchlist_add()` / `handle_watchlist_remove()` — Manage watchlist
- `handle_blacklist_add()` — Add to "do not recommend" list
- `export_user_data_as_json()` / `import_user_data_from_json()` — Backup/restore

### Callback Patterns:
All button actions use `on_click` callbacks with `st.session_state` updates to trigger automatic reruns. This pattern is used consistently throughout the UI.

---

## Recent Updates (for AI Agent Awareness)
- ✅ Added watchlist management feature
- ✅ Added database backup/restore (JSON export/import)
- ✅ Added GitHub links to Jellyfin and Jellyseerr in README

---

## Versioning Guidelines

### Release Format
Follow semantic versioning with alpha designation: `vX.Y.Z-alpha`

### Release Documentation Template
Each release should include comprehensive release notes following this structure:

```markdown
## vX.Y.Z-alpha - Release Title
🎯 Overview
[1-2 sentence summary of release focus]

✨ What's New
[Key sections with emoji headers]
- Feature 1 with description
- Feature 2 with description
- Feature 3 with description

🐛 Bug Fixes
- Fixed issue 1
- Fixed issue 2
- Fixed issue 3

⚠️ Known Issues & Limitations
- Issue 1
- Issue 2
- Issue 3

📚 Documentation
- 📖 README.md - Feature overview
- 🚀 SETUP.md - Deployment instructions
- 🔗 API_INTEGRATION.md - Integration details
- 🗄️ DATABASE_SCHEMA.md - Database structure

🚀 Installation & Upgrade
[Installation instructions]

📊 Monitoring
[Log checking and debugging tips]

⚠️ Disclaimer: This is a pre-release version...

Tag: vX.Y.Z-alpha | Date: [Release Date] | Type: Pre-release (Alpha)
```

### Release Checklist
1. Update `CHANGELOG.md` with all changes (Added, Changed, Fixed sections)
2. Create annotated git tag: `git tag -a vX.Y.Z-alpha -m "Release message"`
3. Push tag and main branch: `git push origin main --tags`
4. Create comprehensive release notes on GitHub Releases page
5. Verify CI/CD pipeline passes (Python validation, Docker build)

### GitHub Tag Message Format
Include full changelog summary in tag message:
- Added: [Feature list]
- Changed: [Behavior/API changes]
- Fixed: [Bug fixes]

---

## Notes for AI Agents
- Focus on maintaining a clean and user-friendly UI using Streamlit best practices.
- Ensure all API calls handle errors gracefully with try-catch blocks and user-friendly error messages.
- Follow the existing patterns for session state management and data storage.
- When adding new features, ensure they integrate seamlessly with the current architecture.
- Always filter recommendations against watched and blacklisted content before display.
- Use callback functions with `on_click` for button interactions.
- Keep database operations atomic and validate JSON structure before saving.
- Test with multiple user scenarios to ensure data isolation and integrity.
- **Session State Safety**: Always use `.get()` method for session state access with appropriate defaults to prevent AttributeError
- **Logout Flow**: Include explicit `st.rerun()` after clearing session state to force UI refresh
- **Error Handling**: Use try-catch blocks for all external API calls with graceful fallbacks
- **Logging**: Log all errors to `app.log` with appropriate severity levels
- **Parallel Processing**: Use ThreadPoolExecutor for concurrent API calls to improve performance
- **UI Responsiveness**: Never block UI with long-running operations; use `st.spinner()` context for feedback

---

For any questions or clarifications, refer to the `README.md`, `SETUP.md`, or the project maintainer.