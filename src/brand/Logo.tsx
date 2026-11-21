import { Link } from 'react-router-dom';
import { brand } from './config';

export function VeyroMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={`${brand.name} logo`}
    >
      <defs>
        <linearGradient id="veyro-mark-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={brand.accentLight} />
          <stop offset="100%" stopColor={brand.accentDeep} />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="12" fill="url(#veyro-mark-gradient)" />
      <path
        d="M10.5 12.5h5.2L20 24.1l4.3-11.6h5.2l-7.4 17h-4.2l-7.4-17Z"
        fill="white"
      />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand-logo" to="/" aria-label={`${brand.name} home`}>
      <VeyroMark size={compact ? 30 : 34} />
      {!compact && (
        <span className="brand-logo__text">
          <span className="brand-logo__name">{brand.name}</span>
          <span className="brand-logo__suffix">{brand.originalLabel}</span>
        </span>
      )}
    </Link>
  );
}
