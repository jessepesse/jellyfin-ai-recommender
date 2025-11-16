# API Integration Guide

This document describes the external services integrated in this project.

## Jellyfin API

### Authentication

```python
POST /Users/AuthenticateByName
Headers: X-Emby-Authorization: MediaBrowser Client="...", Device="...", ...
Body: {"Username": "user", "Pw": "password"}
Response: {
  "User": {"Id": "user-id", "Name": "username"},
  "AccessToken": "token-string"
}
```

### Fetching Watch History

```python
GET /Users/{user_id}/Items
Headers: X-Emby-Token: {access_token}
Params: {
  "IncludeItemTypes": "Movie,Series",
  "Recursive": true,
  "Filters": "IsPlayed"
}
Response: {
  "Items": [
    {"Name": "Movie Title", "Id": "..."},
    {"Name": "Series Title", "Id": "..."}
  ]
}
```

**Caching:** Watch history is fetched on each recommendation request (no caching).

---

## Jellyseerr API

### Media Search

```python
GET /api/v1/search
Headers: X-Api-Key: {api_key}
Params: {"query": "movie title", "page": 1}
Response: {
  "results": [
    {
      "id": 12345,
      "name": "Movie Title",
      "mediaType": "movie",  # or "tv"
      "posterPath": "/path/to/poster.jpg"
    }
  ]
}
```

**Caching:** Results cached for 6 hours per title (TTL in `@st.cache_data`).

### Media Request

```python
POST /api/v1/request
Headers: {
  "X-Api-Key": {api_key},
  "Content-Type": "application/json"
}
Body: {
  "mediaId": 12345,
  "mediaType": "movie"  # or "tv"
}
Response: {
  "id": "request-id",
  "status": "PENDING"  # or "APPROVED", "AVAILABLE"
}
```

### Availability Status Check

```python
GET /api/v1/movie/{tmdbId}
OR
GET /api/v1/tv/{tmdbId}

Headers: X-Api-Key: {api_key}
Params: None

Response: {
  "id": 12345,
  "name": "Title",
  "mediaType": "movie",  # or "tv"
  "status": "AVAILABLE",  # or "PARTIALLY_AVAILABLE", "UNKNOWN", etc.
  "posterPath": "/path/to/poster.jpg"
}
```

**Usage:** Checks if a recommendation is already available on the user's Jellyseerr instance. Status "AVAILABLE" or "PARTIALLY_AVAILABLE" means the content is accessible.

**Caching:** Availability checks are NOT cached (real-time status needed).

### Fetch All Available Content

```python
GET /api/v1/request

Headers: X-Api-Key: {api_key}
Params: None

Response: {
  "data": [
    {
      "id": "request-id-1",
      "status": "AVAILABLE",  # or "PENDING", "APPROVED", "DECLINED"
      "media": {
        "mediaType": "movie",  # or "tv"
        "title": "Movie Title",
        "name": "Series Name"
      }
    },
    {
      "id": "request-id-2",
      "status": "AVAILABLE",
      "media": {
        "mediaType": "tv",
        "title": null,
        "name": "Series Title"
      }
    }
  ]
}
```

**Usage:** Fetches all requests (user requests + auto-requests). Filters for AVAILABLE status only and separates into movies and TV series. Results are stored in database under `jellyseerr_available` for reference.

**Caching:** NOT cached - fetched fresh on each recommendation request to ensure current availability data.

---

## Google Generative AI (Gemini) API

### Model Configuration

- **Model:** `gemini-2.5-flash`
- **API Library:** `google-generativeai` Python package

### Request Format

```python
import google.generativeai as genai

genai.configure(api_key="YOUR_KEY")
model = genai.GenerativeModel('gemini-2.5-flash')
response = model.generate_content(prompt_text)
```

### Expected Response

The app sends a prompt requesting **JSON-only** output with structure:

```json
[
  {
    "title": "Movie or Series Title",
    "year": 2024,
    "reason": "Explanation why this recommendation suits user"
  }
]
```

**Important:** Titles must be in **English** for Jellyseerr search compatibility.

### Error Handling

- **Invalid JSON:** Response is cleaned (backticks removed) before parsing
- **API errors:** Caught and displayed to user with `st.error()`
- **Rate limits:** Check your Google AI Studio quota usage

---

## Data Flow Diagram

```
User Login
    ↓
[Jellyfin Auth] → Session token stored
    ↓
Fetch Recommendations Request
    ↓
[Jellyfin API] → Watch history
    ↓
[Local Database] → Manual watched + watchlist + blacklist + available_but_unwatched
    ↓
[Gemini API] → AI generates recommendations (filtered by availability)
    ↓
[Jellyseerr Search] → Find media IDs (cached 6 hours)
    ↓
[Jellyseerr Availability Check] → Query /api/v1/movie/{tmdbId} or /api/v1/tv/{tmdbId} (real-time)
    ↓
Check & Update Availability
    ↓
[Local Database] → Add to available_but_unwatched with timestamp
    ↓
Display Recommendations
    ↓
User Action (Request/Block/Watched/Watchlist)
    ↓
[Local Database] → Update user data
```

---

## API Key Security

### Best Practices

1. **Never commit `.env`** — It's in `.gitignore`
2. **Use `.env.example`** — Share as template
3. **Rotate keys regularly** — Especially Jellyseerr API keys
4. **Use Docker secrets** — For production deployment
5. **Monitor API usage** — Check Google AI Studio quota

### Environment Variables

All API keys are passed via environment variables:

```bash
# Docker
docker-compose up -d  # Reads from .env automatically

# Local development
export GEMINI_API_KEY="your_key"
streamlit run app.py
```

---

## Rate Limits & Quotas

### Jellyfin
- No strict API rate limits (self-hosted)
- Recommended: Cache watch history for 24 hours (currently not done)

### Jellyseerr
- No documented strict limits
- Search results cached for 6 hours
- Request throttling recommended for production

### Gemini
- Check [Google AI Studio](https://makersuite.google.com/app/apikey) for quota
- Free tier: 60 requests per minute
- Upgrade to paid for higher limits

### Availability Checks
- Per-recommendation check to Jellyseerr API
- No strict rate limits documented
- Recommended: Use parallel checks with ThreadPoolExecutor (app uses 5 workers)
- Real-time queries (not cached) for accurate availability status

## Troubleshooting

### Jellyfin Connection Issues
```
Error: "Yhteys Jellyfin-palvelimeen epäonnistui"
Solution: Verify JELLYFIN_URL, check network connectivity
```

### Jellyseerr Not Found
```
Error: "Ei löytynyt sopivaa mediaa"
Solution: Check API key, verify media library is indexed
```

### Gemini API Errors
```
Error: "Gemini API-virhe tai JSON-muunnos epäonnistui"
Solution: 
  1. Verify GEMINI_API_KEY is valid
  2. Check Google AI Studio quota
  3. Ensure prompt isn't too long
```

---
