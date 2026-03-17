/**
 * Shared test fixtures.
 *
 * Re-exports Playwright's test & expect so every spec imports from one place.
 * When Lightpanda matures (multi-page CDP support), the CDP fixture can be
 * enabled here without touching individual spec files.
 */
export { test, expect } from '@playwright/test';
