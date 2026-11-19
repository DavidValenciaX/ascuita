import { describe, expect, it } from 'vitest';
import {
  classifyDevice,
  FrameRateMonitor,
  lowerTier,
  RENDER_QUALITY_PROFILES,
  resolvePixelRatio,
  resolveTier,
  type DeviceInfo,
} from '@/lib/render-quality';

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; SM-A045M) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function device(overrides: Partial<DeviceInfo>): DeviceInfo {
  return {
    gpuRenderer: 'Adreno (TM) 730',
    userAgent: ANDROID_UA,
    deviceMemory: 8,
    hardwareConcurrency: 8,
    isCoarsePointer: true,
    ...overrides,
  };
}

describe('classifyDevice', () => {
  it.each([
    ['PowerVR Rogue GE8320'], // Galaxy A04 (Helio P35), Helio P22 phones
    ['Mali-G52 MC2'], // Moto g06 (Helio G81)
    ['Mali-G31 MP2'], // Google TV sticks
    ['Adreno (TM) 610'],
  ])('puts weak GPU %s on the low tier', gpuRenderer => {
    expect(classifyDevice(device({ gpuRenderer }))).toBe('low');
  });

  it('puts Android TV on the low tier even with an unknown GPU', () => {
    expect(classifyDevice(device({ gpuRenderer: '', userAgent: `${ANDROID_UA} GoogleTV` }))).toBe('low');
  });

  it('puts low-memory phones on the low tier', () => {
    expect(classifyDevice(device({ deviceMemory: 4 }))).toBe('low');
  });

  it('uses medium for capable phones and high for desktops', () => {
    expect(classifyDevice(device({}))).toBe('medium');
    expect(classifyDevice(device({
      userAgent: DESKTOP_UA,
      isCoarsePointer: false,
      gpuRenderer: 'ANGLE (NVIDIA GeForce RTX 3060)',
      hardwareConcurrency: 4,
    }))).toBe('high');
  });
});

describe('tiers', () => {
  it('steps down and stops at low', () => {
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBe('low');
  });

  it('resolves the manual setting over the automatic tier', () => {
    expect(resolveTier('auto', 'low')).toBe('low');
    expect(resolveTier('high', 'low')).toBe('high');
  });
});

describe('resolvePixelRatio', () => {
  it('caps the ratio on the low tier', () => {
    expect(resolvePixelRatio(RENDER_QUALITY_PROFILES.low, 360, 800, 2)).toBeLessThanOrEqual(0.75);
  });

  it('respects the pixel budget on large screens', () => {
    const ratio = resolvePixelRatio(RENDER_QUALITY_PROFILES.low, 1920, 1080, 1);
    expect(1920 * 1080 * ratio * ratio).toBeLessThanOrEqual(RENDER_QUALITY_PROFILES.low.maxRenderPixels + 1);
  });

  it('keeps the device ratio (up to 2) on high', () => {
    expect(resolvePixelRatio(RENDER_QUALITY_PROFILES.high, 1280, 720, 3)).toBe(2);
  });
});

describe('FrameRateMonitor', () => {
  it('ignores warm-up and reports sustained slow frames', () => {
    const monitor = new FrameRateMonitor(60, 1000, 1000);
    let reported = false;
    for (let i = 0; i < 40; i += 1) reported ||= monitor.sample(40); // 25 fps during warm-up
    expect(reported).toBe(false);
    for (let i = 0; i < 40; i += 1) reported ||= monitor.sample(40);
    expect(reported).toBe(true);
  });

  it('does not report when frames are on budget', () => {
    const monitor = new FrameRateMonitor(30, 0, 1000);
    let reported = false;
    for (let i = 0; i < 200; i += 1) reported ||= monitor.sample(33.4);
    expect(reported).toBe(false);
  });

  it('ignores long stalls', () => {
    const monitor = new FrameRateMonitor(60, 0, 100);
    expect(monitor.sample(5000)).toBe(false);
  });
});
