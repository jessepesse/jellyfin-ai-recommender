# Database Schema

User data is stored in `database.json` with the following structure:

## Schema Overview

```json
{
  "username": {
    "movies": [
      {
        "title": "Movie 1",
        "media_type": "movie",
        "tmdb_id": 12345
      },
      {
        "title": "Movie 2",
        "media_type": "movie",
        "tmdb_id": 67890
      }
    ],
    "series": [
      {
        "title": "Series 1",
        "media_type": "tv",
        "tmdb_id": 11111
      },
      {
        "title": "Series 2",
        "media_type": "tv",
        "tmdb_id": 22222
      }
    ],
    "do_not_recommend": [
      {
        "title": "Title A",
        "media_type": "movie",
        "tmdb_id": 33333
      },
      {
        "title": "Title B",
        "media_type": "tv",
        "tmdb_id": 44444
      }
    ],
    "watchlist": {
      "movies": [
        {
          "title": "Movie 3",
          "media_type": "movie",
          "tmdb_id": 55555
        },
        {
          "title": "Movie 4",
          "media_type": "movie",
          "tmdb_id": 66666
        }
      ],
      "series": [
        {
          "title": "Series 3",
          "media_type": "tv",
          "tmdb_id": 77777
        }
      ]
    },
    "available_but_unwatched": [
      {
        "title": "Avatar",
        "media_type": "movie",
        "tmdb_id": 19995,
        "noted_at": "2025-11-16 14:30:00"
      }
    ],
    "jellyseerr_available": {
      "movies": [
        {"title": "Movie A", "media_type": "movie", "tmdb_id": 88888},
        {"title": "Movie B", "media_type": "movie", "tmdb_id": 99999},
        {"title": "Movie C", "media_type": "movie", "tmdb_id": 10101}
      ],
      "series": [
        {"title": "Series A", "media_type": "tv", "tmdb_id": 11212},
        {"title": "Series B", "media_type": "tv", "tmdb_id": 12323}
      ]
    },
    "jellyfin_synced_at": "2024-01-15 14:23:45.123456",
    "jellyseerr_synced_at": "2024-01-15 14:25:00.123456",
    "jellyfin_total_watched": 42
  }
}
```


## Field Descriptions

### Root Level
- **username** (string) — Jellyfin username (key for user data)

### Per-User Fields

| Field | Type | Description |
|-------|------|-------------|
| `movies` | array[object] | Manually added watched movies with metadata |
| `movies[].title` | string | Movie title |
| `movies[].media_type` | string | Always "movie" (from Jellyseerr) |
| `movies[].tmdb_id` | number | TMDB ID for Jellyseerr requests |
| `series` | array[object] | Manually added watched TV series with metadata |
| `series[].title` | string | Series title |
| `series[].media_type` | string | Always "tv" (from Jellyseerr) |
| `series[].tmdb_id` | number | TMDB ID for Jellyseerr requests |
| `do_not_recommend` | array[object] | Titles user doesn't want recommendations for |
| `do_not_recommend[].title` | string | Title to block |
| `do_not_recommend[].media_type` | string | Media type: "movie" or "tv" (from Jellyseerr) |
| `do_not_recommend[].tmdb_id` | number | TMDB ID for reference |
| `watchlist` | object | Media saved from recommendations |
| `watchlist.movies` | array[object] | Movies added to watchlist from recommendations |
| `watchlist.movies[].title` | string | Movie title |
| `watchlist.movies[].media_type` | string | Always "movie" (from Jellyseerr enrichment) |
| `watchlist.movies[].tmdb_id` | number | TMDB ID for Jellyseerr requests |
| `watchlist.series` | array[object] | TV series added to watchlist from recommendations |
| `watchlist.series[].title` | string | Series title |
| `watchlist.series[].media_type` | string | Always "tv" (from Jellyseerr enrichment) |
| `watchlist.series[].tmdb_id` | number | TMDB ID for Jellyseerr requests |
| `available_but_unwatched` | array[object] | Available content on Jellyseerr but not yet watched (auto-tracked) |
| `available_but_unwatched[].title` | string | Title of the available media |
| `available_but_unwatched[].media_type` | string | Media type: "movie" or "tv" |
| `available_but_unwatched[].tmdb_id` | number | TMDB ID for reference |
| `available_but_unwatched[].noted_at` | string | Timestamp when availability was noted (ISO format) |
| `jellyseerr_available` | object | All AVAILABLE content from Jellyseerr (synced on recommendation fetch) |
| `jellyseerr_available.movies` | array[object] | AVAILABLE movies from Jellyseerr /api/v1/request |
| `jellyseerr_available.movies[].title` | string | Movie title |
| `jellyseerr_available.movies[].media_type` | string | Always "movie" |
| `jellyseerr_available.movies[].tmdb_id` | number | TMDB ID for Jellyseerr requests |
| `jellyseerr_available.series` | array[object] | AVAILABLE TV series from Jellyseerr /api/v1/request |
| `jellyseerr_available.series[].title` | string | Series title |
| `jellyseerr_available.series[].media_type` | string | Always "tv" |
| `jellyseerr_available.series[].tmdb_id` | number | TMDB ID for Jellyseerr requests |
| `jellyfin_synced_at` | string | Timestamp of last Jellyfin watch history sync (ISO format) |
| `jellyseerr_synced_at` | string | Timestamp of last Jellyseerr available content sync (ISO format) |
| `jellyfin_total_watched` | number | Total count of watched items from Jellyfin |

