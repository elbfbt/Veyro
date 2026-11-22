import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { Logo } from '../../brand/Logo';
import { useAuth } from '../../state/AuthContext';

interface TopbarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenDrawer: () => void;
}

export function Topbar({ sidebarCollapsed, onToggleSidebar, onOpenDrawer }: TopbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, user } = useAuth();
  const [query, setQuery] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /*
   * The `/` hint in the search field is a real shortcut everywhere except the
   * dedicated search page, which owns its own input.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (location.pathname === '/search') return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) {
        return;
      }
      event.preventDefault();
      searchInput.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [location.pathname]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    navigate(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search');
  };

  return (
    <header className={`topbar${scrolled ? ' topbar--scrolled' : ''}`}>
      <div className="topbar__left">
        <button
          type="button"
          className="icon-button topbar__menu"
          onClick={onOpenDrawer}
          aria-label="Open navigation"
          title="Navigation"
        >
          <Menu size={22} />
        </button>
        <button
          type="button"
          className="icon-button topbar__sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={sidebarCollapsed}
          title={`${sidebarCollapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+\\)`}
          data-spatial="topbar-sidebar-toggle"
        >
          {sidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
        </button>
        <div className="topbar__mobile-brand">
          <Logo compact />
        </div>
      </div>

      <form className="topbar__search" role="search" onSubmit={submit}>
        <Search size={18} aria-hidden="true" />
        <input
          ref={searchInput}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search channels, movies, shows..."
          aria-label="Search Veyro"
        />
        <kbd aria-hidden="true" title="Press / to focus search">
          /
        </kbd>
      </form>

      <div className="topbar__actions">
        {status === 'authenticated' && user ? (
          <Link
            to="/profile"
            className="topbar__avatar"
            aria-label={`Open profile for ${user.displayName}`}
            data-spatial="topbar-profile"
          >
            <span aria-hidden="true">{user.displayName.slice(0, 1).toUpperCase()}</span>
          </Link>
        ) : (
          <Link to="/login?next=%2Fprofile" className="topbar__signin" data-spatial="topbar-signin">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
