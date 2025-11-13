# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

### Changed
- Recommendation fetch now executes within `if st.session_state.should_fetch_recommendations:` block
- All spinners consolidated to show only main fetch spinner "🔄 Haetaan suosituksia..."
- Database loading optimized to occur once before recommendation display loop
- Error handling improved with dedicated `last_error` state for better error reporting
- Jellyseerr enrichment now uses concurrent processing instead of sequential lookups

### Fixed
- **Recommendation Fetch UI/UX Improvements**
  - Fixed UI responsiveness during long-running API calls
  - Error messages now display properly when recommendation fetch fails

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
