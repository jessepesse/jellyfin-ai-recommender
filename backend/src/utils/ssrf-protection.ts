/**
 * SSRF (Server-Side Request Forgery) Protection Utilities
 *
 * Validates and sanitizes URLs to prevent malicious requests to:
 * - Cloud metadata endpoints (AWS, GCP, Azure, Alibaba)
 * - Link-local and loopback addresses
 * - RFC 1918 private IP ranges (async DNS-resolved validation)
 * - Non-HTTP protocols
 *
 * Two tiers of validation:
 *   Sync  – sanitizeUrl / sanitizeConfigUrl / validateRequestUrl / validateSafeUrl / validateBaseUrl
 *            Block known-bad hostnames; allow private IPs for self-hosted services.
 *   Async – validateExternalUrl
 *            Full DNS resolution; blocks RFC 1918 + link-local for untrusted, user-supplied URLs
 *            (e.g. the image-proxy path parameter).
 */

import dns from 'dns';
import { promisify } from 'util';

const dnsLookup = promisify(dns.lookup);

// ---------------------------------------------------------------------------
// Blocked hostname list – enforced in ALL validators (sync + async)
// ---------------------------------------------------------------------------
const BLOCKED_HOSTS = [
    '169.254.169.254',           // AWS / Azure IMDS
    'metadata.google.internal',  // GCP metadata
    '100.100.100.200',           // Alibaba Cloud metadata
    'fd00:ec2::254',             // AWS IPv6 IMDS
    'metadata',                  // Generic metadata hostname
];

// ---------------------------------------------------------------------------
// Private / reserved IP ranges – enforced only in validateExternalUrl (async)
// These are intentionally NOT blocked in sync validators because self-hosted
// Jellyfin / Jellyseerr instances commonly live on RFC 1918 addresses.
// ---------------------------------------------------------------------------
const PRIVATE_IP_PATTERNS: RegExp[] = [
    /^127\./,                        // IPv4 loopback
    /^::1$/,                         // IPv6 loopback
    /^0\./,                          // "This" network
    /^169\.254\./,                   // IPv4 link-local
    /^fe80:/i,                       // IPv6 link-local
    /^10\./,                         // RFC 1918
    /^192\.168\./,                   // RFC 1918
    /^172\.(1[6-9]|2\d|3[01])\./,   // RFC 1918
    /^100\.64\./,                    // CGNAT / shared address space (RFC 6598)
    /^fc00:/i,                       // IPv6 ULA
    /^fd[0-9a-f]{2}:/i,             // IPv6 ULA
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isBlockedHostname(hostname: string): boolean {
    return BLOCKED_HOSTS.includes(hostname.toLowerCase());
}

function isPrivateIp(address: string): boolean {
    return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(address));
}

function stripTrailingSlashesAndFragments(raw: string): string {
    let s = raw.trim();
    const hashIdx = s.indexOf('#');
    if (hashIdx !== -1) s = s.slice(0, hashIdx);
    while (s.endsWith('/')) s = s.slice(0, -1);
    return s;
}

// ---------------------------------------------------------------------------
// Sync validators (permissive: allow private IPs, block known-bad hostnames)
// ---------------------------------------------------------------------------

/**
 * Validates a user-configured service URL (Jellyfin / Jellyseerr).
 * Permissive: accepts private-network http/https URLs for self-hosted setups.
 * Blocks known cloud-metadata hostnames.
 */
export function sanitizeConfigUrl(url?: string): string | undefined {
    if (!url || url === 'none' || url.length === 0) return undefined;

    try {
        const trimmed = stripTrailingSlashesAndFragments(url);
        const parsed = new URL(trimmed);

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            console.warn(`[SSRF] Blocked non-HTTP protocol in config URL: ${parsed.protocol}`);
            return undefined;
        }

        if (isBlockedHostname(parsed.hostname)) {
            console.warn(`[SSRF] Blocked hostname in config URL: ${parsed.hostname}`);
            return undefined;
        }

        const cleanUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
        console.debug(`[SSRF] Config URL accepted: ${cleanUrl}`);
        return cleanUrl;
    } catch (err) {
        console.warn(`[SSRF] Invalid URL format in config: ${url}`, err);
        return undefined;
    }
}

/**
 * Validates and sanitizes a URL for SSRF protection.
 * Permissive: accepts private-network http/https URLs for self-hosted setups.
 * Blocks known cloud-metadata hostnames.
 */
export function sanitizeUrl(url?: string): string | undefined {
    if (!url || url === 'none' || url.length === 0) return undefined;

    try {
        let trimmed = stripTrailingSlashesAndFragments(url);
        const parsed = new URL(trimmed);

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            console.warn(`[SSRF] Blocked non-HTTP protocol: ${parsed.protocol}`);
            return undefined;
        }

        if (isBlockedHostname(parsed.hostname)) {
            console.warn(`[SSRF] Blocked hostname: ${parsed.hostname}`);
            return undefined;
        }

        // Reconstruct URL from validated components to break taint chain
        let cleanUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
        while (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);
        return cleanUrl;
    } catch (err) {
        console.warn('[SSRF] Invalid URL format');
        return undefined;
    }
}

