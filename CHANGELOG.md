# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.3-alpha-hotfix] - 2025-11-13

### 🎯 Overview
Critical hotfix addressing media type handling bugs in recommendations and watchlist operations discovered after v0.2.3-alpha release. Ensures movies and TV series are correctly categorized in database and recommendations.

### ✨ What's New
- **Media Type Normalization in Recommendations**
  - Automatic conversion of Jellyseerr media types (movie/tv) for all database operations
  - Fallback normalization when Jellyseerr enrichment unavailable
  - Consistent media type handling across all UI operations (watchlist, watched, requests)

- **Improved Gemini Prompt Structure**
  - Explicit TÄRKEÄ (IMPORTANT) instruction in recommendation prompts
  - Clear media type specification to prevent AI confusion
  - Enhanced VAATIMUKSET section emphasizing type requirements

### 🐛 Bug Fixes
- **Watchlist Media Type Mismatch** - Fixed movies being incorrectly added to series watchlist and vice versa
  - Root cause: media_type from Jellyseerr not properly normalized for database operations
  - Solution: Added media_type normalization in Tab 1 recommendation loop (lines 1150-1152)
  - Ensures media_type is always 'movie' or 'tv' format before database operations
  - Converts UI values ('Elokuva'/'TV-sarja') to correct Jellyseerr format when needed
  - Verified: Jellyseerr 'movie' → stored in 'movies' key, 'tv' → stored in 'series' key

- **Gemini Recommendation Type Filtering** - Fixed Gemini mixing movies and TV series in recommendations
  - Added explicit TÄRKEÄ section clarifying only requested type should be recommended
  - Specifies: elokuva → movies only, TV-sarja → series only
  - Added emphasis in VAATIMUKSET to prevent type confusion

### 📚 Documentation
- 📖 README.md - Feature overview
- 🚀 SETUP.md - Deployment instructions
- 🔗 API_INTEGRATION.md - Integration details
- 🗄️ DATABASE_SCHEMA.md - Database structure

### ⚠️ Known Issues & Limitations
- None at this time. All critical bugs from v0.2.3-alpha have been addressed.

### 🚀 Installation & Upgrade
From v0.2.3-alpha:
```bash
git pull origin main
docker-compose up -d --build  # For Docker deployment
# or
streamlit run app.py  # For local development
```

### 📊 Monitoring
- Check `app.log` for media type normalization debug messages
- Verify watchlist additions in database.json (movies/series keys)
- Monitor Gemini API logs for prompt adherence

### ⚠️ Disclaimer
This is a pre-release version (alpha) with ongoing development and bug fixes. While all identified issues have been resolved, further improvements may follow.

**Tag:** v0.2.3-alpha-hotfix | **Date:** 2025-11-13 | **Type:** Pre-release (Alpha Hotfix)

## [0.2.3-alpha] - 2025-11-13

### Added
- **Session State Management for Recommendation Fetching**
  - Added `should_fetch_recommendations` session state to track fetch status
  - Added `recommendations_fetched` session state to indicate successful/failed fetch
  - Added `last_error` session state for error message display
  - Added `is_loading` session state for loading status tracking

- **Parallel Jellyseerr Enrichment with ThreadPoolExecutor**
  - Implemented `ThreadPoolExecutor` with 5 concurrent workers for parallel API calls
  - `_enrich_recommendation_with_jellyseerr()` helper function for thread-safe enrichment
  - Processes completed tasks as they finish using `as_completed()` pattern
  - Graceful error handling for individual enrichment failures
  - Improved performance for Jellyseerr lookups on multiple recommendations

- **Improved Recommendation Fetch UI Flow**
  - Moved recommendation fetch logic into main render cycle using `st.spinner()` context
  - Inline fetch processing directly in Tab 1 for cleaner code organization
  - Success and error messages now display in correct location below button

- **Watchlist "Katsottu" (Watched) Functionality**
  - Added "Katsottu" button to watchlist items (both movies and series in Tab 2)
  - Marks item as watched and automatically removes it from watchlist
  - Updates database with watched status
  - Displays confirmation toast with appropriate icon

