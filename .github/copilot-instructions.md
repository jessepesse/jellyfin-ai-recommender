# Jellyfin AI Recommender: AI Coding Agent Guidelines

## Project Overview
Jellyfin AI Recommender is a web application that provides personalized movie and TV show recommendations based on Jellyfin watch history, enhanced by Google Gemini AI. It integrates seamlessly with Jellyseerr for requesting media and allows manual tracking of watched content.

### Key Features:
- **Personalized Recommendations**: Uses Google Gemini AI to analyze viewing habits.
- **Jellyfin Integration**: Reads watch history directly from Jellyfin.
- **Jellyseerr Integration**: Allows requesting recommended media with one click.
- **Manual Tracking**: Users can add movies/series watched outside Jellyfin.
- **Feedback Mechanism**: Mark recommendations as watched or "do not recommend."

---

## Codebase Architecture

### Major Components:
1. **`app.py`**: The main application logic, including:
   - User authentication and session management.
   - Fetching and displaying recommendations.
   - Handling user interactions (e.g., marking watched, blocking recommendations).
2. **`database.json`**: Stores user-specific data, such as manually tracked content and "do not recommend" lists.
3. **`docker-compose.yml`**: Defines the Docker setup for running the application.
4. **`requirements.txt`**: Lists Python dependencies, including `streamlit` for the web interface.

### Data Flow:
- **Input**: Jellyfin watch history, manual entries, and user preferences.
- **Processing**: Google Gemini AI generates recommendations based on input data.
- **Output**: Recommendations displayed in the web interface, with options for user feedback.

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

### Debugging:
- Use `streamlit`'s built-in debugging tools to inspect session state and logs.
- Check `database.json` for user-specific data issues.

### Testing:
- No explicit test framework is defined. Use manual testing for now.
- Validate API integrations (Jellyfin, Jellyseerr, Google Gemini) with sample data.

---

## Project-Specific Conventions

### Streamlit Patterns:
- **Session State**: Use `st.session_state` to manage user-specific data (e.g., `jellyfin_session`, `recommendations`).
- **UI Layout**: Use `st.columns` for aligning buttons and content. Avoid clutter by spacing elements with `st.markdown` and custom HTML.

### Recommendation Handling:
- **Watched Content**: Store in `database.json` under `movies` or `series`.
- **Do Not Recommend**: Maintain separate lists for movies and series in `database.json`.
- **Filtering**: Always filter recommendations against "watched" and "do not recommend" lists before displaying.

### API Integrations:
- **Jellyfin**: Fetch watch history using the user's session.
- **Jellyseerr**: Handle media requests via API.
- **Google Gemini**: Generate recommendations using AI prompts.

---

## Key Files and Examples

### `app.py`:
- **Authentication**: Handles user login and session management.
- **Recommendation Display**: Fetches and displays recommendations with options for user feedback.
- **Manual Tracking**: Allows users to add watched content manually.

### `database.json`:
- Example structure:
  ```json
  {
    "username": {
      "movies": ["Movie A", "Movie B"],
      "series": ["Series A"],
      "do_not_recommend": {
        "movies": ["Blocked Movie"],
        "series": ["Blocked Series"]
      }
    }
  }
  ```

---

## Notes for AI Agents
- Focus on maintaining a clean and user-friendly UI.
- Ensure all API calls handle errors gracefully.
- Follow the existing patterns for session state management and data storage.
- When adding new features, ensure they integrate seamlessly with the current architecture.

---

For any questions or clarifications, refer to the `README.md` or ask the project maintainer.