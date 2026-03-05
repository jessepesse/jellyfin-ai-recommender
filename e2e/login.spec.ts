import { test, expect } from '@playwright/test';

test.describe('Login', () => {
    test.beforeEach(async ({ page }) => {
        // System is configured, so the login form is shown (not the setup wizard)
        await page.route('**/api/system/status', route =>
            route.fulfill({ json: { configured: true } })
        );
        // Pre-fill endpoint: return empty server URL so nothing is pre-filled
        await page.route('**/api/system/setup-defaults', route =>
            route.fulfill({ json: { jellyfinUrl: '' } })
        );
    });

    test('shows login form with username, password and submit button', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await expect(page.locator('#username')).toBeVisible();
        await expect(page.locator('#password')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    });

    test('shows loading state while submitting', async ({ page }) => {
        // Slow response so we can catch the loading state
        await page.route('**/api/auth/login', async route => {
            await new Promise(resolve => setTimeout(resolve, 600));
            await route.fulfill({ status: 401, json: { message: 'Invalid credentials' } });
        });

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await page.locator('#username').fill('testuser');
        await page.locator('#password').fill('wrongpassword');
        await page.getByRole('button', { name: 'Sign In' }).click();

        await expect(page.getByRole('button', { name: 'Signing in...' })).toBeVisible();
    });

    test('shows error message on invalid credentials', async ({ page }) => {
        await page.route('**/api/auth/login', route =>
            route.fulfill({
                status: 401,
                json: { message: 'Invalid username or password' },
            })
        );

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await page.locator('#username').fill('baduser');
        await page.locator('#password').fill('badpassword');
        await page.getByRole('button', { name: 'Sign In' }).click();

        await expect(page.getByText('Invalid username or password')).toBeVisible({ timeout: 5000 });
    });

    test('redirects to dashboard after successful login', async ({ page }) => {
        await page.route('**/api/auth/login', route =>
            route.fulfill({
                json: {
                    success: true,
                    jellyfinAuth: {
                        User: { Id: 'user-1', Name: 'testuser' },
                        AccessToken: 'token-abc-123',
                    },
                    isAdmin: false,
                    serverUrl: 'http://jellyfin-test',
                },
            })
        );
        await page.route('**/api/auth/me', route =>
            route.fulfill({ json: { id: 1, username: 'testuser', isAdmin: false } })
        );
        await page.route('**/api/recommendations**', route =>
            route.fulfill({ json: [] })
        );

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await page.locator('#username').fill('testuser');
        await page.locator('#password').fill('correctpassword');
        await page.getByRole('button', { name: 'Sign In' }).click();

        await expect(page.getByText('Jellyfin AI Recommender')).toBeVisible({ timeout: 5000 });
    });
});
