import { useEffect, type ReactNode } from 'react';
import { brand } from './config';

/** Applies centralized brand values to CSS variables and document metadata. */
export function BrandProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.brand = brand.wordmark.toLowerCase();
    root.style.setProperty('--brand-accent', brand.accent);
    root.style.setProperty('--brand-accent-light', brand.accentLight);
    root.style.setProperty('--brand-accent-deep', brand.accentDeep);

    document.title = brand.metadata.title;

    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = brand.metadata.description;

    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColor) themeColor.content = brand.metadata.themeColor;
  }, []);

  return <>{children}</>;
}