## Data Flow

### Adding to Watched List
1. User clicks "👁️ Merkitse katsotuksi" button
2. `handle_watched_add()` appends title to `movies` or `series` array
3. Item removed from current recommendations in UI
4. Database saved

### Adding to Watchlist
1. User clicks "🔖 Lisää katselulistalle" button
2. `handle_watchlist_add()` appends to `watchlist.movies` or `watchlist.series`
3. Item removed from current recommendations in UI
4. Database saved

### Blocking Content
1. User clicks "🚫 Älä suosittele" button
2. `handle_blacklist_add()` appends to `do_not_recommend` array
3. Automatically removed from watchlist if present
4. Item removed from current recommendations in UI
5. Database saved

### Adding to Manual Watchlist
1. User searches media in Tab 3 (Merkitse)
2. Enrichment fetches media_id and media_type from Jellyseerr
3. `handle_watchlist_add()` appends entry with: title, media_type, tmdb_id
4. Item added to `watchlist.movies` or `watchlist.series`
5. Database saved

### TMDB ID Storage & Jellyseerr Integration
All media entries (watched, do_not_recommend, watchlist) now include:
- **title**: Media title (string)
- **media_type**: "movie" or "tv" (from Jellyseerr API)
- **tmdb_id**: TMDB identifier (from Jellyseerr API)

**Benefits:**
- Ensures correct database placement (media_type determines movies/series key)
- Enables direct Jellyseerr requests (POST /api/v1/request with tmdb_id)
- Supports future cross-service integrations (Radarr, Sonarr, Plex)
- Better deduplication logic using tmdb_id matching
- Accurate availability checks across services

**Data Flow:**
1. User adds media to any collection (watched, watchlist, do_not_recommend)
2. Enrichment layer queries Jellyseerr API for media details
3. Extract: media_type ("movie"/"tv"), tmdb_id (numeric)
4. Store complete object: {title, media_type, tmdb_id} in appropriate list
5. No mixed types per list (movies only have "movie", series only have "tv")

### Fetching Recommendations
1. `fetch_and_show_recommendations()` loads all user data
2. Combines Jellyfin history + manually added watched content
3. Creates flattened watchlist for AI prompt (titles only)
4. Filters results against `do_not_recommend` list
5. After enrichment, checks TMDB IDs against available content

## Example User Entry

