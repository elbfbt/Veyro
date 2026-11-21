/**
 * Single source of truth for product identity.
 * Rename the product here (and regenerate public/brand/favicon.svg) later.
 */
export const brand = {
  name: 'Veyro',
  wordmark: 'VEYRO',
  originalLabel: 'original',
  tagline: 'Your screen. Your source.',
  description:
    'Veyro is a premium IPTV client for your own provider, playlist and devices. No content is bundled or resold.',
  accent: '#7c5cff',
  accentLight: '#a18cff',
  accentDeep: '#4b2fd6',
  favicon: '/favicon.svg',
  metadata: {
    title: 'Veyro — Your screen. Your source.',
    description:
      'A premium, cross-device IPTV client. Bring your own playlist and watch directly from your provider.',
    themeColor: '#08080c',
  },
} as const;

export type BrandConfig = typeof brand;
