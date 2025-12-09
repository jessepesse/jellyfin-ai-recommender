import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from './Login';

// Mock the auth context
const mockLogin = vi.fn();

vi.mock('../contexts/AuthContext', async (importOriginal) => {
    const actual = await importOriginal() as object;
    return {
        ...actual,
        useAuth: () => ({
            login: mockLogin,
            user: null,
            isAuthenticated: false,
            token: null,
            serverUrl: null,
            logout: vi.fn(),
        }),
    };
});

describe('Login', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLogin.mockReset();
    });

    it('renders login form with all elements', () => {
        render(<Login />);

        expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
        expect(screen.getByAltText(/jellyfin ai/i)).toBeInTheDocument();
    });

    it('allows user to type in username and password fields', async () => {
        render(<Login />);

        const usernameInput = screen.getByLabelText(/username/i);
        const passwordInput = screen.getByLabelText(/password/i);

        await userEvent.type(usernameInput, 'testuser');
        await userEvent.type(passwordInput, 'testpass');

        expect(usernameInput).toHaveValue('testuser');
        expect(passwordInput).toHaveValue('testpass');
    });

    it('calls login function on form submit', async () => {
        mockLogin.mockResolvedValue(true);
        render(<Login />);

        await userEvent.type(screen.getByLabelText(/username/i), 'testuser');
        await userEvent.type(screen.getByLabelText(/password/i), 'testpass');
        await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

        await waitFor(() => {
            expect(mockLogin).toHaveBeenCalledWith('testuser', 'testpass');
        });
    });

    it('shows error message on failed login', async () => {
        mockLogin.mockResolvedValue(false);
        render(<Login />);

        await userEvent.type(screen.getByLabelText(/username/i), 'wronguser');
        await userEvent.type(screen.getByLabelText(/password/i), 'wrongpass');
        await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

        await waitFor(() => {
            expect(screen.getByText(/invalid username or password/i)).toBeInTheDocument();
        });
    });

    it('disables submit button while submitting', async () => {
        // Make login never resolve to keep submitting state
        mockLogin.mockImplementation(() => new Promise(() => { }));
        render(<Login />);

        await userEvent.type(screen.getByLabelText(/username/i), 'test');
        await userEvent.type(screen.getByLabelText(/password/i), 'test');

        const submitButton = screen.getByRole('button', { name: /sign in/i });
        await userEvent.click(submitButton);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
        });
    });
});
