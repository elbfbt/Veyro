import { describe, expect, it } from 'vitest';
import { brand } from '../src/brand/config';

describe('centralized brand config', () => {
  it('uses the Veyro identity everywhere metadata is defined', () => {
    expect(brand.name).toBe('Veyro');
    expect(brand.wordmark).toBe('VEYRO');
    expect(brand.metadata.title).toContain('Veyro');
    expect(brand.favicon).toMatch(/^\/favicon\.svg$/);
  });

  it('does not retain reference-design branding', () => {
    expect(JSON.stringify(brand).toLowerCase()).not.toContain('sloth');
  });
});
