# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
