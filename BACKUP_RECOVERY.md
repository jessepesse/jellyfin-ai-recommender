# Backup & Recovery System

## Overview

The Jellyfin AI Recommender includes a comprehensive backup and recovery system designed for:
- **Safety**: Automatic database backups before schema changes
- **Self-Healing**: Automatic schema synchronization on startup
- **Portability**: JSON exports for easy migration between installations
- **Recovery**: Setup Wizard integration for restoring from backups

## Architecture

### 1. Startup Sequence (`backend/start.sh`)

The application follows a strict boot sequence:

```
1. Raw Backup      → Copy dev.db to dev.db.backup_startup (if exists)
2. Schema Sync     → Run `prisma db push --accept-data-loss`
3. Client Gen      → Run `prisma generate`
4. JSON Export     → Run backup_db.ts script
5. Launch          → Start the Node.js application
```

This ensures:
- Database is backed up before any schema modifications
- Tables are created/updated automatically (fixes "Table not found" errors)
- Portable JSON backup is always available
- Prisma client matches the database schema

### 2. Backup Script (`backend/scripts/backup_db.ts`)

Creates portable JSON backups containing:
- **System Configuration**: Jellyfin, Jellyseerr, Gemini settings
- **User Data**: All users with their:
  - Watched movies and TV shows
  - Watchlist items
  - Blocked content
  - Taste profiles

**Output Files**:
- `./data/backup_latest.json` - Always current backup
- `./data/backup_YYYY-MM-DDTHH-MM-SS.json` - Timestamped backups

**Manual Backup**:
```bash
cd backend
npm run db:backup
```

### 3. Setup Wizard Recovery (`frontend/src/components/SetupWizard.tsx`)

The Setup Wizard includes a "Restore from Backup" section:
- Upload backup JSON file
- Automatically extracts and pre-fills configuration (URLs, API keys)
- User can test connections before saving
- Watch history restoration happens after first login

## Backup File Format

```json
{
  "version": "2.0.3",
  "exported_at": "2025-11-25T12:00:00.000Z",
  "system_config": {
    "jellyfinUrl": "http://jellyfin:8096",
    "jellyseerrUrl": "http://jellyseerr:5055",
    "jellyseerrApiKey": "your-api-key",
    "geminiApiKey": "your-gemini-key",
    "geminiModel": "gemini-2.5-flash-lite",
    "isConfigured": true
  },
  "users": [
    {
      "username": "john",
      "movieProfile": "Loves sci-fi and action...",
      "tvProfile": "Prefers crime dramas...",
      "data": {
        "movies": [
          {
            "title": "Inception",
            "tmdb_id": 27205,
            "media_type": "movie",
            "release_year": "2010",
            "poster_url": "...",
            "overview": "...",
            "vote_average": 8.4,
            "added_at": "2025-11-25T10:30:00.000Z"
          }
        ],
        "series": [...],
        "watchlist": {
          "movies": [...],
          "series": [...]
        },
        "do_not_recommend": [...]
      }
    }
  ]
}
```

## Usage Scenarios

### Fresh Installation

1. Start containers: `docker-compose -f docker-compose.prod.yml up -d`
2. On first boot:
   - `start.sh` creates empty database
   - `prisma db push` creates all tables
   - Application starts successfully

### Migrating Between Servers

1. **On Old Server**:
   - Download backup from `./data/backup_latest.json`
   - Or trigger manual backup: `docker exec jellyfin-ai-backend npm run db:backup`

2. **On New Server**:
   - Start containers with empty `./data` directory
   - Access Setup Wizard
   - Click "Restore from Backup"
   - Upload backup JSON file
   - Configuration fields auto-populate
   - Test connections and save
   - Login with original username
   - Watch history automatically restored

### Database Corruption Recovery

If the database becomes corrupted:

1. Stop containers: `docker-compose -f docker-compose.prod.yml down`
2. Check for backups:
   ```bash
   ls -lh ./data/dev.db.backup_startup
   ls -lh ./data/backup_*.json
   ```
3. **Option A - Restore from startup backup**:
   ```bash
   cp ./data/dev.db.backup_startup ./data/dev.db
   ```
4. **Option B - Restore from JSON**:
   ```bash
   rm ./data/dev.db
   # Start containers - creates fresh database
   # Use Setup Wizard to restore from JSON
   ```

### Upgrading Application Version

When upgrading to a new version:

1. Backup current installation:
   ```bash
   docker exec jellyfin-ai-backend npm run db:backup
   cp ./data/dev.db ./data/dev.db.pre-upgrade
   ```

2. Pull new images:
   ```bash
   docker-compose -f docker-compose.prod.yml pull
   ```

3. Restart containers:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

4. Startup script automatically:
   - Backs up database to `dev.db.backup_startup`
   - Runs `prisma db push` to update schema
   - Creates new JSON backup
   - Starts application

## File Locations

### Docker Container

