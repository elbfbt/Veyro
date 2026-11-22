// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { CommandMenu } from '../src/components/layout/CommandMenu';
import {
  isCommandMenuShortcut,
  isSearchShortcut,
  isSidebarShortcut,
} from '../src/lib/shortcuts';

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderMenu(onClose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <CommandMenu open onClose={onClose} />
      <LocationProbe />
    </MemoryRouter>,
  );
  return onClose;
}

afterEach(() => {
  cleanup();
});

describe('command menu', () => {
  it('opens as a modal dialog focused on the search field', async () => {
    renderMenu();
    expect(screen.getByRole('dialog', { name: 'Command menu' })).toBeTruthy();
    const input = screen.getByRole('textbox', { name: /Search or jump to/i });
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('filters sections and jumps with the keyboard', () => {
    renderMenu();
    const input = screen.getByRole('textbox', { name: /Search or jump to/i });

    fireEvent.change(input, { target: { value: 'sett' } });
    // First result is the catalogue search for the typed term, then Settings.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });

    expect(screen.getByTestId('location').textContent).toBe('/settings');
  });

  it('sends the typed term to search on Enter', () => {
    renderMenu();
    const input = screen.getByRole('textbox', { name: /Search or jump to/i });
    fireEvent.change(input, { target: { value: 'dune' } });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(screen.getByTestId('location').textContent).toBe('/search?q=dune');
  });

  it('closes on Escape and on a scrim click', () => {
    const onClose = renderMenu();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    const scrim = document.querySelector('.command-scrim');
    expect(scrim).toBeTruthy();
    fireEvent.pointerDown(scrim as Element);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('global shortcuts', () => {
  it('recognises Ctrl/Cmd+K, Ctrl+\\ and /', () => {
    expect(isCommandMenuShortcut({ key: 'k', ctrlKey: true })).toBe(true);
    expect(isCommandMenuShortcut({ key: 'K', metaKey: true })).toBe(true);
    expect(isCommandMenuShortcut({ key: 'k' })).toBe(false);
    expect(isSidebarShortcut({ key: '\\', ctrlKey: true })).toBe(true);
    expect(isSidebarShortcut({ key: '\\', ctrlKey: true, shiftKey: true } as never)).toBe(true);
    expect(isSearchShortcut({ key: '/' })).toBe(true);
    expect(isSearchShortcut({ key: '/', ctrlKey: true })).toBe(false);
  });
});
