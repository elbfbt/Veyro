import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'veyro.library.v1';

interface LibraryState {
  favorites: string[];
  watchlist: string[];
}

const emptyState: LibraryState = { favorites: [], watchlist: [] };

function load(): LibraryState {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return emptyState;
    const parsed = JSON.parse(stored) as Partial<LibraryState>;
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
    };
  } catch {
    return emptyState;
  }
}

interface LibraryContextValue extends LibraryState {
  toggleFavorite: (id: string) => void;
  toggleWatchlist: (id: string) => void;
  isFavorite: (id: string) => boolean;
  isInWatchlist: (id: string) => boolean;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LibraryState>(load);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage errors; in-memory state still works.
    }
  }, [state]);

  const toggleFavorite = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      favorites: current.favorites.includes(id)
        ? current.favorites.filter((entry) => entry !== id)
        : [...current.favorites, id],
    }));
  }, []);

  const toggleWatchlist = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      watchlist: current.watchlist.includes(id)
        ? current.watchlist.filter((entry) => entry !== id)
        : [...current.watchlist, id],
    }));
  }, []);

  const value = useMemo<LibraryContextValue>(
    () => ({
      ...state,
      toggleFavorite,
      toggleWatchlist,
      isFavorite: (id) => state.favorites.includes(id),
      isInWatchlist: (id) => state.watchlist.includes(id),
    }),
    [state, toggleFavorite, toggleWatchlist],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryContextValue {
  const context = useContext(LibraryContext);
  if (!context) throw new Error('useLibrary must be used inside LibraryProvider');
  return context;
}
