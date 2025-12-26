# Database Migration Strategy

## Current Approach: `prisma db push` (Permanent)

This project uses `prisma db push` instead of `prisma migrate deploy` for database schema management.

### Why `db push`?

This is the **recommended approach for Docker-based home servers and hobby projects** because:

1. **No Migration History Required**: `db push` compares the Prisma schema with the database and syncs them directly, without needing migration files or history
2. **Resilient to Changes**: Works even if:
   - Migration files are modified or deleted
   - Migration history is lost or corrupted
   - Upgrading between non-sequential versions
   - Database state is unknown
3. **Simpler Deployment**: No need to manage migration files, baseline databases, or resolve migration conflicts
4. **Docker-Friendly**: Perfect for containerized applications where the database persists but the container is ephemeral

### Trade-offs

**Pros:**
- ✅ Always works, regardless of database state
- ✅ No migration history to maintain
- ✅ Handles "violent" upgrades gracefully
- ✅ Simpler startup script
- ✅ No bootloops from migration errors

**Cons:**
- ⚠️ No audit trail of schema changes
- ⚠️ `--accept-data-loss` flag can drop data if schema changes require it (e.g., column type changes)
- ⚠️ Not suitable for large production databases with strict change control

### When to Use `migrate deploy` Instead

Use `prisma migrate deploy` if you need:
- Strict audit trail of all schema changes
- Ability to rollback specific migrations
- Custom SQL in migrations (data transformations)
- Multiple production environments that must stay in sync
- Enterprise-grade change control

For this project (home media server), `db push` is the right choice.

### Implementation

See `backend/start.sh`:
```bash
npx prisma db push --accept-data-loss
```

This command:
1. Reads `prisma/schema.prisma`
2. Compares it with the current database schema
3. Applies necessary changes to make them match
4. Accepts potential data loss (e.g., if removing columns)

### Backup Strategy

Since `db push` can potentially lose data:
- ✅ Automatic backup on every container start (`dev.db.backup_startup`)
- ✅ JSON export for portability
- ✅ See `BACKUP_RECOVERY.md` for details

### Migration from `migrate deploy`

If you previously used `migrate deploy`:
1. The migration history in `_prisma_migrations` table is now ignored
2. `db push` will sync the schema regardless of migration state
3. No manual intervention needed - just update and restart

### Future Schema Changes

When updating the Prisma schema:
1. Edit `backend/prisma/schema.prisma`
2. Test locally with `npx prisma db push`
3. Commit and deploy
4. Container restart will automatically sync the schema

No need to create or manage migration files!