/**
 * Validates a URL and throws an error if invalid.
 * Useful for critical operations that should fail fast.
 */
export function requireSafeUrl(url: string, label: string = 'URL'): string {
    const sanitized = sanitizeUrl(url);
    if (!sanitized) {
        throw new Error(`${label} is invalid or blocked for security reasons`);
    }
    return sanitized;
}

/**
 * Validates a complete URL immediately before an HTTP request.
 * Blocks known cloud-metadata hostnames; allows private IPs (self-hosted).
 */
export function validateRequestUrl(fullUrl: string): string {
    try {
        const parsed = new URL(fullUrl);

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error(`Invalid protocol: ${parsed.protocol}. Must be http or https.`);
        }

        if (isBlockedHostname(parsed.hostname)) {
            throw new Error(`Blocked hostname: ${parsed.hostname}`);
        }

        return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
    } catch (error) {
        throw new Error(`Request URL is invalid or blocked for security reasons: ${fullUrl}`);
    }
}

/**
 * Creates a validated base URL for use with axios instances.
 * Blocks known cloud-metadata hostnames; allows private IPs (self-hosted).
 */
export function validateBaseUrl(baseUrl: string): string {
    try {
        const parsed = new URL(baseUrl);

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error(`Invalid protocol: ${parsed.protocol}. Must be http or https.`);
        }

        if (isBlockedHostname(parsed.hostname)) {
            throw new Error(`Blocked hostname: ${parsed.hostname}`);
        }

        return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
    } catch (error) {
        throw new Error(`Base URL is invalid or blocked for security reasons: ${baseUrl}`);
    }
}

/**
 * Explicit runtime validation immediately before axios calls.
 * Blocks known cloud-metadata hostnames; allows private IPs (self-hosted).
 *
 * @codeql-sanitizer This function is a custom sanitizer for SSRF (Server-Side Request Forgery)
 * @codeql-sanitizer-kind url-validation
 */
export function validateSafeUrl(url: string): string {
    try {
        const parsed = new URL(url);

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error(`Invalid protocol: ${parsed.protocol}. Must be http or https.`);
        }

        if (isBlockedHostname(parsed.hostname)) {
            throw new Error(`Blocked hostname: ${parsed.hostname}`);
        }

        return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
    } catch (error) {
        throw new Error(`URL validation failed before HTTP request: ${url}`);
    }
}

// ---------------------------------------------------------------------------
// Async validator (strict: blocks RFC 1918 + link-local via DNS resolution)
// Use this for untrusted, user-supplied URLs — e.g. the image-proxy endpoint.
// ---------------------------------------------------------------------------

/**
 * Strict SSRF validator for untrusted, user-supplied URLs.
 *
 * Resolves the hostname via DNS and rejects:
 *   - Non-HTTP/HTTPS protocols
 *   - Known cloud-metadata hostnames
 *   - Any hostname that resolves to an RFC 1918 / link-local / loopback address
 *
 * NOTE: Do NOT use this for configured Jellyfin/Jellyseerr service URLs —
 * those intentionally live on private networks. Use sanitizeConfigUrl instead.
 *
 * @throws Error if the URL is invalid, blocked, or resolves to a private IP.
 */
export async function validateExternalUrl(url: string): Promise<string> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`[SSRF] Invalid URL format: ${url}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`[SSRF] Blocked protocol: ${parsed.protocol}`);
    }

    const hostname = parsed.hostname.toLowerCase();

    if (isBlockedHostname(hostname)) {
        throw new Error(`[SSRF] Blocked hostname: ${hostname}`);
    }

    // Resolve hostname → IP and reject private ranges.
    // dns.lookup uses the OS resolver (respects /etc/hosts), matching what
    // Node's http client would actually connect to.
    let resolvedAddress: string;
    try {
        const result = await dnsLookup(hostname, { family: 4 });
        resolvedAddress = result.address;
    } catch {
        // Could not resolve – fail closed
        throw new Error(`[SSRF] DNS resolution failed for hostname: ${hostname}`);
    }

    if (isPrivateIp(resolvedAddress)) {
        throw new Error(
            `[SSRF] Blocked: hostname "${hostname}" resolves to private IP ${resolvedAddress}`
        );
    }

    // Reconstruct from parsed components to break taint chain
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
}

// ---------------------------------------------------------------------------
// Get additional allowed domains from environment variable (unused in
// enforcement but kept for future allowlist extension)
// ---------------------------------------------------------------------------
export const ADDITIONAL_ALLOWED_DOMAINS: string[] = process.env.ALLOWED_IMAGE_DOMAINS
    ? process.env.ALLOWED_IMAGE_DOMAINS.split(',').map(d => d.trim().toLowerCase())
    : [];
