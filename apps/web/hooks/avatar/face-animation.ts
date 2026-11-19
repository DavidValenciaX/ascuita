/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SpeechAnimationConfig } from '../../lib/state';
import type { AdobeViseme, AudioFeatures, MouthShape } from './mouth-config';
import { computeVisemeScores, easeOutQuint, selectViseme, smoothstep } from './mouth-config';

/**
 * Frame-rate independent smoothing. `perFrameFactor` is the lerp factor the
 * animation was tuned with at 60 fps; the result keeps the same feel at any
 * frame rate.
 */
export function damp(perFrameFactor: number, dtSeconds: number): number {
  if (perFrameFactor >= 1) return 1;
  return 1 - Math.pow(1 - perFrameFactor, dtSeconds * 60);
}

const BLINK_SPEED_PER_FRAME = 0.0125;

/** Eye vertical scale (1 = open, 0 = closed) for a given time in seconds. */
export function computeEyeScale(elapsedSeconds: number): number {
  const frame = elapsedSeconds * 60;
  const s = smoothstep(0.1, 0.25, easeOutQuint((Math.sin(frame * BLINK_SPEED_PER_FRAME) + 1) * 2));
  return Math.min(1, s);
}

/** Gentle idle hover offset in [-amplitude, amplitude]. */
export function computeHoverOffset(elapsedSeconds: number, amplitude = 10, frequency = 0.5): number {
  return Math.sin(elapsedSeconds * frequency * Math.PI) * amplitude;
}

/** Random head tilt while talking; eases back to center when idle. */
export class TiltController {
  angle = 0;
  private target = 0;
  private nextChangeAt = 0;

  constructor(
    private readonly maxAngle = 5,
    private readonly speedPerFrame = 0.075,
  ) {}

  update(nowSeconds: number, dtSeconds: number, isActive: boolean): number {
    if (!isActive) {
      this.target = 0;
      this.nextChangeAt = 0;
    } else if (this.nextChangeAt === 0) {
      this.nextChangeAt = nowSeconds + 1 + Math.random() * 2;
    } else if (nowSeconds >= this.nextChangeAt) {
      // Alternate: return to center, then pick a new random angle.
      this.target = Math.abs(this.target) > 0.1
        ? 0
        : (Math.random() > 0.5 ? 1 : -1) * (this.maxAngle * 0.3 + Math.random() * this.maxAngle * 0.7);
      this.nextChangeAt = nowSeconds + 1 + Math.random() * 2;
    }
    this.angle += (this.target - this.angle) * damp(this.speedPerFrame, dtSeconds);
    return this.angle;
  }
}

const BAND_RANGES: ReadonlyArray<readonly [number, number]> = [
  [1, 3],
  [3, 6],
  [6, 11],
  [11, 22],
  [22, 43],
  [43, 86],
  [86, 128],
  [128, 170],
];
const BAND_COUNT = BAND_RANGES.length;

function createFeatures(): AudioFeatures {
  return {
    bands: new Array(BAND_COUNT).fill(0),
    deltaBands: new Array(BAND_COUNT).fill(0),
    volume: 0,
    centroid: 0,
  };
}

/**
 * Audio → mouth shape analysis. Called from the render loop; reuses its
 * buffers so it allocates nothing per frame.
 */
export class MouthAnalyzer {
  readonly shape: MouthShape = { viseme: 'Neutral', intensity: 0, open: 0, spread: 0, round: 0 };

  private readonly data: Uint8Array<ArrayBuffer>;
  private readonly features = createFeatures();
  private readonly avg: AudioFeatures = {
    bands: new Array(BAND_COUNT).fill(0.1),
    deltaBands: new Array(BAND_COUNT).fill(0),
    volume: 0.1,
    centroid: 1000,
  };
  // Ring buffer of past band/volume/centroid values for the running average.
  private history: Float32Array = new Float32Array(0);
  private historyCapacity = 0;
  private historyLength = 0;
  private historyHead = 0;
  private lastVolume = 0;
  private lastCentroid = 0;
  private visemeHoldTime = 0;

  constructor(private readonly analyser: AnalyserNode) {
    this.data = new Uint8Array(analyser.frequencyBinCount);
  }

