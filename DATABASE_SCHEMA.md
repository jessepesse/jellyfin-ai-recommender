# Database Schema

User data is stored in `database.json` with the following structure:

## Schema Overview

```json
{
  "username": {
    "movies": ["Movie 1", "Movie 2"],
    "series": ["Series 1", "Series 2"],
    "do_not_recommend": ["Title A", "Title B"],
    "watchlist": {
      "movies": ["Movie 3", "Movie 4"],
      "series": ["Series 3"]
    },
    "jellyfin_synced_at": "2024-01-15 14:23:45.123456",
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
| `movies` | array[string] | Manually added watched movies |
| `series` | array[string] | Manually added watched TV series |
| `do_not_recommend` | array[string] | Titles user doesn't want recommendations for |
| `watchlist.movies` | array[string] | Movies added to watchlist from recommendations |
| `watchlist.series` | array[string] | TV series added to watchlist from recommendations |
| `jellyfin_synced_at` | string | Timestamp of last Jellyfin sync (ISO format) |
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

### Fetching Recommendations
1. `fetch_and_show_recommendations()` loads all user data
2. Combines Jellyfin history + manually added watched content
3. Creates flattened watchlist for AI prompt
4. Filters results against `do_not_recommend` list

## Example User Entry

```json
{
  "jesse": {
    "movies": ["Dune", "Inception", "Interstellar"],
    "series": ["Breaking Bad", "The Office"],
    "do_not_recommend": ["The Room", "Twilight"],
    "watchlist": {
      "movies": ["Blade Runner 2049", "Arrival"],
      "series": ["Severance", "Andor"]
    },
    "jellyfin_synced_at": "2024-12-15 19:45:30.567890",
    "jellyfin_total_watched": 156
  }
}
```

## Data Integrity Rules

1. **No duplicates** — Handlers check before appending
2. **Removal cascades** — Blocking item removes from watchlist
3. **Auto-sync** — Jellyfin history fetched on each recommendation request
4. **Atomic saves** — Database written after each operation

## Migration Notes

### Handling Legacy Data

If user has old watchlist format (simple list instead of dict):

```javascript
// Old format (should not exist in current version)
"watchlist": ["Movie 1", "Series 1"]

// New format (current)
"watchlist": {
  "movies": ["Movie 1"],
  "series": ["Series 1"]
}
```

The UI automatically converts legacy format to new structure on first access.

## Backup Recommendations

Since `database.json` contains user preferences:

```bash
# Manual backup
cp database.json database.json.backup.$(date +%Y%m%d_%H%M%S)

# Or use cron job (Linux/Mac)
0 2 * * * cp /path/to/database.json /path/to/backups/database.json.$(date +\%Y\%m\%d)
```

