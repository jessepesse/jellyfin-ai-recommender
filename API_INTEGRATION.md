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
[Local Database] → Manual watched + watchlist + blacklist
    ↓
[Gemini API] → AI generates recommendations
    ↓
[Jellyseerr Search] → Find media IDs (cached)
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

---

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
