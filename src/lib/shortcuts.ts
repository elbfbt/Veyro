/** Pure shortcut predicates so the global listeners stay easily testable. */

interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** Ctrl+K / Cmd+K opens the command menu. */
export function isCommandMenuShortcut(event: KeyLike): boolean {
  return (event.ctrlKey || event.metaKey) === true && !event.altKey && event.key.toLowerCase() === 'k';
}

/** Ctrl+\ toggles the sidebar, as advertised in Settings. */
export function isSidebarShortcut(event: KeyLike): boolean {
  return event.ctrlKey === true && !event.metaKey && !event.altKey && event.key === '\\';
}

/** `/` focuses search — mirrored by the hint rendered in the top bar. */
export function isSearchShortcut(event: KeyLike): boolean {
  return event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey;
}
