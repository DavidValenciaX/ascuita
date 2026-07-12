import { describe, it, expect } from 'vitest';
import {
  cloneInnerFireConfig,
  mergeInnerFireConfig,
  normalizeInnerFireConfig,
  defaultInnerFireConfig,
} from '@/lib/fire/config';

describe('cloneInnerFireConfig', () => {
  it('creates a deep copy equal to the original', () => {
    const clone = cloneInnerFireConfig(defaultInnerFireConfig);
    expect(clone).toEqual(defaultInnerFireConfig);
    expect(clone).not.toBe(defaultInnerFireConfig);
  });

  it('mutating the clone does not affect the original', () => {
    const clone = cloneInnerFireConfig(defaultInnerFireConfig);
    clone.transform.x = 999;
    clone.particles.count = 1;
    expect(defaultInnerFireConfig.transform.x).toBe(0);
    expect(defaultInnerFireConfig.particles.count).toBe(2000);
  });
});

describe('mergeInnerFireConfig', () => {
  it('merges a partial nested section while preserving other keys', () => {
    const result = mergeInnerFireConfig(defaultInnerFireConfig, {
      transform: { x: 1 },
    });
    expect(result.transform.x).toBe(1);
    expect(result.transform.y).toBe(-0.2);
    expect(result.transform.z).toBe(-0.04);
  });

  it('preserves untouched top-level sections', () => {
    const result = mergeInnerFireConfig(defaultInnerFireConfig, {
      bloom: { strength: 2 },
    });
    expect(result.bloom.strength).toBe(2);
    expect(result.bloom.radius).toBe(0.5);
    expect(result.particles).toEqual(defaultInnerFireConfig.particles);
  });

  it('ignores undefined values in the source', () => {
    const result = mergeInnerFireConfig(defaultInnerFireConfig, {
      transform: undefined,
    });
    expect(result.transform).toEqual(defaultInnerFireConfig.transform);
  });

  it('returns a deep clone of the target for an empty source', () => {
    const result = mergeInnerFireConfig(defaultInnerFireConfig, {});
    expect(result).toEqual(defaultInnerFireConfig);
    expect(result).not.toBe(defaultInnerFireConfig);
  });

  it('does not mutate the original target', () => {
    mergeInnerFireConfig(defaultInnerFireConfig, { transform: { x: 1 } });
    expect(defaultInnerFireConfig.transform.x).toBe(0);
  });
});

describe('normalizeInnerFireConfig', () => {
  it('returns full defaults for an empty object', () => {
    expect(normalizeInnerFireConfig({})).toEqual(defaultInnerFireConfig);
  });

  it('merges a partial config with defaults', () => {
    const result = normalizeInnerFireConfig({
      transform: { y: 5 },
      bloom: { strength: 3 },
    });
    expect(result.transform.y).toBe(5);
    expect(result.transform.x).toBe(0);
    expect(result.bloom.strength).toBe(3);
    expect(result.bloom.radius).toBe(0.5);
    expect(result.particles).toEqual(defaultInnerFireConfig.particles);
  });
});