### Changed
- Recommendation fetch now executes within `if st.session_state.get("should_fetch_recommendations", False):` block
- All spinners consolidated to show only main fetch spinner "🔄 Haetaan suosituksia..."
- Database loading optimized to occur once before recommendation display loop
- Error handling improved with dedicated `last_error` state for better error reporting
- Jellyseerr enrichment now uses concurrent processing instead of sequential lookups
- Watchlist layout now displays 4 columns: Title | Request | Watched | Delete
- Session state access now uses `.get()` method for safer attribute retrieval

### Fixed
- **Recommendation Fetch UI/UX Improvements**
  - Fixed UI responsiveness during long-running API calls
  - Error messages now display properly when recommendation fetch fails
- **Session State Error on Logout**
  - Fixed AttributeError when accessing session state after logout by using safe `.get()` method
  - Session state now properly handles missing keys without crashing
  - All session state attribute accesses now use `.get()` method with default values for robustness
  - Fixed `jellyfin_session` attribute access to use safe `.get()` chain method
  - Fixed logout button to display login page by adding explicit `st.rerun()` after session clear
- **Code Documentation**
  - Added explanatory comment for `build_prompt()` function clarifying Finnish localization
  - Documented that prompts are in Finnish because the application creator is Finnish
  - Added guidance for future localization efforts when extending to other languages

## [0.2.2-alpha] - 2025-11-13

### Added
- **Jellyseerr Search Integration for Manual Media Tracking** (Tab 3 - Merkitse)
  - Search functionality to query Jellyseerr by movie/series name
  - Display search results with poster images, ratings, descriptions, and media type
  - Responsive 3-column layout: poster (col1), details (col2), actions (col3)
  - One-click add to watched/tracked when selecting from search results
  - One-click request to Jellyseerr for downloading media
  - One-click add to watchlist from search results
  - One-click add to "do not recommend" list from search results
  - Status-aware buttons that show current state (e.g., "✅ Katsottu" if already watched)
  - Search result caching with 6-hour TTL for improved performance
  - Automatic result count feedback and "no results" warning

- **Recommendation Card Improvements** (Tab 1 - Suositukset)
  - Enhanced card layout matching Tab 3 search results structure
  - Automatic card removal when marked as watched, added to watchlist, or blocked
  - Consistent button labeling and behavior across all recommendation displays
  - Proper result filtering after user actions
  - Seamless UI updates without page refresh delays

### Fixed
- Recommendation cards now properly display and update without UI layout breaking
- Button click handlers now properly remove cards from display after action
- Search results styling now consistent with recommendation card styling
- Poster image error handling with proper logging and fallback display

### Changed
- Tab 3 (Merkitse) now primary interface for manual media tracking with visual search
- Unified button layout across Tab 1 (recommendations) and Tab 3 (search results)
- Improved user feedback through result counts and status indicators
- Enhanced logging for search operations and result processing

## [0.2.1-alpha] - 2025-11-13

### Added
- **Tabbed Interface**
  - Streamlit `st.tabs()` implementation for organized UI structure
  - Tab 1 (🔍 Suositukset): Recommendation search and display with filters
  - Tab 2 (📝 Katselulista): Watchlist management with request and remove actions
  - Tab 3 (✏️ Merkitse): Manual media tracking form
  - Tab 4 (💾 Tiedot): Database backup/restore and statistics display

- **Enhanced Recommendation Display with Jellyseerr Data**
  - Poster image retrieval from TMDB via Jellyseerr image proxy
  - Movie/series release year display (releaseDate/firstAirDate)
  - Rating display from TMDB (voteAverage)
  - Overview/synopsis display (truncated to 120 characters)
  - Responsive image sizing (130px width) for mobile and desktop
  - Fallback handling for missing poster images

- **Statistics Dashboard**
  - Movie count display
  - Series count display
  - Blocked recommendations count display

### Changed
- Reorganized application UI from linear expanders to tabbed interface
- Moved recommendation display to Tab 1 for better UX flow
- Improved navigation by grouping related functionality
- Enhanced mobile and desktop responsiveness with tab-based layout
- Recommendation cards now display metadata from Jellyseerr (posters, ratings, year, description)

### Fixed
- UI organization for better feature discoverability

## [Unreleased]

