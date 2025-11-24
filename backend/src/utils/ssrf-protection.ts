/**
 * SSRF (Server-Side Request Forgery) Protection Utilities
 * 
 * Validates and sanitizes URLs to prevent malicious requests to:
 * - Cloud metadata endpoints (AWS, GCP, Azure)
 * - Link-local addresses
 * - Non-HTTP protocols
 * 
 * While allowing legitimate self-hosted servers (local IPs, domains)
 */

const BLOCKED_HOSTS = [
    '169.254.169.254',           // AWS/Azure metadata
    'metadata.google.internal',  // GCP metadata
    '100.100.100.200',           // Alibaba Cloud
    'fd00:ec2::254',             // AWS IPv6 metadata
    'metadata',                   // Generic metadata hostname
];

/**
 * Validates and sanitizes a URL for SSRF protection
 * @param url - Raw URL string to validate
 * @returns Sanitized URL string or undefined if invalid/blocked
 */
export function sanitizeUrl(url?: string): string | undefined {
    if (!url || url === 'none' || url.length === 0) return undefined;
    
    try {
        const trimmed = url.trim().replace(/\/+$/, '').replace(/#.*$/, '');
        const parsed = new URL(trimmed);
        
        // Only allow http/https protocols
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            console.warn(`[SSRF] Blocked non-HTTP protocol: ${parsed.protocol} in ${url}`);
            return undefined;
        }
        
        // Block known cloud metadata endpoints
        const hostname = parsed.hostname.toLowerCase();
        if (BLOCKED_HOSTS.some(blocked => hostname === blocked || hostname.endsWith(`.${blocked}`))) {
            console.warn(`[SSRF] Blocked metadata endpoint: ${hostname}`);
            return undefined;
        }
        
        // Block link-local addresses (169.254.0.0/16) - common SSRF vector
        if (hostname.startsWith('169.254.')) {
            console.warn(`[SSRF] Blocked link-local address: ${hostname}`);
            return undefined;
        }
        
        // Allow everything else (localhost, private IPs, domains)
        return trimmed;
    } catch (err) {
        console.warn(`[SSRF] Invalid URL format: ${url}`);
        return undefined;
    }
}

/**
 * Validates a URL and throws an error if invalid
 * Useful for critical operations that should fail fast
 */
export function requireSafeUrl(url: string, label: string = 'URL'): string {
    const sanitized = sanitizeUrl(url);
    if (!sanitized) {
        throw new Error(`${label} is invalid or blocked for security reasons`);
    }
    return sanitized;
}
