export const FALLBACK_ART = '/media/card-static.jpg';

/** Artwork is loaded directly by the browser; only web URLs are rendered. */
export function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function imageWithFallback(value: string | null | undefined): string {
  return safeImageUrl(value) ?? FALLBACK_ART;
}
