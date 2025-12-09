import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';

// Mock the API service
vi.mock('./services/api', () => ({
    getSystemStatus: vi.fn(),
}));

import { getSystemStatus } from './services/api';

describe('App', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Clear localStorage between tests
        localStorage.clear();
        sessionStorage.clear();
    });

    it('renders loading spinner initially', () => {
        // Mock a pending promise to keep loading state
        vi.mocked(getSystemStatus).mockImplementation(() => new Promise(() => { }));

        render(
            <AuthProvider>
                <App />
            </AuthProvider>
        );

        // Should show loading spinner (the spinning div)
        const spinner = document.querySelector('.animate-spin');
        expect(spinner).toBeInTheDocument();
    });

    it('shows setup wizard when system is not configured', async () => {
        vi.mocked(getSystemStatus).mockResolvedValue({ configured: false });

        render(
            <AuthProvider>
                <App />
            </AuthProvider>
        );

        // Wait for the setup wizard to appear
        await waitFor(() => {
            // SetupWizard should have some identifiable content
            expect(screen.getByText(/setup/i)).toBeInTheDocument();
        });
    });

    it('shows login when system is configured but user not authenticated', async () => {
        vi.mocked(getSystemStatus).mockResolvedValue({ configured: true });

        render(
            <AuthProvider>
                <App />
            </AuthProvider>
        );

        // Wait for the login form to appear
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
        });
    });
});
