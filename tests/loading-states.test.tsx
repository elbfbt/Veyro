// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DetailSkeleton, HeroSkeleton } from '../src/components/content/CatalogStates';
import { usePagedCatalog } from '../src/hooks/useCatalog';
import type { Pagination } from '../src/types/content';

const pagination: Pagination = { page: 1, limit: 24, total: 2, totalPages: 1, hasMore: false };
const query = {};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('loading placeholders reserve space', () => {
  it('renders a details skeleton with a busy region and reserved artwork box', () => {
    const markup = renderToStaticMarkup(<DetailSkeleton />);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('detail-skeleton__art');
    expect(markup).toContain('skeleton-line--title');
  });

  it('renders a hero placeholder for the home page', () => {
    const markup = renderToStaticMarkup(<HeroSkeleton />);
    expect(markup).toContain('hero-skeleton');
  });
});

describe('catalogue stale-while-revalidate', () => {
  it('keeps the current page visible while a refresh is in flight', async () => {
    let resolveSecond: ((value: { items: number[]; pagination: Pagination }) => void) | null = null;
    const loader = vi
      .fn()
      .mockResolvedValueOnce({ items: [1, 2], pagination })
      .mockImplementationOnce(
        () =>
          new Promise<{ items: number[]; pagination: Pagination }>((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const { result } = renderHook(() => usePagedCatalog<number>(loader, query));

    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => {
      void result.current.retry();
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      resolveSecond?.({ items: [3], pagination });
    });

    await waitFor(() => expect(result.current.items).toEqual([3]));
    expect(result.current.refreshing).toBe(false);
  });
});
