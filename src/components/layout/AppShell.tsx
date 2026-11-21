import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { usePreferences } from '../../state/PreferencesContext';
import { useSpatialNavigation } from '../../hooks/useSpatialNavigation';
import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell() {
  const { preferences, update } = usePreferences();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useSpatialNavigation(preferences.tvMode);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target?.tagName ?? '');
      if (event.key === 'Escape') setDrawerOpen(false);
      if (event.ctrlKey && event.key === '\\' && !isTyping) {
        event.preventDefault();
        update('sidebarCollapsed', !preferences.sidebarCollapsed);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [preferences.sidebarCollapsed, update]);

  return (
    <div className={`app-shell${preferences.sidebarCollapsed ? ' app-shell--collapsed' : ''}`}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div
        className={`sidebar-scrim${drawerOpen ? ' is-visible' : ''}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <Sidebar
        collapsed={preferences.sidebarCollapsed}
        drawerOpen={drawerOpen}
        onToggleCollapse={() => update('sidebarCollapsed', !preferences.sidebarCollapsed)}
        onCloseDrawer={() => setDrawerOpen(false)}
      />
      <div className="app-shell__main">
        <Topbar
          sidebarCollapsed={preferences.sidebarCollapsed}
          onToggleSidebar={() => update('sidebarCollapsed', !preferences.sidebarCollapsed)}
          onOpenDrawer={() => setDrawerOpen(true)}
        />
        <main id="main-content" className="app-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
