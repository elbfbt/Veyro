import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { brand } from '../src/brand/config';

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('theme-related behavior preserved after Phase 4', () => {
  it('keeps the branded theme-color in HTML and the central brand config', () => {
    const html = read('../index.html');
    expect(html).toContain('<meta name="theme-color" content="#08080c" />');
    expect(brand.metadata.themeColor).toBe('#08080c');
    expect(brand.accent).toBe('#7c5cff');
  });

  it('keeps the dark theme token defaults and device theme attributes', () => {
    const tokens = read('../src/styles/tokens.css');
    expect(tokens).toContain('color-scheme: dark');
    expect(tokens).toContain('--brand-accent: #7c5cff');

    const preferences = read('../src/state/PreferencesContext.tsx');
    expect(preferences).toContain("root.dataset.density = preferences.density");
    expect(preferences).toContain("root.dataset.motion = preferences.motion");
    expect(preferences).toContain("root.dataset.tv = preferences.tvMode ? 'true' : 'false'");
  });

  it('keeps the persisted theme column in the original schema', () => {
    const schema = read('../migrations/0001_initial_schema.sql');
    expect(schema).toMatch(/theme\s+TEXT NOT NULL DEFAULT 'dark'/);
  });

  it('keeps the interface settings that control the existing dark theme presentation', () => {
    const settings = read('../src/features/settings/SettingsPage.tsx');
    expect(settings).toContain('aria-labelledby="settings-interface"');
    expect(settings).toContain('label="TV / 10-foot mode"');
    expect(settings).toContain('label="Density"');
    expect(settings).toContain('label="Motion"');
  });
});
