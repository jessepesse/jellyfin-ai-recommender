---
description: Pre-release checklist for GitHub releases
---

# GitHub Release Checklist

Follow these steps before creating a GitHub release to ensure a smooth deployment.

## 1. Security Audit
- [ ] Run security check: Verify no sensitive data (API keys, passwords, database files) will be pushed
- [ ] Check `.gitignore` coverage for `.env`, `*.db`, `data/`, `images/`
- [ ] Scan code for hardcoded secrets: `grep -r "api_key\|password\|secret" --include="*.ts" --include="*.tsx"`

## 2. Version Bump
- [ ] Update version in `backend/package.json`
- [ ] Update version in `frontend/package.json`
- [ ] Update version in `README.md` header
- [ ] Move "Unreleased" section to new version in `CHANGELOG.md`
- [ ] Add release date to CHANGELOG version header

## 3. Package Lock Sync ⚠️ CRITICAL
**Always check package-lock.json files before GitHub release!**

```bash
# Frontend
cd frontend
npm install
git status  # Check if package-lock.json changed

# Backend
cd backend
npm install
git status  # Check if package-lock.json changed
```

If `package-lock.json` files changed:
- [ ] Add and commit the updated lock files
- [ ] Push before creating the release tag

**Why:** GitHub Actions uses `npm ci` which requires exact sync between `package.json` and `package-lock.json`. Mismatched lock files will cause CI build failures.

## 4. Commit and Tag
```bash
# Commit version bump
git add backend/package.json frontend/package.json README.md CHANGELOG.md
git commit -m "chore: bump version to X.Y.Z"

# Commit lock files if needed
git add frontend/package-lock.json backend/package-lock.json
git commit -m "chore: update package-lock.json files"

# Push commits
git push

# Create and push tag
git tag vX.Y.Z
git push origin vX.Y.Z
```

## 5. GitHub Actions
- [ ] Monitor GitHub Actions workflow: https://github.com/jessepesse/jellyfin-ai-recommender/actions
- [ ] Verify Docker images build successfully
- [ ] Check that GitHub Release is created automatically

## 6. Post-Release
- [ ] Test Docker image pull: `docker pull ghcr.io/jessepesse/jellyfin-ai-recommender-frontend:latest`
- [ ] Verify release notes on GitHub
- [ ] Update deployment documentation if needed

## Common Issues

### npm ci fails with "Missing: package@version from lock file"
**Solution:** Run `npm install` in the affected directory and commit the updated `package-lock.json`

### Docker build fails
**Solution:** Check GitHub Actions logs for specific errors, usually related to dependencies or build configuration

### Release not created automatically
**Solution:** Verify GitHub Actions workflow has proper permissions and release configuration
