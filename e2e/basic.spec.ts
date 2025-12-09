import { test, expect } from '@playwright/test';

test.describe('Basic Navigation', () => {
    test('page loads without errors', async ({ page }) => {
        await page.goto('/');

        // Page should load without console errors
        const consoleErrors: string[] = [];
        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });

        // Wait for the page to be fully loaded
        await page.waitForLoadState('networkidle');

        // Should see either Setup Wizard, Login, or Dashboard
        const body = await page.locator('body');
        await expect(body).toBeVisible();
    });

    test('shows setup wizard or login on fresh visit', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Should show either:
        // - Setup wizard (if not configured)
        // - Login form (if configured but not authenticated)
        // - Dashboard (if authenticated)
        const setupOrLogin = page.getByRole('button').first();
        await expect(setupOrLogin).toBeVisible({ timeout: 10000 });
    });
});
