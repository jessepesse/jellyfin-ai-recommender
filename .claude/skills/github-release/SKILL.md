---
name: github-release
description: Create a new GitHub release with full local validation. Run before any version tag push.
disable-model-invocation: true
---

Create a GitHub release for this project. Follow every step in order — do not skip steps or push the tag before all checks pass.

## Step 1: Determine version

Ask the user what version to release if not provided as $ARGUMENTS. Follow semver:
- **patch** (x.y.Z) — bug fixes, dependency updates, maintenance
- **minor** (x.Y.0) — new features, backwards compatible
- **major** (X.0.0) — breaking changes

## Step 2: Local pre-flight checks

Run ALL of these before touching any files. If any check fails, stop and fix before continuing.

### 2a. Tests
```bash
npm test
```
All tests must pass. Fix failures before proceeding.

### 2b. Frontend lint
```bash
npm run lint --prefix frontend
```
Must have 0 errors (warnings are ok).

### 2c. Backend TypeScript build
```bash
npm run build --prefix backend
```
Must compile without errors.

### 2d. Frontend TypeScript build
```bash
npm run build --prefix frontend
```
Must build without errors.

### 2e. Lockfile sync — CRITICAL
Run `npm install` in all three locations and check if lockfiles changed:
```bash
npm install
npm install --prefix backend
npm install --prefix frontend
git status -- package-lock.json backend/package-lock.json frontend/package-lock.json
```
If any lockfile changed: commit it now before proceeding. Stale lockfiles cause Docker build failures in GitHub Actions.

### 2f. Peer dependency check
Check for version mismatches in related package families:
```bash
# Check vitest family alignment
grep -E '"vitest"|"@vitest/' frontend/package.json backend/package.json package.json
```
All `vitest` and `@vitest/*` versions must match within each package.

### 2g. Docker builds — CRITICAL
```bash
docker build -f backend/Dockerfile . 2>&1 | tail -5
docker build -f frontend/Dockerfile . 2>&1 | tail -5
```
Both must succeed. If either fails with `npm error`, the lockfile or a peer dependency is out of sync — fix it before tagging.

## Step 3: Version bump

Update version to NEW_VERSION in all three files:
- `package.json`
- `backend/package.json`
- `frontend/package.json`

## Step 4: Update CHANGELOG.md

Move content from `## [Unreleased]` to a new section:
```
## [NEW_VERSION] - YYYY-MM-DD
```
Include all changes since the last release grouped by: ✨ New Features, 🚀 Improvements, 🐛 Bug Fixes, 🔒 Security, 🔧 Maintenance.

## Step 5: Commit and push

```bash
git add package.json backend/package.json frontend/package.json CHANGELOG.md
# Include lockfiles only if they changed in step 2e
git commit -m "chore: release vNEW_VERSION"
git push
```

Wait for CI to pass on main before tagging. Check: `gh run list --limit 3`

## Step 6: Create GitHub release

```bash
gh release create vNEW_VERSION --title "vNEW_VERSION" --notes "..."
```

Release notes must include:
- All changes from the CHANGELOG entry for this version
- Full changelog link: `https://github.com/jessepesse/jellyfin-ai-recommender/compare/vPREV_VERSION...vNEW_VERSION`

## Step 7: Verify

Check that GitHub Actions docker-build workflow passes:
```bash
gh run list --limit 5
```

If the Docker build fails in CI but passed locally, the most likely cause is a stale lockfile — run step 2e again, commit, and push.
