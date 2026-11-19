import { describe, expect, it } from 'vitest';
import {
  computeEyeScale,
  computeHoverOffset,
  damp,
  MouthAnalyzer,
  TiltController,
} from '@/hooks/avatar/face-animation';
import { defaultSpeechAnimationConfig } from '@/lib/state';

function fakeAnalyser(fill: (data: Uint8Array) => void) {
  return {
    frequencyBinCount: 256,
    smoothingTimeConstant: 0,
    getByteFrequencyData: fill,
  } as unknown as AnalyserNode;
}

describe('damp', () => {
  it('matches the per-frame factor at 60 fps', () => {
    expect(damp(0.08, 1 / 60)).toBeCloseTo(0.08, 6);
  });

  it('covers the same ground at 30 fps as two 60 fps frames', () => {
    const twoFrames = 1 - (1 - 0.08) ** 2;
    expect(damp(0.08, 1 / 30)).toBeCloseTo(twoFrames, 6);
  });
});

describe('computeEyeScale / computeHoverOffset', () => {
  it('stays within [0, 1] and blinks at some point', () => {
    let min = 1;
    for (let t = 0; t < 10; t += 1 / 60) {
      const s = computeEyeScale(t);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      min = Math.min(min, s);
    }
    expect(min).toBeLessThan(0.5);
  });

  it('hover offset is bounded by amplitude', () => {
    for (let t = 0; t < 5; t += 0.1) {
      expect(Math.abs(computeHoverOffset(t, 10))).toBeLessThanOrEqual(10);
    }
  });
});

describe('TiltController', () => {
  it('returns to center when inactive', () => {
    const tilt = new TiltController(5, 0.075);
    tilt.angle = 4;
    for (let i = 0; i < 300; i += 1) tilt.update(i / 60, 1 / 60, false);
    expect(Math.abs(tilt.angle)).toBeLessThan(0.01);
  });

  it('tilts within maxAngle while active', () => {
    const tilt = new TiltController(5, 0.075);
    let maxSeen = 0;
    for (let i = 0; i < 60 * 20; i += 1) {
      maxSeen = Math.max(maxSeen, Math.abs(tilt.update(i / 60, 1 / 60, true)));
    }
    expect(maxSeen).toBeGreaterThan(0.5);
    expect(maxSeen).toBeLessThanOrEqual(5);
  });
});

describe('MouthAnalyzer', () => {
  it('keeps the mouth closed on silence', () => {
    const analyzer = new MouthAnalyzer(fakeAnalyser(data => data.fill(0)));
    let shape = analyzer.shape;
    for (let i = 0; i < 30; i += 1) shape = analyzer.update(1 / 60, defaultSpeechAnimationConfig);
    expect(shape.open).toBeCloseTo(0, 5);
    expect(shape.intensity).toBe(0);
  });

  it('opens the mouth on loud audio and reuses the same shape object', () => {
    const analyzer = new MouthAnalyzer(fakeAnalyser(data => data.fill(200)));
    const first = analyzer.update(1 / 60, defaultSpeechAnimationConfig);
    let shape = first;
    for (let i = 0; i < 30; i += 1) shape = analyzer.update(1 / 60, defaultSpeechAnimationConfig);
    expect(shape).toBe(first);
    expect(shape.open).toBeGreaterThan(0.5);
    expect(shape.intensity).toBeGreaterThan(0.5);
  });
});
