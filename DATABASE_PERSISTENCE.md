# Database Persistence Guide

This guide explains how to ensure your user data (`database.json`) persists across Docker container updates and version upgrades.

## Overview

The Jellyfin AI Recommender stores all user-specific data (watch history, watchlist, blocked recommendations, backups) in a single JSON file: `database.json`. This file must be preserved during:

- Container restarts
- Container upgrades/version updates
- Docker image rebuilds
- Server reboots

## Current Setup

### Volume Mounting

The `docker-compose.yml` already includes proper volume mounting:

```yaml
services:
  recommender:
    volumes:
      - ./database.json:/app/database.json    # Bind mount for persistence
      - ./images:/app/images
      - ./.streamlit:/app/.streamlit
```

**How it works:**
- `./database.json` (host) → `/app/database.json` (container)
- The file exists on your host machine
- Container reads/writes directly to the host file
- Data survives container stop/restart/rebuild

### Automatic Backup

The application automatically creates a backup before database writes:

```python
# From app.py - save_manual_db() function
def save_manual_db(db):
    try:
        # Create backup before writing
        if os.path.exists(DATABASE_FILE):
            shutil.copy(DATABASE_FILE, f"{DATABASE_FILE}.backup")
        
        with open(DATABASE_FILE, 'w', encoding='utf-8') as f:
            json.dump(db, f, ensure_ascii=False, indent=2)
```

This creates `database.json.backup` on every save (automatic backup).

## Scenarios and Solutions

### Scenario 1: Container Restart (No Data Loss)

```bash
# Stop container
docker-compose down

# Start container
docker-compose up -d

# Result: ✅ Database.json is preserved - no data loss
```

**Why:** The volume mount keeps the file on the host machine.

### Scenario 2: Docker Image Rebuild (No Data Loss)

```bash
# Pull latest code
git pull origin main

# Rebuild image and restart
docker-compose up -d --build

# Result: ✅ Database.json is preserved - no data loss
```

**Why:** Volume mounts are independent of image changes.

### Scenario 3: Version Upgrade with Breaking Changes

If a future version changes the database schema:

1. **Before upgrading:**
   ```bash
   # Create manual backup in multiple locations
   cp database.json database.json.backup.v0.2.1
   cp database.json ~/backups/database.json.$(date +%Y%m%d)
   ```

2. **Upgrade:**
   ```bash
   git pull origin main
   docker-compose up -d --build
   ```

3. **Migration (if needed):**
   - The app will detect schema mismatches
   - Manual migration steps will be provided in CHANGELOG
   - Keep your backup until migration is confirmed successful

### Scenario 4: Server Hardware Failure

Ensure backups on multiple machines:

1. **Regular exports:**
   - Use the app's backup feature (Tab 4: Tiedot)
   - 📥 Export your data monthly to a JSON file
   - Store on cloud storage (OneDrive, Google Drive, etc.)

2. **System backups:**
   - Include `/path/to/jellyfin-ai-recommender/database.json` in system backups
   - Use tools like `rsync` or cloud sync services

Example backup script:

```bash
#!/bin/bash
# backup-database.sh - Run weekly via cron

BACKUP_DIR="$HOME/backups/jellyfin-ai-recommender"
mkdir -p "$BACKUP_DIR"

# Backup database
cp database.json "$BACKUP_DIR/database.json.$(date +%Y%m%d_%H%M%S)"

# Keep only last 30 days
find "$BACKUP_DIR" -mtime +30 -delete
```

## Database File Details

### Location
- **Host:** `./database.json` (repository root)
- **Container:** `/app/database.json`

### Structure

```json
{
  "username": {
    "movies": ["Movie A", "Movie B"],
    "series": ["Series A", "Series B"],
    "do_not_recommend": ["Blocked Movie"],
    "watchlist": {
      "movies": ["Queued Movie"],
      "series": ["Queued Series"]
    },
    "jellyfin_synced_at": "2025-11-13 10:30:00",
    "jellyfin_total_watched": 150
  }
}
```

### Permissions

For production use, ensure proper permissions:

```bash
# Ensure file is readable/writable
chmod 644 database.json

# Ensure directory is readable/writable
chmod 755 .
```

