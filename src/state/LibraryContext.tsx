import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ContentKind } from '../types/content';

const STORAGE_KEY = 'veyro.library.v2';

/**
 * Saved items keep a small snapshot of the catalogue entry so Favorites and
 * Watchlist render instantly (and offline) without re-querying every provider.
 */
export interface LibraryEntry {
  id: string;
  kind: ContentKind;
  title: string;
  art: string | null;
  meta: string;
  providerName: string;
}

interface LibraryState {
  favorites: LibraryEntry[];
  watchlist: LibraryEntry[];
}

export interface LibraryResult {
  added: boolean;
  error?: string;
}

const emptyState: LibraryState = { favorites: [], watchlist: [] };

function isEntry(value: unknown): value is LibraryEntry {
  const entry = value as Partial<LibraryEntry> | null;
  return Boolean(entry && typeof entry.id === 'string' && typeof entry.title === 'string');
}

function load(): LibraryState {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return emptyState;
    const parsed = JSON.parse(stored) as Partial<LibraryState>;
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites.filter(isEntry) : [],
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist.filter(isEntry) : [],
    };
  } catch {
    return emptyState;
  }
}

function persist(state: LibraryState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

type LibraryKey = 'favorites' | 'watchlist';

interface LibraryContextValue {
  favorites: LibraryEntry[];
  watchlist: LibraryEntry[];
  favoriteIds: string[];
  watchlistIds: string[];
  toggleFavorite: (entry: LibraryEntry) => LibraryResult;
  toggleWatchlist: (entry: LibraryEntry) => LibraryResult;
  isFavorite: (id: string) => boolean;
  isInWatchlist: (id: string) => boolean;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LibraryState>(load);
  const stateRef = useRef(state);
  stateRef.current = state;

  /**
   * Optimistic toggle: the UI updates first, then persistence runs. If the
   * write fails (private mode, quota, blocked storage) the previous snapshot is
   * restored and the caller can surface an error.
   */
  const toggle = useCallback((key: LibraryKey, entry: LibraryEntry): LibraryResult => {
    const previous = stateRef.current;
    const list = previous[key];
    const exists = list.some((item) => item.id === entry.id);
    const nextList = exists ? list.filter((item) => item.id !== entry.id) : [...list, entry];
    const next = { ...previous, [key]: nextList };

    stateRef.current = next;
    setState(next);

    try {
      persist(next);
      return { added: !exists };
    } catch {
      stateRef.current = previous;
      setState(previous);
      return {
        added: exists,
        error: 'This browser blocked local storage, so nothing was saved.',
      };
    }
  }, []);

  const toggleFavorite = useCallback((entry: LibraryEntry) => toggle('favorites', entry), [toggle]);
  const toggleWatchlist = useCallback((entry: LibraryEntry) => toggle('watchlist', entry), [toggle]);

  const value = useMemo<LibraryContextValue>(() => {
    const favoriteIds = state.favorites.map((entry) => entry.id);
    const watchlistIds = state.watchlist.map((entry) => entry.id);
    return {
      favorites: state.favorites,
      watchlist: state.watchlist,
      favoriteIds,
      watchlistIds,
      toggleFavorite,
      toggleWatchlist,
      isFavorite: (id) => favoriteIds.includes(id),
      isInWatchlist: (id) => watchlistIds.includes(id),
    };
  }, [state, toggleFavorite, toggleWatchlist]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryContextValue {
  const context = useContext(LibraryContext);
  if (!context) throw new Error('useLibrary must be used inside LibraryProvider');
  return context;
}

/** For presentational components that can render without a library provider. */
export function useOptionalLibrary(): LibraryContextValue | null {
  return useContext(LibraryContext);
}
