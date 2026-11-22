// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ContentCard } from '../src/components/content/ContentCard';
import {
  LibraryProvider,
  useLibrary,
  type LibraryEntry,
  type LibraryResult,
} from '../src/state/LibraryContext';
import { ToastProvider } from '../src/state/ToastContext';
import type { MovieItem } from '../src/types/content';

const movie: MovieItem = {
  id: 'movie-1',
  providerId: 'provider-1',
  providerName: 'Home server',
  categoryId: 'cat-1',
  categoryName: 'Action',
  title: 'Night Run',
  description: null,
  posterUrl: null,
  backdropUrl: null,
  year: 2024,
  genre: null,
  durationSec: null,
  createdAt: 0,
  updatedAt: 0,
};

const entry: LibraryEntry = {
  id: movie.id,
  kind: 'movie',
  title: movie.title,
  art: null,
  meta: 'Action · 2024',
  providerName: movie.providerName,
};

function renderFavoritesProbe() {
  const results: LibraryResult[] = [];
  function Probe() {
    const library = useLibrary();
    return (
      <div>
        <span data-testid="count">{library.favorites.length}</span>
        <button
          type="button"
          onClick={() => {
            results.push(library.toggleFavorite(entry));
          }}
        >
          Toggle
        </button>
      </div>
    );
  }
  render(
    <MemoryRouter>
      <LibraryProvider>
        <ToastProvider>
          <Probe />
        </ToastProvider>
      </LibraryProvider>
    </MemoryRouter>,
  );
  return results;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('optimistic library toggles', () => {
  it('applies a favorite immediately and persists it', () => {
    renderFavoritesProbe();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(JSON.parse(window.localStorage.getItem('veyro.library.v2') ?? '{}').favorites).toHaveLength(1);
  });

  it('rolls back the optimistic change when persistence fails', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const results = renderFavoritesProbe();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));

    expect(screen.getByTestId('count').textContent).toBe('0');
    expect(results[0]?.error).toMatch(/blocked local storage/i);
  });

  it('offers an undo after removing a favorite from a card', async () => {
    render(
      <MemoryRouter>
        <LibraryProvider>
          <ToastProvider>
            <ContentCard item={movie} kind="movie" spatialId="card" />
          </ToastProvider>
        </LibraryProvider>
      </MemoryRouter>,
    );

    const favorite = screen.getByRole('button', { name: 'Add Night Run to favorites' });
    fireEvent.click(favorite);
    expect(favorite.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Added .*Night Run.* to favorites/)).toBeTruthy();

    fireEvent.click(favorite);
    expect(favorite.getAttribute('aria-pressed')).toBe('false');

    const undo = await screen.findByRole('button', { name: 'Undo' });
    fireEvent.click(undo);
    await waitFor(() => expect(favorite.getAttribute('aria-pressed')).toBe('true'));
  });
});
