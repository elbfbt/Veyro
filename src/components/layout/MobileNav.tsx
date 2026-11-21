import { NavLink } from 'react-router-dom';
import { mobileNavItems } from '../../app/navigation';

export function MobileNav() {
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      <ul>
        {mobileNavItems.map(({ label, path, icon: Icon }) => (
          <li key={path}>
            <NavLink
              to={path}
              end={path === '/'}
              className={({ isActive }) => `mobile-nav__item${isActive ? ' is-active' : ''}`}
            >
              <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
