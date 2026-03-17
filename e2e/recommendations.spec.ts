import { test, expect } from './fixtures';

const MOCK_USER = { id: 'user-1', name: 'testuser', isAdmin: false };
const MOCK_TOKEN = 'test-token-e2e-abc';

const MOCK_ITEMS = [
    {
        tmdbId: 101,
        title: 'Inception',
        mediaType: 'movie',
        posterUrl: null,
        backdropUrl: null,
        releaseYear: '2010',
        voteAverage: 8.8,
        overview: 'A thief who steals corporate secrets through dream-sharing technology.',
        genres: ['Action', 'Science Fiction'],
    },
    {
        tmdbId: 102,
        title: 'Interstellar',
        mediaType: 'movie',
        posterUrl: null,
        backdropUrl: null,
        releaseYear: '2014',
        voteAverage: 8.6,
        overview: 'Astronauts travel through a wormhole near Saturn.',
        genres: ['Adventure', 'Science Fiction'],
    },
];

test.describe('Recommendations', () => {
    test.beforeEach(async ({ page }) => {
        // Inject authenticated state before the page loads
        await page.addInitScript(({ user, token }) => {
            localStorage.setItem('jellyfin_token', token);
            localStorage.setItem('jellyfin_user', JSON.stringify(user));
            localStorage.setItem('jellyfin_server', 'http://jellyfin-test');
            localStorage.setItem('jellyfin_isAdmin', 'false');
        }, { user: MOCK_USER, token: MOCK_TOKEN });

        // Core API mocks required for every test
        await page.route('**/api/system/status', route =>
            route.fulfill({ json: { configured: true } })
        );
        await page.route('**/api/auth/me', route =>
            route.fulfill({ json: { id: 1, username: 'testuser', isAdmin: false } })
        );
    });

    test('shows dashboard with filters and get recommendations button', async ({ page }) => {
        await page.route('**/api/recommendations**', route =>
            route.fulfill({ json: [] })
        );

        await page.goto('/', { waitUntil: 'domcontentloaded' });

        await expect(page.getByRole('heading', { name: 'Jellyfin AI Recommender' })).toBeVisible();
        await expect(page.getByText('Content Type')).toBeVisible();
        await expect(page.getByText('Genres')).toBeVisible();
        await expect(page.getByText('Mood')).toBeVisible();
        await expect(page.getByRole('button', { name: /Get Recommendations/i })).toBeVisible();
    });

    test('can switch between Movies and TV Series', async ({ page }) => {
        await page.route('**/api/recommendations**', route =>
            route.fulfill({ json: [] })
        );

        await page.goto('/', { waitUntil: 'domcontentloaded' });

        const moviesBtn = page.getByRole('button', { name: 'Movies' });
        const tvBtn = page.getByRole('button', { name: 'TV Series' });

        // Movies is selected by default
        await expect(moviesBtn).toHaveAttribute('aria-pressed', 'true');
        await expect(tvBtn).toHaveAttribute('aria-pressed', 'false');

        // Switch to TV Series
        await tvBtn.click();
        await expect(tvBtn).toHaveAttribute('aria-pressed', 'true');
        await expect(moviesBtn).toHaveAttribute('aria-pressed', 'false');
    });

    test('can toggle genre filter on and off', async ({ page }) => {
        await page.route('**/api/recommendations**', route =>
            route.fulfill({ json: [] })
        );

        await page.goto('/', { waitUntil: 'domcontentloaded' });

        const actionChip = page.getByRole('button', { name: 'Action' });

        // Not active initially
        await expect(actionChip).toHaveAttribute('aria-pressed', 'false');

        // Click to activate
        await actionChip.click();
        await expect(actionChip).toHaveAttribute('aria-pressed', 'true');

        // Click again to deactivate
        await actionChip.click();
        await expect(actionChip).toHaveAttribute('aria-pressed', 'false');
    });

    test('shows loading state while fetching recommendations', async ({ page }) => {
        // Slow initial load too
        await page.route('**/api/recommendations**', async route => {
            await new Promise(resolve => setTimeout(resolve, 500));
            await route.fulfill({ json: [] });
        });

        await page.goto('/', { waitUntil: 'domcontentloaded' });

        // Wait for initial silent load to finish, then trigger a refresh
        await page.waitForSelector('button:has-text("Get Recommendations")');
        await page.getByRole('button', { name: /Get Recommendations/i }).click();

        await expect(page.getByRole('button', { name: /Getting Recommendations/i })).toBeVisible();
    });

    test('displays recommendation cards after successful API response', async ({ page }) => {
        let callCount = 0;
        await page.route('**/api/recommendations**', route => {
            callCount++;
            // First call is the silent background load on mount (refresh=false)
            // Second call is the user-triggered refresh
            return route.fulfill({ json: callCount === 1 ? [] : MOCK_ITEMS });
        });

        await page.goto('/', { waitUntil: 'domcontentloaded' });

        await page.getByRole('button', { name: /Get Recommendations/i }).click();

        await expect(page.getByRole('heading', { name: 'Inception' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('heading', { name: 'Interstellar' }).first()).toBeVisible({ timeout: 5000 });
    });

    test('shows error message when recommendations API fails', async ({ page }) => {
        let callCount = 0;
        await page.route('**/api/recommendations**', route => {
            callCount++;
            if (callCount === 1) return route.fulfill({ json: [] }); // silent background load
            return route.fulfill({
                status: 500,
                json: { error: 'AI service unavailable' },
            });
        });

        await page.goto('/', { waitUntil: 'domcontentloaded' });

        await page.getByRole('button', { name: /Get Recommendations/i }).click();

        await expect(page.getByText(/unavailable|failed|error/i)).toBeVisible({ timeout: 5000 });
    });

    test('sends correct type parameter when TV Series is selected', async ({ page }) => {
        const capturedParams: URLSearchParams[] = [];

        await page.route('**/api/recommendations**', route => {
            const url = new URL(route.request().url());
            capturedParams.push(url.searchParams);
            return route.fulfill({ json: [] });
        });

        await page.goto('/', { waitUntil: 'domcontentloaded' });

        // Switch to TV and get recommendations
        await page.getByRole('button', { name: 'TV Series' }).click();
        await page.getByRole('button', { name: /Get Recommendations/i }).click();

        await page.waitForTimeout(300);

        // The last request should have type=tv
        const lastParams = capturedParams[capturedParams.length - 1];
        expect(lastParams.get('type')).toBe('tv');
    });
});
