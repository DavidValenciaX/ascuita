import { describe, expect, it } from 'vitest';
import { defaultInnerFireConfig } from '@/lib/fire/config';
import { buildFirePaletteLut } from '@/lib/fire/inner-fire';

describe('buildFirePaletteLut', () => {
  it('produces finite RGB values in [0, 1]', () => {
    const lut = buildFirePaletteLut(defaultInnerFireConfig, '#5B9BF5');
    expect(lut.length).toBe(256 * 3);
    for (const value of lut) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('fades from a bright core to a dark tip', () => {
    const lut = buildFirePaletteLut(defaultInnerFireConfig, '#5B9BF5');
    const luminance = (i: number) => lut[i * 3] + lut[i * 3 + 1] + lut[i * 3 + 2];
    expect(luminance(0)).toBeGreaterThan(luminance(255));
  });

  it('follows the avatar color', () => {
    const blue = buildFirePaletteLut(defaultInnerFireConfig, '#5B9BF5');
    const red = buildFirePaletteLut(defaultInnerFireConfig, '#F55B5B');
    const mid = 128 * 3;
    expect(blue[mid + 2]).toBeGreaterThan(blue[mid]);
    expect(red[mid]).toBeGreaterThan(red[mid + 2]);
  });
});