```json
{
  "jesse": {
    "movies": [
      {"title": "Dune", "media_type": "movie", "tmdb_id": 438631},
      {"title": "Inception", "media_type": "movie", "tmdb_id": 27205},
      {"title": "Interstellar", "media_type": "movie", "tmdb_id": 157336}
    ],
    "series": [
      {"title": "Breaking Bad", "media_type": "tv", "tmdb_id": 1396},
      {"title": "The Office", "media_type": "tv", "tmdb_id": 6594}
    ],
    "do_not_recommend": [
      {"title": "The Room", "media_type": "movie", "tmdb_id": 138},
      {"title": "Twilight", "media_type": "movie", "tmdb_id": 20644}
    ],
    "watchlist": {
      "movies": [
        {"title": "Blade Runner 2049", "media_type": "movie", "tmdb_id": 335984},
        {"title": "Arrival", "media_type": "movie", "tmdb_id": 329865}
      ],
      "series": [
        {"title": "Severance", "media_type": "tv", "tmdb_id": 142585},
        {"title": "Andor", "media_type": "tv", "tmdb_id": 114410}
      ]
    },
    "available_but_unwatched": [
      {
        "title": "Avatar",
        "media_type": "movie",
        "tmdb_id": 19995,
        "noted_at": "2025-11-16 14:30:00"
      },
      {
        "title": "Dune: Part Two",
        "media_type": "movie",
        "tmdb_id": 282035,
        "noted_at": "2025-11-16 14:35:00"
      }
    ],
    "jellyseerr_available": {
      "movies": [
        {"title": "Avatar 2", "media_type": "movie", "tmdb_id": 335987},
        {"title": "Dune: Part Two", "media_type": "movie", "tmdb_id": 282035},
        {"title": "Oppenheimer", "media_type": "movie", "tmdb_id": 872585}
      ],
      "series": [
        {"title": "The Last of Us", "media_type": "tv", "tmdb_id": 100088},
        {"title": "Succession", "media_type": "tv", "tmdb_id": 69050}
      ]
    },
    "jellyfin_synced_at": "2024-12-15 19:45:30.567890",
    "jellyseerr_synced_at": "2024-12-15 19:50:00.123456",
    "jellyfin_total_watched": 156
  }
}
```

## Data Integrity Rules

1. **Media Type Consistency** — Each list uses appropriate media_type ("movie" for movies list, "tv" for series list)
2. **TMDB ID Uniqueness** — Each entry has unique tmdb_id from Jellyseerr
3. **No duplicates** — Handlers check by tmdb_id to prevent duplicates
4. **Removal cascades** — Blocking item (by tmdb_id) removes from watchlist
5. **Auto-sync** — Jellyfin history fetched on each recommendation request
6. **Atomic saves** — Database written after each operation

## Migration Strategy

### From Legacy Simple-String Format to New Object Format

**Old format (pre-v0.2.6):**
```json
{
  "movies": ["Movie 1", "Movie 2"],
  "series": ["Series 1"],
  "do_not_recommend": ["Bad Movie"],
  "watchlist": {"movies": ["Queued Movie"], "series": ["Queued Series"]}
}
```

**New format (v0.2.6+):**
```json
{
  "movies": [
    {"title": "Movie 1", "media_type": "movie", "tmdb_id": 12345},
    {"title": "Movie 2", "media_type": "movie", "tmdb_id": 67890}
  ],
  "series": [
    {"title": "Series 1", "media_type": "tv", "tmdb_id": 11111}
  ],
  "do_not_recommend": [
    {"title": "Bad Movie", "media_type": "movie", "tmdb_id": 33333}
  ],
  "watchlist": {
    "movies": [
      {"title": "Queued Movie", "media_type": "movie", "tmdb_id": 55555}
    ],
    "series": [
      {"title": "Queued Series", "media_type": "tv", "tmdb_id": 77777}
    ]
  }
}
```

**Migration Process:**
1. When user logs in post-v0.2.6, system detects old format (strings instead of objects)
2. For each string entry, query Jellyseerr to fetch media_type and tmdb_id
3. Create object entry: {title, media_type, tmdb_id}
4. Update database with migrated data
5. Log migration results: count of migrated items, any failures
6. Display migration status to user if needed

### Handling Legacy Data

If user has old watchlist format (simple list instead of dict):

```javascript
// Old format (pre-v0.2.1)
"watchlist": ["Movie 1", "Series 1"]

// Migrated format (v0.2.1-v0.2.5)
"watchlist": {
  "movies": ["Movie 1"],
  "series": ["Series 1"]
}

// Current format (v0.2.6+)
"watchlist": {
  "movies": [
    {"title": "Movie 1", "media_type": "movie", "tmdb_id": 12345}
  ],
  "series": [
    {"title": "Series 1", "media_type": "tv", "tmdb_id": 11111}
  ]
}
```

The UI automatically handles migrations on data access.

## Backup Recommendations

Since `database.json` contains user preferences:

```bash
# Manual backup
cp database.json database.json.backup.$(date +%Y%m%d_%H%M%S)

# Or use cron job (Linux/Mac)
0 2 * * * cp /path/to/database.json /path/to/backups/database.json.$(date +\%Y\%m\%d)
```

