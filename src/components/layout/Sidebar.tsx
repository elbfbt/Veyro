import { Link, NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { brand } from '../../brand/config';
import { VeyroMark } from '../../brand/Logo';
import { navGroups } from '../../app/navigation';

interface SidebarProps {
  collapsed: boolean;
  drawerOpen: boolean;
  onToggleCollapse: () => void;
  onCloseDrawer: () => void;
}

export function Sidebar({
  collapsed,
  drawerOpen,
  onToggleCollapse,
  onCloseDrawer,
}: SidebarProps) {
  return (
    <aside
      id="primary-sidebar"
      className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}${drawerOpen ? ' sidebar--open' : ''}`}
      aria-label="Primary navigation"
    >
      <div className="sidebar__top">
        <Link to="/" className="sidebar__brand" onClick={onCloseDrawer}>
          <VeyroMark size={34} />
          <span className="sidebar__brand-text">
            <strong>{brand.wordmark}</strong>
            <small>{brand.tagline}</small>
          </span>
        </Link>
        <button
          type="button"
          className="icon-button sidebar__drawer-close"
          onClick={onCloseDrawer}
          aria-label="Close navigation"
        >
          <X size={20} />
        </button>
      </div>

      <div className="sidebar__scroll">
        {navGroups.map((group) => (
          <div className="sidebar__group" key={group.label}>
            <p className="sidebar__group-label">{group.label}</p>
            <nav aria-label={group.label}>
              <ul className="sidebar__list">
                {group.items.map(({ label, path, icon: Icon, phase }) => (
                  <li key={path}>
                    <NavLink
                      to={path}
                      end={path === '/'}
                      onClick={onCloseDrawer}
                      aria-label={collapsed ? label : undefined}
                      data-spatial={`nav-${path}`}
                      className={({ isActive }) => `sidebar__link${isActive ? ' is-active' : ''}`}
                    >
                      <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
                      <span className="sidebar__link-label">{label}</span>
                      {phase && <span className="sidebar__phase">{phase}</span>}
                      {collapsed && (
                        <span className="sidebar__tooltip" role="tooltip">
                          {label}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        ))}
      </div>

      <div className="sidebar__bottom">
        <Link to="/tv/pair" className="sidebar__connect" onClick={onCloseDrawer}>
          <span className="sidebar__connect-dot" aria-hidden="true" />
          <span>Add playlist on TV</span>
        </Link>
        <button
          type="button"
          className="sidebar__collapse"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          data-spatial="sidebar-toggle"
        >
          {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
          <span>{collapsed ? 'Expand' : 'Collapse'}</span>
        </button>
      </div>
    </aside>
  );
}
