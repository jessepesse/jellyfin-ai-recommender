import { describe, it, expect } from 'vitest';
import {
    sanitizeUrl,
    sanitizeConfigUrl,
    requireSafeUrl,
    validateRequestUrl,
    validateBaseUrl,
    validateSafeUrl,
} from './ssrf-protection';

describe('SSRF Protection', () => {
    describe('sanitizeUrl', () => {
        it('should accept valid http URLs', () => {
            expect(sanitizeUrl('http://localhost:3001')).toBe('http://localhost:3001');
            expect(sanitizeUrl('http://192.168.1.100:8096')).toBe('http://192.168.1.100:8096');
        });

        it('should accept valid https URLs', () => {
            expect(sanitizeUrl('https://example.com')).toBe('https://example.com');
            // Note: URL parsing normalizes port 443 away for https
            expect(sanitizeUrl('https://jellyfin.mydomain.com:443')).toBe('https://jellyfin.mydomain.com');
        });

        it('should remove trailing slashes', () => {
            expect(sanitizeUrl('http://localhost:3001/')).toBe('http://localhost:3001');
            expect(sanitizeUrl('http://localhost:3001///')).toBe('http://localhost:3001');
        });

        it('should remove fragments', () => {
            expect(sanitizeUrl('http://localhost:3001#section')).toBe('http://localhost:3001');
        });

        it('should preserve paths and query strings', () => {
            expect(sanitizeUrl('http://localhost:3001/api/v1?key=value')).toBe('http://localhost:3001/api/v1?key=value');
        });

        it('should reject non-HTTP protocols', () => {
            expect(sanitizeUrl('file:///etc/passwd')).toBeUndefined();
            expect(sanitizeUrl('ftp://example.com')).toBeUndefined();
            expect(sanitizeUrl('javascript:alert(1)')).toBeUndefined();
        });

        it('should return undefined for empty or invalid URLs', () => {
            expect(sanitizeUrl('')).toBeUndefined();
            expect(sanitizeUrl('none')).toBeUndefined();
            expect(sanitizeUrl('not-a-url')).toBeUndefined();
            expect(sanitizeUrl(undefined)).toBeUndefined();
        });
    });

    describe('sanitizeConfigUrl', () => {
        it('should accept valid config URLs', () => {
            // Note: sanitizeConfigUrl includes trailing slash from URL parsing for paths
            const result1 = sanitizeConfigUrl('http://jellyfin.local:8096');
            expect(result1).toContain('http://jellyfin.local:8096');

            const result2 = sanitizeConfigUrl('https://jellyseerr.example.com');
            expect(result2).toContain('https://jellyseerr.example.com');
        });

        it('should handle trailing slashes', () => {
            const result = sanitizeConfigUrl('http://localhost:8096/');
            expect(result).toBeDefined();
            expect(result).toContain('http://localhost:8096');
        });

        it('should reject non-HTTP protocols', () => {
            expect(sanitizeConfigUrl('file:///etc/passwd')).toBeUndefined();
        });

        it('should return undefined for empty values', () => {
            expect(sanitizeConfigUrl('')).toBeUndefined();
            expect(sanitizeConfigUrl('none')).toBeUndefined();
            expect(sanitizeConfigUrl(undefined)).toBeUndefined();
        });
    });

    describe('requireSafeUrl', () => {
        it('should return validated URL for valid input', () => {
            expect(requireSafeUrl('http://localhost:3001', 'Test URL')).toBe('http://localhost:3001');
        });

        it('should throw error for invalid URLs', () => {
            expect(() => requireSafeUrl('not-a-url', 'Test URL')).toThrow('Test URL is invalid or blocked');
            expect(() => requireSafeUrl('file:///etc/passwd', 'Config')).toThrow('Config is invalid or blocked');
        });
    });

    describe('validateRequestUrl', () => {
        it('should accept valid HTTP/HTTPS URLs', () => {
            expect(validateRequestUrl('http://localhost:3001/api/test')).toBe('http://localhost:3001/api/test');
            expect(validateRequestUrl('https://api.example.com/v1/data')).toBe('https://api.example.com/v1/data');
        });

        it('should throw for non-HTTP protocols', () => {
            expect(() => validateRequestUrl('ftp://example.com/file')).toThrow('invalid or blocked');
            expect(() => validateRequestUrl('file:///etc/passwd')).toThrow('invalid or blocked');
        });

        it('should throw for invalid URLs', () => {
            expect(() => validateRequestUrl('not-a-valid-url')).toThrow('invalid or blocked');
        });
    });

    describe('validateBaseUrl', () => {
        it('should accept valid base URLs', () => {
            // Note: URL parsing adds trailing slash to root paths
            const result1 = validateBaseUrl('http://localhost:3001');
            expect(result1).toContain('http://localhost:3001');

            const result2 = validateBaseUrl('https://jellyfin.example.com');
            expect(result2).toContain('https://jellyfin.example.com');
        });

        it('should throw for non-HTTP protocols', () => {
            expect(() => validateBaseUrl('ftp://example.com')).toThrow('invalid or blocked');
        });

        it('should throw for invalid URLs', () => {
            expect(() => validateBaseUrl('invalid-url')).toThrow('invalid or blocked');
        });
    });

    describe('validateSafeUrl', () => {
        it('should accept and return valid URLs', () => {
            const url = 'http://localhost:3001/api/test';
            expect(validateSafeUrl(url)).toBe(url);
        });

        it('should reconstruct URL to break taint chain', () => {
            const result = validateSafeUrl('https://example.com:8080/path?query=1');
            expect(result).toBe('https://example.com:8080/path?query=1');
        });

        it('should throw for non-HTTP protocols', () => {
            expect(() => validateSafeUrl('file:///etc/passwd')).toThrow('URL validation failed');
            expect(() => validateSafeUrl('javascript:void(0)')).toThrow();
        });

        it('should throw for malformed URLs', () => {
            expect(() => validateSafeUrl('not-a-url')).toThrow('URL validation failed');
        });
    });
});