- **Database**: `/app/data/dev.db`
- **Startup Backup**: `/app/data/dev.db.backup_startup`
- **JSON Backups**: `/app/data/backup_*.json`
- **Prisma Schema**: `/app/prisma/schema.prisma` (preserved by volume mount strategy)

### Host System (Docker Volume)

```
./data/
├── dev.db                           # Active SQLite database
├── dev.db.backup_startup            # Backup from last startup
├── backup_latest.json               # Current JSON backup
└── backup_2025-11-25T12-00-00.json # Timestamped backups
```

## Disaster Recovery Procedures

### Complete Data Loss

If `./data` directory is completely lost:

1. **If you have JSON backup elsewhere**:
   - Start fresh installation
   - Use Setup Wizard to restore from backup
   - All data recovered

2. **If no backups exist**:
   - Start fresh installation
   - Complete Setup Wizard normally
   - Re-sync Jellyfin watch history manually

### Corrupted Database

Symptoms: "Table not found", "Database is locked", SQL errors

**Automated Fix** (start.sh handles this):
```bash
docker-compose -f docker-compose.prod.yml restart backend
# Startup script runs prisma db push to fix schema
```

**Manual Fix**:
```bash
docker exec -it jellyfin-ai-backend sh
cd /app
npx prisma db push --accept-data-loss --schema=/app/prisma/schema.prisma
```

### Lost Configuration

If SystemConfig table is empty:

1. Check JSON backup:
   ```bash
   cat ./data/backup_latest.json | grep system_config
   ```
2. Use Setup Wizard to reconfigure
3. Or restore from backup to recover settings

## Monitoring

### Check Backup Status

```bash
# View latest backup
cat ./data/backup_latest.json | jq '.exported_at, .users[].username'

# List all backups with sizes
ls -lh ./data/backup_*.json

# Verify database backup
ls -lh ./data/dev.db*
```

### Verify Startup Logs

```bash
docker logs jellyfin-ai-backend | grep -A 5 "Starting Jellyfin"
```

Expected output:
```
🚀 Starting Jellyfin AI Recommender Backend...
================================================
📁 Ensuring data directory exists: /app/data
💾 Creating startup backup: /app/data/dev.db.backup_startup
✅ Startup backup created successfully
🔄 Syncing database schema...
✅ Database schema synced successfully
🔧 Generating Prisma Client...
✅ Prisma Client generated successfully
📦 Creating JSON backup...
✅ JSON backup created successfully
================================================
🎉 Initialization complete! Starting application...
```

## Best Practices

1. **Regular Backups**: Download `backup_latest.json` periodically
2. **Test Restores**: Verify backups can be restored on test instance
3. **Monitor Logs**: Check startup logs for backup failures
4. **Version Control**: Keep backups for each major version
5. **Secure Storage**: Store API keys securely (encrypted backups recommended)

## Security Considerations

⚠️ **Backup files contain sensitive data**:
- API keys (Jellyseerr, Gemini)
- URLs to internal services
- User watch history

**Recommendations**:
- Encrypt backups before storing externally
- Restrict file permissions: `chmod 600 ./data/backup_*.json`
- Use secure transfer methods (SCP, encrypted cloud storage)
- Rotate API keys periodically
- Never commit backups to version control

## Troubleshooting

### Backup Script Fails

**Symptom**: "JSON backup failed (non-critical, continuing...)"

**Causes**:
- Disk space full
- Permission issues
- TypeScript/ts-node not installed

**Fix**:
```bash
docker exec -it jellyfin-ai-backend sh
cd /app
npm install ts-node typescript --save-dev
npx ts-node scripts/backup_db.ts
```

### Setup Wizard Can't Parse Backup

**Symptom**: "Invalid JSON file"

**Causes**:
- Corrupted download
- Wrong file format

**Fix**:
1. Verify JSON validity: `cat backup.json | jq .`
2. Check file size matches original
3. Re-download from source

### Schema Sync Fails

**Symptom**: "Schema sync failed!" in logs

**Causes**:
- Database locked by another process
- Disk space full
- Corrupted database file

**Fix**:
```bash
# Stop all containers
docker-compose -f docker-compose.prod.yml down

# Remove corrupted database
rm ./data/dev.db

# Restart (creates fresh database)
docker-compose -f docker-compose.prod.yml up -d
```

## Development

### Testing Backup Script Locally

```bash
cd backend
export DATABASE_URL="file:./prisma/dev.db"
export DATA_DIR="./data"
npm run db:backup
```

### Testing Startup Script

```bash
cd backend
chmod +x start.sh
export DATABASE_URL="file:./data/dev.db"
./start.sh
```

### Modifying Backup Format

Edit `backend/scripts/backup_db.ts` to change:
- Data structure
- File naming
- Output location
- What data is included

After changes:
```bash
npm run build
npm run db:backup  # Test new format
```

## Related Documentation

- [Prisma DB Push](https://www.prisma.io/docs/reference/api-reference/command-reference#db-push)
- [SQLite Backup Best Practices](https://www.sqlite.org/backup.html)
- [Docker Volume Mounts](https://docs.docker.com/storage/volumes/)
