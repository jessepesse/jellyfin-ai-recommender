# Backup & Recovery Quick Reference

## 🚨 Emergency Recovery

### Database Corrupted or Missing Tables

```bash
# Automatic fix - just restart
docker-compose -f docker-compose.prod.yml restart backend

# Watch logs for schema sync
docker logs jellyfin-ai-backend -f
```

### Complete Data Loss (Have Backup)

1. Start fresh installation
2. Access Setup Wizard at http://your-ip:5173
3. Click "Restore from Backup"
4. Upload `backup_latest.json`
5. Test connections and save
6. Login with original username

### Want to Migrate to New Server

1. **Old Server**: Download `./data/backup_latest.json`
2. **New Server**: Use Setup Wizard to restore from backup

## 📋 Quick Commands

```bash
# Manual backup
docker exec jellyfin-ai-backend npm run db:backup

# View latest backup content
cat ./data/backup_latest.json | jq '.users[].username'

# Check backup files
ls -lh ./data/backup_*.json

# Verify database
docker exec jellyfin-ai-backend npx prisma db push --schema=/app/prisma/schema.prisma

# View startup logs
docker logs jellyfin-ai-backend | grep "🚀"
```

## 📂 File Locations

| File | Location | Purpose |
|------|----------|---------|
| Active Database | `./data/dev.db` | Current SQLite database |
| Startup Backup | `./data/dev.db.backup_startup` | Created before schema changes |
| Latest JSON | `./data/backup_latest.json` | Current portable backup |
| Timestamped JSON | `./data/backup_YYYY-MM-DD*.json` | Historical backups |

## ✅ Startup Checklist

Expected startup log sequence:

```
✅ 1. Ensuring data directory exists
✅ 2. Creating startup backup (if db exists)
✅ 3. Syncing database schema
✅ 4. Generating Prisma Client
✅ 5. Creating JSON backup
✅ 6. Starting application
```

If any step fails, check:
- Disk space: `df -h`
- Permissions: `ls -la ./data`
- Logs: `docker logs jellyfin-ai-backend`

## 🔐 Security Reminders

⚠️ Backups contain sensitive data:
- API keys
- Service URLs
- Watch history

**Best Practices**:
```bash
# Secure permissions
chmod 600 ./data/backup_*.json

# Encrypt before external storage
gpg -c backup_latest.json

# Never commit to git
echo "data/backup_*.json" >> .gitignore
```

## 📖 Full Documentation

For detailed procedures, troubleshooting, and advanced scenarios:
👉 See [BACKUP_RECOVERY.md](./BACKUP_RECOVERY.md)
