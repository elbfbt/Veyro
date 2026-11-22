import type { CSSProperties, ReactNode } from 'react';
import { Link, useNavigate, type LinkProps } from 'react-router-dom';
import { runViewTransition } from '../../lib/viewTransition';

interface ViewTransitionLinkProps extends Omit<LinkProps, 'to'> {
  to: string;
  children: ReactNode;
  style?: CSSProperties;
}

/**
 * Same API as <Link>, but card → detail navigation runs inside a native View
 * Transition so the artwork can morph. Falls back to a normal navigation.
 */
export function ViewTransitionLink({ to, onClick, children, ...rest }: ViewTransitionLinkProps) {
  const navigate = useNavigate();
  return (
    <Link
      to={to}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (event.button !== 0) return;
        event.preventDefault();
        runViewTransition(() => navigate(to));
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}
