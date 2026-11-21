import { useEffect, useState } from 'react';
import { FALLBACK_ART, imageWithFallback } from '../../lib/images';

interface SafeArtworkProps {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  eager?: boolean;
}

export function SafeArtwork({ src, alt = '', className, eager = false }: SafeArtworkProps) {
  const [failed, setFailed] = useState(false);
  const source = failed ? FALLBACK_ART : imageWithFallback(src);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <img
      className={className}
      src={source}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
