#!/bin/sh
set -e

echo "🚀 Starting Jellyfin AI Recommender Backend..."
echo "================================================"

# Configuration
DATA_DIR="${DATA_DIR:-/app/data}"
DB_PATH="$DATA_DIR/dev.db"
BACKUP_STARTUP="$DATA_DIR/dev.db.backup_startup"
PRISMA_DIR="/app/prisma"

# Ensure data directory exists
echo "📁 Ensuring data directory exists: $DATA_DIR"
mkdir -p "$DATA_DIR"

# Step 1: Raw Database Backup (if database exists)
if [ -f "$DB_PATH" ]; then
    echo "💾 Creating startup backup: $BACKUP_STARTUP"
    cp "$DB_PATH" "$BACKUP_STARTUP"
    echo "✅ Startup backup created successfully"
else
    echo "⚠️  No existing database found at $DB_PATH (fresh install)"
fi

# Step 2: Schema Sync with Prisma DB Push
echo "🔄 Syncing database schema..."
echo "   Running: npx prisma db push --accept-data-loss"
if npx prisma db push --accept-data-loss --schema="$PRISMA_DIR/schema.prisma"; then
    echo "✅ Database schema synced successfully"
else
    echo "❌ Schema sync failed!"
    exit 1
fi

# Step 3: Generate Prisma Client
echo "🔧 Generating Prisma Client..."
if npx prisma generate --schema="$PRISMA_DIR/schema.prisma"; then
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
