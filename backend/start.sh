#!/bin/sh
set -e

echo "🚀 Starting Jellyfin AI Recommender Backend..."
echo "================================================"

# Configuration
DATA_DIR="${DATA_DIR:-/app/data}"
IMAGE_DIR="${IMAGE_DIR:-/app/images}"
DB_PATH="$DATA_DIR/dev.db"
BACKUP_STARTUP="$DATA_DIR/dev.db.backup_startup"
PRISMA_DIR="/app/prisma"

# Ensure required directories exist
echo "📁 Ensuring required directories exist..."
mkdir -p "$DATA_DIR"
mkdir -p "$IMAGE_DIR"
echo "   ✓ Data directory: $DATA_DIR"
echo "   ✓ Image cache directory: $IMAGE_DIR"

# Step 1: Raw Database Backup (if database exists)
if [ -f "$DB_PATH" ]; then
    echo "💾 Creating startup backup: $BACKUP_STARTUP"
    cp "$DB_PATH" "$BACKUP_STARTUP"
    echo "✅ Startup backup created successfully"
else
    echo "⚠️  No existing database found at $DB_PATH (fresh install)"
fi

# Step 2: Database Migration Strategy (Production-Safe)
# Handles both fresh installs and existing databases without migration history
echo "🔄 Checking database migration state..."

if [ -f "$DB_PATH" ]; then
    # Database exists - check if it has the migrations table
    MIGRATION_TABLE_EXISTS=$(sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations';" 2>/dev/null || echo "")
    
    if [ -z "$MIGRATION_TABLE_EXISTS" ]; then
        echo "⚠️  Existing database without migration history detected"
        echo "   Performing baseline migration (marking all migrations as applied)"
        
        # Get list of all migration directories
        MIGRATION_DIRS=$(ls -1 backend/prisma/migrations/ 2>/dev/null | grep -E '^[0-9]+_' || echo "")
        
        if [ -n "$MIGRATION_DIRS" ]; then
            # Mark each migration as applied without actually running it
            # This is the proper way to baseline an existing production database
            echo "$MIGRATION_DIRS" | while read -r migration; do
                echo "   Marking migration as applied: $migration"
                npx prisma migrate resolve --applied "$migration" || {
                    echo "❌ Failed to baseline migration: $migration"
                    exit 1
                }
            done
            echo "✅ Database baseline completed successfully"
        else
            echo "⚠️  No migrations found to baseline"
        fi
    else
        echo "   Migration history found"
    fi
    
    # Now run normal migration deploy (will skip already-applied migrations)
    echo "   Running: npx prisma migrate deploy"
    if npx prisma migrate deploy; then
        echo "✅ Database migrations applied successfully"
    else
        echo "❌ Migration failed!"
        echo "   This usually means:"
        echo "   - Migration files are missing or corrupted"
        echo "   - Database schema is out of sync"
        echo "   - Database is locked by another process"
        exit 1
    fi
else
    echo "⚠️  No existing database found (fresh install)"
    echo "   Running: npx prisma migrate deploy"
    if npx prisma migrate deploy; then
        echo "✅ Database created and migrations applied successfully"
    else
        echo "❌ Migration failed!"
        exit 1
    fi
fi

# Step 3: Generate Prisma Client
# Prisma 7 uses prisma.config.ts for schema location
echo "🔧 Generating Prisma Client..."
if npx prisma generate; then
    echo "✅ Prisma Client generated successfully"
else
    echo "❌ Prisma Client generation failed!"
    exit 1
fi

# Step 4: Export Database to JSON (portable backup)
echo "📦 Creating JSON backup..."
if [ -f "$DB_PATH" ]; then
    if npx ts-node scripts/backup_db.ts; then
        echo "✅ JSON backup created successfully"
    else
        echo "⚠️  JSON backup failed (non-critical, continuing...)"
    fi
else
    echo "⚠️  Skipping JSON backup (database not yet initialized)"
fi

# Step 5: Launch Application
echo "================================================"
echo "🎉 Initialization complete! Starting application..."
echo "================================================"
exec node dist/index.js