### Planned (v0.2.2-alpha)
- **Jellyseerr Search Integration for Manual Media Tracking**
  - Search functionality in Tab 3 (Merkitse) to query Jellyseerr by movie/series name
  - Display search results with poster images, ratings, and descriptions
  - One-click selection and add to watched list from search results
  - Improved manual tracking workflow with visual media selection
  - Search result caching for better performance

- **Database Persistence During Updates**
  - Volume mounting strategy for Docker container persistence (via bind mount in docker-compose.yml)
  - Automatic backup procedures (database.json.backup created before each write)
  - Comprehensive persistence guide (DATABASE_PERSISTENCE.md)
  - Data recovery and migration procedures
  - Troubleshooting guide for database issues
  - Best practices for backup and disaster recovery

- **Backup Merge Functionality**
  - Two import options in Tab 4 (Tiedot):
    * 🔄 Replace: Overwrite current database with backup
    * 🔗 Merge: Combine backup with current database (removes duplicates)
  - Consolidate multiple backups into single database
  - Recover lost data while preserving recent additions
  - Automatic deduplication when merging

## [0.2.0-alpha] - 2025-11-12

### Added
- **Comprehensive Logging System**
  - Python `logging` module configuration for application-wide logging
  - `app.log` file creation for persistent error and event tracking
  - Timestamped log entries with appropriate log levels (DEBUG, INFO, WARNING, ERROR)
  - Logging middleware for tracking API calls and database operations
  
- **Error Handling for Jellyfin API**
  - Try-catch blocks for authentication failures
  - Try-catch blocks for watch history retrieval
  - User-friendly error messages in Streamlit UI for connection issues
  - Detailed error logging for debugging Jellyfin integration issues

- **Error Handling for Google Gemini API**
  - Try-catch blocks for API calls and timeouts
  - Handling of API quota limits and rate limiting
  - Fallback responses when Gemini service is unavailable
  - Detailed logging of API request/response cycles

- **Error Handling for Jellyseerr API**
  - Try-catch blocks for media search and request operations
  - Proper HTTP status code validation
  - Graceful handling of missing or invalid media IDs
  - Error logging for request failures

- **Error Handling for Database Operations**
  - Try-catch blocks for JSON file read/write operations
  - Atomic database operations to prevent data corruption
  - JSON structure validation before saving
  - Data recovery suggestions for corrupted database files

- **Retry Logic with Exponential Backoff**
  - Automatic retries for transient API failures (network timeouts, temporary service unavailability)
  - Exponential backoff strategy to prevent rate limiting
  - Configurable maximum retry attempts (default: 3)
  - Jitter randomization to avoid thundering herd problem

- **Enhanced User Error Messages**
  - Clear, non-technical error descriptions in the Streamlit UI
  - Actionable guidance for common issues (connection failures, invalid credentials)
  - Links to troubleshooting documentation

### Fixed
- Silent API failures that left users without feedback
- Database write failures that could cause data loss
- Missing error context in logs for debugging
- Unhandled connection timeouts to Jellyfin and Jellyseerr
- JSON parsing errors when API responses are malformed

### Changed
- All database operations now wrapped in error handling
- API endpoint calls now include retry logic by default
- Error messages are now consistent across all integrations
- Log output includes correlation IDs for request tracing

### Security
- Added input validation for username and password fields before API calls
- Added validation of API keys from environment variables at startup
- Sanitized error messages to prevent exposure of sensitive information
- Database file permissions checked during initialization

## [0.1.0-alpha]

### Added
- Initial alpha release with core features:
  - **Jellyfin Integration**: Fetch watch history from Jellyfin media server
  - **AI Recommendations**: Generate personalized recommendations using Google Gemini AI
  - **Jellyseerr Integration**: Request recommended media directly from Jellyseerr
  - **Manual Media Tracking**: Add movies and series watched outside Jellyfin
  - **Watchlist Management**: Save recommendations to personal watchlist
  - **Database Backup/Restore**: Export and import user data as JSON
  - **Feedback Mechanism**: Mark recommendations as watched or add to "do not recommend" list
  - **Multi-user Support**: Isolated user data storage in `database.json`
  - **Genre Filtering**: Filter recommendations by genre preference
  - **UI Components**: Streamlit-based web interface with intuitive controls
