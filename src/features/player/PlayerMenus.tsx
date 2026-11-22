import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface PlayerMenuItem {
  key: string;
  label: string;
  detail?: string;
  active?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

interface PlayerMenuProps {
  /** Accessible name for the menu, e.g. "Playback engine". */
  label: string;
  /** Text shown on the trigger (current value). */
  value: string;
  items: PlayerMenuItem[];
  icon?: ReactNode;
  testId: string;
}

/**
 * Small dropdown used for the engine and quality pickers.
 *
 * Keyboard/touch accessible: the trigger is a real button, entries are
 * `menuitemradio` buttons so they are reachable with Tab and Enter/Space, and
 * Escape or a tap outside closes the menu.
 */
export function PlayerMenu({ label, value, items, icon, testId }: PlayerMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="player-menu" ref={containerRef}>
      <button
        type="button"
        className="player-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${label}: ${value}`}
        data-testid={testId}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
        <span className="player-menu__value">{value}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && (
        <ul className="player-menu__list" id={menuId} role="menu" aria-label={label} data-testid={`${testId}-list`}>
          {items.map((item) => (
            <li key={item.key} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={item.active ?? false}
                disabled={item.disabled}
                className={`player-menu__item${item.active ? ' player-menu__item--active' : ''}`}
                onClick={() => {
                  item.onSelect?.();
                  setOpen(false);
                }}
              >
                <span className="player-menu__item-label">{item.label}</span>
                {item.detail && <small className="player-menu__item-detail">{item.detail}</small>}
                {item.active && <Check size={14} aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
