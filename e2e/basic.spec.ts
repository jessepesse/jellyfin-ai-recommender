import { test, expect } from './fixtures';

test.describe('Basic Navigation', () => {
    test('page loads without console errors', async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });

        await page.goto('/', { waitUntil: 'domcontentloaded' });

        const body = await page.locator('body');
        await expect(body).toBeVisible();

        expect(consoleErrors).toEqual([]);
    });

    test('shows setup wizard or login on fresh visit', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        // Should show either the setup wizard or the login form
        const setupHeading = page.getByRole('heading', { name: /setup/i });
        const signInButton = page.getByRole('button', { name: /sign in/i });

        await expect(setupHeading.or(signInButton)).toBeVisible({ timeout: 10000 });
    });
});
