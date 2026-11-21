import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentRows, demoItems, heroSlides, liveChannels } from '../src/data/demo';

describe('demo catalogue', () => {
  it('has unique ids across slides and items', () => {
    const ids = [...heroSlides, ...demoItems].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only local artwork and contains no credential-like data', () => {
    for (const item of [...heroSlides, ...demoItems]) {
      expect(item.image.startsWith('/media/')).toBe(true);
      expect(existsSync(new URL(`../public${item.image}`, import.meta.url))).toBe(true);
      expect(JSON.stringify(item).toLowerCase()).not.toMatch(/password|username|xtream|api_token/);
    }
  });

  it('links every content row to known items', () => {
    const known = new Set([...heroSlides, ...demoItems].map((item) => item.id));
    for (const row of contentRows) {
      expect(row.items.length).toBeGreaterThan(0);
      for (const item of row.items) expect(known.has(item.id)).toBe(true);
    }
  });

  it('models channels with current and next EPG entries', () => {
    expect(liveChannels.length).toBeGreaterThan(0);
    for (const channel of liveChannels) {
      expect(channel.isLive).toBe(true);
      expect(channel.now?.title).toBeTruthy();
      expect(channel.next?.title).toBeTruthy();
    }
  });
});