  private ensureHistory(capacity: number) {
    const safe = Math.max(1, Math.floor(capacity));
    if (safe === this.historyCapacity) return;
    this.historyCapacity = safe;
    this.history = new Float32Array(safe * (BAND_COUNT + 2));
    this.historyLength = 0;
    this.historyHead = 0;
  }

  update(dtSeconds: number, config: SpeechAnimationConfig): MouthShape {
    const { analyser, data, features, avg } = this;
    if (analyser.smoothingTimeConstant !== config.analyserSmoothing) {
      analyser.smoothingTimeConstant = config.analyserSmoothing;
    }
    analyser.getByteFrequencyData(data);
    const bufferLength = data.length;

    let totalEnergy = 0;
    let weightedSum = 0;
    for (let b = 0; b < BAND_COUNT; b += 1) {
      const [start, rawEnd] = BAND_RANGES[b];
      const end = Math.min(rawEnd, bufferLength);
      let sum = 0;
      for (let i = start; i < end; i += 1) {
        const val = data[i] / 255;
        sum += val;
        totalEnergy += val;
        weightedSum += val * i * 46.8;
      }
      const count = end - start;
      const band = count > 0 ? sum / count : 0;
      features.deltaBands[b] = this.historyLength > 0 ? band - features.bands[b] : 0;
      features.bands[b] = band;
    }

    const volume = Math.min(1, totalEnergy / bufferLength);
    const centroid = totalEnergy > 0 ? weightedSum / totalEnergy : 0;
    features.volume = volume;
    features.centroid = centroid;
    const deltaVolume = volume - this.lastVolume;
    const deltaCentroid = centroid - this.lastCentroid;
    this.lastVolume = volume;
    this.lastCentroid = centroid;

    // Push into the ring buffer and recompute the running average.
    this.ensureHistory(config.featureHistoryFrames);
    const stride = BAND_COUNT + 2;
    const slot = this.historyHead * stride;
    for (let b = 0; b < BAND_COUNT; b += 1) this.history[slot + b] = features.bands[b];
    this.history[slot + BAND_COUNT] = volume;
    this.history[slot + BAND_COUNT + 1] = centroid;
    this.historyHead = (this.historyHead + 1) % this.historyCapacity;
    this.historyLength = Math.min(this.historyLength + 1, this.historyCapacity);

    const len = this.historyLength;
    for (let b = 0; b < BAND_COUNT; b += 1) avg.bands[b] = 0;
    avg.volume = 0;
    avg.centroid = 0;
    for (let h = 0; h < len; h += 1) {
      const base = h * stride;
      for (let b = 0; b < BAND_COUNT; b += 1) avg.bands[b] += this.history[base + b];
      avg.volume += this.history[base + BAND_COUNT];
      avg.centroid += this.history[base + BAND_COUNT + 1];
    }
    for (let b = 0; b < BAND_COUNT; b += 1) avg.bands[b] /= len;
    avg.volume /= len;
    avg.centroid /= len;

    const scores = computeVisemeScores(features, avg, deltaVolume, deltaCentroid, config);
    this.visemeHoldTime += dtSeconds;
    const newViseme: AdobeViseme = selectViseme(scores, this.shape.viseme, this.visemeHoldTime, config);
    if (newViseme !== this.shape.viseme) {
      this.shape.viseme = newViseme;
      this.visemeHoldTime = 0;
    }

    const bands = features.bands;
    const targetOpen = Math.min(1, volume * 1.5 + (bands[2] + bands[3]) * 0.5);
    const targetSpread = Math.min(1, (bands[5] + bands[6]) * 1.5);
    const targetRound = Math.min(1, Math.max(0, bands[0] * 2 * (1 - targetSpread)));
    const attack = damp(config.attackFactor, dtSeconds);
    const decay = damp(config.decayFactor, dtSeconds);
    const shape = this.shape;
    shape.open += (targetOpen - shape.open) * (targetOpen > shape.open ? attack : decay);
    shape.spread += (targetSpread - shape.spread) * (targetSpread > shape.spread ? attack : decay);
    shape.round += (targetRound - shape.round) * (targetRound > shape.round ? attack : decay);
    shape.intensity = Math.min(1, volume * 2);
    return shape;
  }
}
