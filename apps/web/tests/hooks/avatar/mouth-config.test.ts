import { describe, it, expect } from 'vitest';
import {
  computeVisemeScores,
  selectViseme,
  easeOutQuint,
  clamp,
  smoothstep,
  getMouthSignature,
} from '@/hooks/avatar/mouth-config';
import type { AdobeViseme, AudioFeatures, MouthShape } from '@/hooks/avatar/mouth-config';
import { defaultSpeechAnimationConfig } from '@/lib/state';

const makeFeatures = (overrides: Partial<AudioFeatures> = {}): AudioFeatures => ({
  bands: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
  deltaBands: [],
  volume: 0.5,
  centroid: 1000,
  ...overrides,
});

const avgFeatures = makeFeatures({
  bands: [1, 1, 1, 1, 1, 1, 1, 1],
});

const makeScores = (
  partial: Partial<Record<AdobeViseme, number>>
): Record<AdobeViseme, number> => ({
  Neutral: 0,
  M: 0,
  F: 0,
  L: 0,
  D: 0,
  S: 0,
  R: 0,
  Ah: 0,
  Ee: 0,
  Oh: 0,
  Uh: 0,
  'WO-o': 0,
  Smile: 0,
  Surprised: 0,
  ...partial,
});

describe('easeOutQuint', () => {
  it('returns 0 for input 0', () => {
    expect(easeOutQuint(0)).toBe(0);
  });

  it('returns 1 for input 1', () => {
    expect(easeOutQuint(1)).toBe(1);
  });

  it('returns the correct eased value for 0.5', () => {
    expect(easeOutQuint(0.5)).toBeCloseTo(1 - Math.pow(0.5, 5));
  });
});

describe('clamp', () => {
  it('clamps to the lower bound', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps to the upper bound', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('returns the value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe('smoothstep', () => {
  it('returns 0 below edge0', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
  });

  it('returns 1 above edge1', () => {
    expect(smoothstep(0, 1, 2)).toBe(1);
  });

  it('returns 0.5 at the midpoint', () => {
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
  });
});

describe('computeVisemeScores', () => {
  it('returns Neutral=1 when volume is below the silence threshold', () => {
    const features = makeFeatures({ volume: 0.01 });
    const scores = computeVisemeScores(
      features,
      avgFeatures,
      0,
      0,
      defaultSpeechAnimationConfig
    );
    expect(scores.Neutral).toBe(1);
    expect(scores.M).toBe(0);
    expect(scores.Ah).toBe(0);
  });

  it('activates F viseme for high-frequency energy with high centroid', () => {
    const features = makeFeatures({
      bands: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.5, 0.5],
      volume: 0.5,
      centroid: 3500,
    });
    const scores = computeVisemeScores(
      features,
      avgFeatures,
      0,
      0,
      defaultSpeechAnimationConfig
    );
    expect(scores.F).toBeCloseTo(0.65);
  });

  it('activates M viseme for rising volume with dominant low energy', () => {
    const features = makeFeatures({
      bands: [0.6, 0.6, 0.6, 0.3, 0.3, 0.3, 0.1, 0.1],
      volume: 0.5,
      centroid: 1000,
    });
    const scores = computeVisemeScores(
      features,
      avgFeatures,
      0.2,
      0,
      defaultSpeechAnimationConfig
    );
    expect(scores.M).toBeGreaterThan(0);
  });

  it('applies volume fallback to Oh when enabled and low energy dominates', () => {
    const config = {
      ...defaultSpeechAnimationConfig,
      enableVolumeFallback: true,
    };
    const features = makeFeatures({
      bands: [0.5, 0.5, 0.5, 0.3, 0.3, 0.3, 0.2, 0.2],
      volume: 0.5,
      centroid: 1000,
    });
    const scores = computeVisemeScores(features, avgFeatures, 0, 0, config);
    expect(scores.Oh).toBeCloseTo(0.52);
  });

  it('does not apply volume fallback when disabled', () => {
    const features = makeFeatures({
      bands: [0.5, 0.5, 0.5, 0.3, 0.3, 0.3, 0.2, 0.2],
      volume: 0.5,
      centroid: 1000,
    });
    const scores = computeVisemeScores(
      features,
      avgFeatures,
      0,
      0,
      defaultSpeechAnimationConfig
    );
    expect(scores.Oh).toBe(0);
  });
});

describe('selectViseme', () => {
  const config = defaultSpeechAnimationConfig;

  it('selects the viseme with the highest score', () => {
    const scores = makeScores({ M: 0.8, F: 0.3 });
    expect(selectViseme(scores, 'Neutral', 1, config)).toBe('M');
  });

  it('applies boost to the current viseme', () => {
    const scores = makeScores({ M: 0.75, F: 0.7 });
    expect(selectViseme(scores, 'F', 1, config)).toBe('F');
  });

  it('prevents switching when hold time is below the minimum', () => {
    const scores = makeScores({ M: 0.9, F: 0.1 });
    expect(selectViseme(scores, 'F', 0.01, config)).toBe('F');
  });

  it('prevents switching when the max score is below the minimum switch score', () => {
    const scores = makeScores({ M: 0.2, F: 0.1 });
    expect(selectViseme(scores, 'F', 1, config)).toBe('F');
  });

  it('switches when hold time and score thresholds are met', () => {
    const scores = makeScores({ M: 0.9, F: 0.1 });
    expect(selectViseme(scores, 'F', 1, config)).toBe('M');
  });
});

describe('getMouthSignature', () => {
  const makeShape = (
    overrides: Partial<MouthShape> = {}
  ): MouthShape => ({
    viseme: 'Ah',
    intensity: 0.5,
    open: 0.8,
    spread: 0.3,
    round: 0.1,
    ...overrides,
  });

  it('produces a deterministic string signature', () => {
    expect(getMouthSignature(makeShape())).toBe('Ah:0.50:0.80:0.30:0.10');
  });

  it('formats numbers to two decimal places', () => {
    expect(
      getMouthSignature(
        makeShape({
          viseme: 'M',
          intensity: 0.123,
          open: 0.456,
          spread: 0.789,
          round: 1,
        })
      )
    ).toBe('M:0.12:0.46:0.79:1.00');
  });
});