## Best Practices

### 1. Regular Backups

```bash
# Manual backup before major changes
cp database.json database.json.backup.before-upgrade

# Automated daily backup
0 2 * * * cp /path/to/database.json /backups/database.json.$(date +\%Y\%m\%d)
```

### 2. Monitor Database Size

```bash
# Check database size
ls -lh database.json

# Typical size: 1-10 KB per user (grows with watch history)
```

### 3. Use Version Control (Optional)

If you want to track changes:

```bash
# Remove database.json from .gitignore (optional)
# git add database.json
# git commit -m "Database snapshot"
```

**⚠️ Warning:** Only do this if the repository is private and you don't mind tracking all user data.

### 4. Export User Data Regularly

Use the app's built-in export feature (Tab 4):
- 📥 Exports your personal data as standalone JSON
- Store in cloud storage
- Can be imported into new installations

### 5. Merge Backup Data with Current Database

When importing a backup, you have two options in Tab 4 (Tiedot):

**🔄 Replace (Korvaa tietokanta):**
- Completely replaces your current database with the imported backup
- Use this if the backup is newer and contains all your data
- ⚠️ Warning: Any data added after the backup was created will be lost

**🔗 Merge (Yhdistä tietokannat):**
- Combines the backup data with your current database
- Merges movies, series, watchlist, and blocked recommendations
- Removes duplicates automatically
- ✅ Recommended when importing older backups or consolidating data
- Perfect for recovering lost watchlist entries while keeping new data

**Example merge scenario:**
```
Before merge:
  Current database: Movies [A, B, C], Watchlist [X]
  Imported backup: Movies [B, C, D], Watchlist [Y, Z]

After merge:
  Merged database: Movies [A, B, C, D], Watchlist [X, Y, Z]
```

## Troubleshooting

### "database.json not found after restart"

**Problem:** Database file disappeared after container restart.

**Solutions:**
```bash
# Verify volume mount is correct
docker-compose config | grep -A 5 volumes

# Check if file exists on host
ls -la database.json

# Recreate empty database
echo '{}' > database.json
docker-compose down
docker-compose up -d
```

### "database.json permission denied"

**Problem:** Container can't write to database file.

**Solution:**
```bash
# Fix permissions
chmod 666 database.json

# Or run as docker user
docker-compose down
sudo chown 1000:1000 database.json  # Streamlit UID
docker-compose up -d
```

### "database.json corrupted after crash"

**Problem:** Application crashed and database.json is invalid JSON.

**Solution:**
```bash
# Check backup
cat database.json.backup

# If backup is valid, restore it
cp database.json.backup database.json

# Or restore from manual backup
cp database.json.backup.v0.2.1 database.json

# Restart container
docker-compose down
docker-compose up -d
```

## Migration from Older Versions

If upgrading from v0.1.0 (without automatic backups):

1. **Locate old database.json:**
   ```bash
   find / -name "database.json" -type f 2>/dev/null
   ```

2. **Copy to repository root:**
   ```bash
   cp /old/path/database.json ./database.json
   ```

3. **Start new version:**
   ```bash
   docker-compose up -d
   ```

4. **Verify data:**
   - Login to app
   - Check if your watch history loaded correctly
   - Verify watchlist and blocked recommendations

## Docker Volume vs Bind Mount

This project uses **bind mounts** (recommended for this use case):

| Feature | Bind Mount | Docker Volume |
|---------|-----------|---------------|
| File location | Host filesystem | Docker managed |
| Backup ease | Simple (standard files) | Complex (docker commands) |
| Edit while running | ✅ Yes | ⚠️ Risky |
| Portability | ✅ Easy (portable files) | ⚠️ Docker-specific |
| Performance | Depends on filesystem | Optimized by Docker |

**Our choice (bind mount):**
- ✅ Easy backups
- ✅ Human-readable JSON
- ✅ Works on all systems
- ✅ Can edit in text editor

## Contact & Support

For issues with database persistence:

1. Check `app.log` for errors
2. Verify volume mounts: `docker inspect jellyfin-ai-recommender`
3. Test with manual export/import (Tab 4)
4. Check GitHub issues: https://github.com/jessepesse/jellyfin-ai-recommender/issues
