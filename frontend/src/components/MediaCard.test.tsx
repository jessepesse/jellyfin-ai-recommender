import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MediaCard from './MediaCard';
import type { JellyfinItem } from '../types';

// Mock API calls
vi.mock('../services/api', () => ({
    postActionWatched: vi.fn().mockResolvedValue({ success: true }),
    postActionWatchlist: vi.fn().mockResolvedValue({ success: true }),
    postActionBlock: vi.fn().mockResolvedValue({ success: true }),
    postJellyseerrRequest: vi.fn().mockResolvedValue({ success: true }),
    postRemoveFromWatchlist: vi.fn().mockResolvedValue({ success: true }),
}));

const mockMovie: JellyfinItem = {
    tmdbId: 550,
    title: 'Fight Club',
    posterUrl: '/images/movie_550_poster.jpg',
    mediaType: 'movie',
    releaseYear: '1999',
    overview: 'An insomniac office worker and a devil-may-care soap maker form an underground fight club.',
    backdropUrl: '/images/movie_550_backdrop.jpg',
    voteAverage: 8.4,
};

const mockTvShow: JellyfinItem = {
    tmdbId: 1399,
    title: 'Game of Thrones',
    posterUrl: '/images/tv_1399_poster.jpg',
    mediaType: 'tv',
    releaseYear: '2011',
    overview: 'Seven noble families fight for control of the mythical land of Westeros.',
    backdropUrl: null,
    voteAverage: 9.2,
};

describe('MediaCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders movie card with title and year', () => {
        render(<MediaCard item={mockMovie} />);

        expect(screen.getByText('Fight Club')).toBeInTheDocument();
        expect(screen.getByText('1999')).toBeInTheDocument();
    });

    it('renders TV show card with title', () => {
        render(<MediaCard item={mockTvShow} />);

        expect(screen.getByText('Game of Thrones')).toBeInTheDocument();
        expect(screen.getByText('2011')).toBeInTheDocument();
    });

    it('displays vote average when available', () => {
        render(<MediaCard item={mockMovie} />);

        // Rating should be displayed (8.4)
        expect(screen.getByText('8.4')).toBeInTheDocument();
    });

    it('shows action buttons in default variant', () => {
        render(<MediaCard item={mockMovie} variant="default" />);

        // Should have action buttons (icons) - check for button roles
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
    });

    it('calls onClick when card is clicked', async () => {
        const handleClick = vi.fn();
        render(<MediaCard item={mockMovie} onClick={handleClick} />);

        // Find clickable area (the card wrapper should be clickable)
        const title = screen.getByText('Fight Club');
        await userEvent.click(title);

        // onClick should have been called
        expect(handleClick).toHaveBeenCalledWith(mockMovie);
    });

    it('renders different layout for watchlist variant', () => {
        render(<MediaCard item={mockMovie} variant="watchlist" />);

        // Watchlist variant should still show title
        expect(screen.getByText('Fight Club')).toBeInTheDocument();
    });

    it('handles missing poster gracefully', () => {
        const itemWithoutPoster = { ...mockMovie, posterUrl: null };
        render(<MediaCard item={itemWithoutPoster} />);

        // Should still render title (may appear in multiple places)
        const titles = screen.getAllByText('Fight Club');
        expect(titles.length).toBeGreaterThan(0);
    });
});
