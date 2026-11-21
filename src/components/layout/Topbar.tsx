import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Menu, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { Logo } from '../../brand/Logo';

interface TopbarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenDrawer: () => void;
}

export function Topbar({ sidebarCollapsed, onToggleSidebar, onOpenDrawer }: TopbarProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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
        >
          <Menu size={22} />
        </button>
        <button
          type="button"
          className="icon-button topbar__sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={sidebarCollapsed}
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
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search channels, movies, shows..."
          aria-label="Search Veyro"
        />
        <kbd aria-hidden="true">/</kbd>
      </form>

      <div className="topbar__actions">
        <button
          type="button"
          className="icon-button icon-button--muted"
          disabled
          title="Notifications are planned for a later phase"
          aria-label="Notifications, planned for a later phase"
        >
          <Bell size={19} />
        </button>
        <Link
          to="/profile"
          className="topbar__avatar"
          aria-label="Open profile"
          data-spatial="topbar-profile"
        >
          <span aria-hidden="true">V</span>
        </Link>
      </div>
    </header>
  );
}
