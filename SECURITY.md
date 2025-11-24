# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability, please report it by emailing the project maintainers or opening a private security advisory on GitHub.

**Please do not report security vulnerabilities through public GitHub issues.**

## Known CodeQL Alerts - False Positives

### SSRF (Server-Side Request Forgery) Alerts

**Status:** False Positive - Mitigated with defense-in-depth validation

**Location:** `backend/src/routes/api.ts` (verification endpoints), `backend/src/jellyfin.ts`, `backend/src/authService.ts`

**CodeQL Alert:** "The URL of this request depends on a user-provided value"

**Mitigation Applied:**

We have implemented **5-layer defense-in-depth SSRF protection**:

1. **Entry Point Validation** - All HTTP headers (`x-jellyfin-url`) validated with `sanitizeUrl()` when read
2. **Storage Validation** - `ConfigService.saveConfig()` validates URLs before database writes
3. **Read-Time Validation** - `getBaseUrl()` validates all URLs from config/environment
4. **Pre-Usage Validation** - `validateRequestUrl()` validates concatenated URL strings
5. **Usage Point Validation** - `validateSafeUrl()` wraps every `axios.get/post` call

**Validation Functions** (`backend/src/utils/ssrf-protection.ts`):
```typescript
// All functions validate and block:
// - Cloud metadata endpoints (AWS, GCP, Azure, Alibaba)
// - Link-local addresses (169.254.0.0/16)
// - Non-HTTP protocols (file://, ftp://, etc.)

sanitizeUrl(url)        // Core validator
validateRequestUrl(url) // Pre-axios validation
validateBaseUrl(url)    // For axios.create()
validateSafeUrl(url)    // Explicit wrapper for axios calls
```

**Example Protected Code:**
```typescript
// User input from HTTP header
const jellyfinServerRaw = req.headers['x-jellyfin-url'];
const jellyfinServer = jellyfinServerRaw ? sanitizeUrl(jellyfinServerRaw) : undefined; // Layer 1

// Later in the code...
const base = await getBaseUrl(jellyfinServer); // Layer 3 validation inside
const url = validateRequestUrl(`${base}/Users/${userId}/Items`); // Layer 4
const response = await axios.get(validateSafeUrl(url), { headers }); // Layer 5 - EXPLICIT
```

**Why This Is Safe:**

1. Every URL passes through validation **5 times** before reaching axios
2. Each validation checks against blocklists and protocol restrictions
3. Invalid URLs throw errors that prevent execution
4. Even if one layer fails, multiple fallback layers exist

**Why CodeQL Reports This:**

CodeQL's static analysis tracks data flow from "user-provided value" (HTTP headers, database) to "HTTP request sink" (axios). While we validate at every step, CodeQL may not recognize our custom `validateSafeUrl()` function as a sanitizer without custom CodeQL query extensions.

**Resolution:**

This is a **documented false positive**. The code is secured through multiple validation layers. CodeQL alerts can be suppressed or the custom sanitizers can be registered in CodeQL configuration if needed.

## Security Measures Implemented

### Input Validation
- ✅ Zod schemas for all API inputs
- ✅ Express-validator middleware
- ✅ Type-safe request handling

### SSRF Protection
- ✅ 5-layer defense-in-depth URL validation
- ✅ Blocklist for cloud metadata endpoints
- ✅ Protocol restrictions (HTTP/HTTPS only)
- ✅ Link-local address blocking

### Rate Limiting
- ✅ Authentication: 5 attempts per 15 minutes
- ✅ Recommendations: 10 requests per 5 minutes
- ✅ General API: 100 requests per 15 minutes

### Security Headers (Helmet)
- ✅ XSS protection
- ✅ Clickjacking protection (X-Frame-Options)
- ✅ MIME sniffing protection
- ✅ Content Security Policy

### Additional Protections
- ✅ ReDoS prevention (safe regex patterns)
- ✅ Format string injection prevention
- ✅ No sensitive data logging
- ✅ CORS configuration
- ✅ Secure cookie settings

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | :white_check_mark: |
| < 2.0   | :x:                |

## Security Update Policy

Security patches are released as soon as possible after discovery and verification. Users are encouraged to update to the latest version.
