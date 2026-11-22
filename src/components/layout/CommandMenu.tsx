import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { navGroups } from '../../app/navigation';

interface CommandMenuProps {
  open: boolean;
  onClose: () => void;
}

interface Command {
  id: string;
  label: string;
  detail: string;
  group: string;
  to: string;
}

const commands: Command[] = [
  ...navGroups.flatMap((group) =>
    group.items.map((item) => ({
      id: `nav-${item.path}`,
      label: item.label,
      detail: item.path,
      group: group.label,
      to: item.path,
    })),
  ),
  {
    id: 'action-providers',
    label: 'Manage providers',
    detail: 'Settings',
    group: 'Actions',
    to: '/settings#providers',
  },
  {
    id: 'action-pair',
    label: 'Add playlist on TV',
    detail: 'Pair',
    group: 'Actions',
    to: '/tv/pair',
  },
];

/**
 * Ctrl/Cmd+K palette: jump to a section or hand the typed text to search.
 * Focus is trapped while open and returned to the trigger on close.
 */
export function CommandMenu({ open, onClose }: CommandMenuProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matches = term
      ? commands.filter((command) => command.label.toLowerCase().includes(term))
      : commands;
    if (!term) return matches;
    return [
      {
        id: 'search',
        label: `Search the catalogue for “${query.trim()}”`,
        detail: 'Search',
        group: 'Search',
        to: `/search?q=${encodeURIComponent(query.trim())}`,
      },
      ...matches.filter((command) => command.to !== `/search?q=${encodeURIComponent(query.trim())}`),
    ];
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActive(0);
      const previous = restoreFocus.current;
      restoreFocus.current = null;
      previous?.focus?.();
      return;
    }
    restoreFocus.current = document.activeElement as HTMLElement | null;
    // Wait for the panel to mount before moving focus into it.
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  const choose = (command: Command) => {
    navigate(command.to);
    onClose();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (index + 1) % results.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index - 1 + results.length) % results.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const command = results[active];
      if (command) choose(command);
      return;
    }
    if (event.key === 'Tab') {
      // Keep Tab inside the palette: input → options → input.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'input, button:not([disabled])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable.item(0);
      const last = focusable.item(focusable.length - 1);
      if (!first || !last) return;
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    }
  };

  return (
    <div
      className="command-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="command-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        ref={panelRef}
        onKeyDown={onKeyDown}
      >
        <div className="command-search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search or jump to…"
            aria-label="Search or jump to a section"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
            autoComplete="off"
          />
          <kbd aria-hidden="true">esc</kbd>
        </div>

        {results.length > 0 ? (
          <ul className="command-list" id={listId} role="listbox" aria-label="Commands">
            {results.map((command, index) => (
              <li role="none" key={command.id}>
                <button
                  type="button"
                  role="option"
                  id={`${listId}-${command.id}`}
                  aria-selected={index === active}
                  className={`command-item${index === active ? ' is-active' : ''}`}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => choose(command)}
                >
                  <span className="command-item__label">{command.label}</span>
                  <span className="command-item__detail">
                    {command.group} · {command.detail}
                  </span>
                  {index === active && <CornerDownLeft size={14} aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="command-empty">No sections match “{query.trim()}”.</p>
        )}

        <p className="command-hint">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span>
            <kbd>esc</kbd> to close
          </span>
        </p>
      </div>
    </div>
  );
}
