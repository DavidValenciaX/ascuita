/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useRef, useState } from 'react';
import { useLiveAPIContext } from '../../contexts/LiveAPIContext';
import { SpeechAnimationConfig, useSpeechAnimation } from '../../lib/state';

/**
 * Adobe Character Animator inspired viseme types (14 visemes)
 * These represent specific mouth positions for different phonemes
 */
export type AdobeViseme =
  | 'Neutral'   // Silence/Rest
  | 'M'         // M, B, P - Bilabial plosives (closed lips)
  | 'F'         // F, V - Labiodental fricatives (teeth on lip)
  | 'L'         // L, TH - Tongue visible
  | 'D'         // D, T, N - Alveolar consonants
  | 'S'         // S, Z - Sibilants
  | 'R'         // R sounds
  | 'Ah'        // A vowel (wide open)
  | 'Ee'        // E, I vowel (spread)
  | 'Oh'        // O vowel (rounded)
  | 'Uh'        // U vowel
  | 'WO-o'      // W, OO (puckered/rounded)
  | 'Smile'     // Expression: Happy/Smile
  | 'Surprised'; // Expression: Surprised/Shock

export type MouthShape = {
  /** Current Adobe Character Animator viseme being displayed */
  viseme: AdobeViseme;
  /** Intensity/weight of the current viseme (0-1) */
  intensity: number;
  /** Raw openness value for fine-tuning */
  open: number;
  /** Raw spread value for fine-tuning */
  spread: number;
  /** Raw roundness value for fine-tuning */
  round: number;
};

function easeOutQuint(x: number): number {
  return 1 - Math.pow(1 - x, 5);
}

function clamp(x: number, lowerlimit: number, upperlimit: number) {
  if (x < lowerlimit) x = lowerlimit;
  if (x > upperlimit) x = upperlimit;
  return x;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  x = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

type BlinkProps = {
  speed: number;
};

export function useBlink({ speed }: BlinkProps) {
  const [eyeScale, setEyeScale] = useState(1);
  const [frame, setFrame] = useState(0);
  const frameId = useRef(-1);

  useEffect(() => {
    function nextFrame() {
      frameId.current = globalThis.requestAnimationFrame(() => {
        setFrame(frame + 1);
        let s = easeOutQuint((Math.sin(frame * speed) + 1) * 2);
        s = smoothstep(0.1, 0.25, s);
        s = Math.min(1, s);
        setEyeScale(s);
        nextFrame();
      });
    }

    nextFrame();

    return () => {
      globalThis.cancelAnimationFrame(frameId.current);
    };
  }, [speed, eyeScale, frame]);

  return eyeScale;
}

const lerp = (start: number, end: number, factor: number) => start + (end - start) * factor;

/**
 * Feature extraction for audio analysis
 */
interface AudioFeatures {
  /** Frequency bands (normalized) */
  bands: number[];
  /** Rate of change in bands */
  deltaBands: number[];
  /** Overall volume */
  volume: number;
  /** Spectral centroid (brightness) */
  centroid: number;
}

/**
 * Computes viseme scores based on audio features
 * Algorithm maps audio characteristics to Adobe Character Animator visemes
 */
function computeVisemeScores(
  features: AudioFeatures,
  avgFeatures: AudioFeatures,
  deltaVolume: number,
  _deltaCentroid: number,
  config: SpeechAnimationConfig
): Record<AdobeViseme, number> {
  const scores: Record<AdobeViseme, number> = {
    Neutral: 0, M: 0, F: 0, L: 0, D: 0, S: 0, R: 0,
    Ah: 0, Ee: 0, Oh: 0, Uh: 0, 'WO-o': 0, Smile: 0, Surprised: 0
  };

  const { bands, volume, centroid } = features;

  // Silence detection
  if (volume < config.silenceThreshold) {
    scores.Neutral = 1;
    return scores;
  }

  // Normalize bands relative to average
  const normalizedBands = bands.map((b, i) =>
    avgFeatures.bands[i] > 0 ? b / avgFeatures.bands[i] : b
  );

  // Low frequencies (0-500Hz) - indices 0-2
  const lowEnergy = (normalizedBands[0] + normalizedBands[1] + normalizedBands[2]) / 3;

  // Mid frequencies (500-2000Hz) - indices 3-5
  const midEnergy = (normalizedBands[3] + normalizedBands[4] + normalizedBands[5]) / 3;

  // High frequencies (2000-8000Hz) - indices 6-7
  const highEnergy = (normalizedBands[6] + normalizedBands[7]) / 2;

  // --- M: Bilabials (M, B, P) ---
  // Sharp volume burst after silence, low frequencies dominate
  if (deltaVolume > 0.15 && lowEnergy > midEnergy * 0.8) {
    scores.M = 0.6 + deltaVolume * 0.4;
  }

  // --- F: Labiodentals (F, V) ---
  // High frequency friction noise
  if (highEnergy > 0.4 && centroid > 3000) {
    scores.F = 0.5 + highEnergy * 0.3;
  }

  // --- D: Alveolars (D, T, N) ---
  // Mid-high frequencies with moderate volume
  if (midEnergy > 0.3 && highEnergy > 0.2 && volume < 0.6) {
    scores.D = 0.4 + midEnergy * 0.3;
  }

  // --- L: Tongue visible (L, TH) ---
  // Low frequencies with resonance, moderate volume
  if (lowEnergy > 0.4 && midEnergy > 0.2 && highEnergy < 0.2) {
    scores.L = 0.5 + lowEnergy * 0.3;
  }

  // --- S: Sibilants (S, Z) ---
  // Very strong high frequencies
  if (highEnergy > 0.6 && centroid > 4000) {
    scores.S = 0.7 + highEnergy * 0.3;
  }

  // --- R: R sounds ---
  // Mid frequencies, rounded
  if (midEnergy > 0.3 && lowEnergy > 0.2 && highEnergy < 0.25) {
    scores.R = 0.4 + midEnergy * 0.3;
  }

  // --- Vowels ---
  // They have strong formants in specific frequency ranges

  // Ah (open A) - strong low-mid, moderate high
  if (lowEnergy > 0.5 && midEnergy > 0.4 && highEnergy < 0.3) {
    scores.Ah = 0.6 + volume * 0.3;
  }

  // Ee (E, I) - high formant, spread mouth
  if (highEnergy > 0.25 && midEnergy > 0.3 && centroid > 2000) {
    scores.Ee = 0.5 + highEnergy * 0.3;
  }

  // Oh (O) - round, low-mid frequencies
  if (lowEnergy > 0.4 && midEnergy > 0.2 && midEnergy < 0.5 && highEnergy < 0.2) {
    scores.Oh = 0.5 + lowEnergy * 0.3;
  }

  // Uh (U) - mid-low frequencies
  if (lowEnergy > 0.3 && midEnergy > 0.2 && midEnergy < 0.4 && highEnergy < 0.15) {
    scores.Uh = 0.5 + lowEnergy * 0.25;
  }

  // WO-o (W, OO) - very low frequencies, puckered
  if (lowEnergy > 0.5 && midEnergy < 0.3 && highEnergy < 0.15 && centroid < 1000) {
    scores['WO-o'] = 0.6 + lowEnergy * 0.3;
  }

  // --- Expressions (triggered by specific audio patterns) ---

  // Surprised - sudden loud high-frequency burst
  if (deltaVolume > 0.25 && highEnergy > 0.5 && volume > 0.7) {
    scores.Surprised = 0.4 + deltaVolume * 0.4;
  }

  // Smile - sustained mid-high frequencies with moderate volume (less common during speech)
  // This is more of a secondary expression, rarely triggered by audio alone

  if (config.enableVolumeFallback) {
    const fallbackBase = Math.min(1, volume * config.fallbackVolumeMultiplier);
    const fallbackScore = config.fallbackScoreBase + fallbackBase * config.fallbackScoreWeight;
    if (highEnergy > midEnergy && highEnergy > lowEnergy) {
      scores.Ee = Math.max(scores.Ee, fallbackScore);
    } else if (lowEnergy > midEnergy && centroid < config.fallbackCentroidThreshold) {
      scores.Oh = Math.max(scores.Oh, fallbackScore);
    } else {
      scores.Ah = Math.max(scores.Ah, fallbackScore);
    }
  }

  return scores;
}

/**
 * Select the winning viseme based on scores with consistency adjustment
 */
function selectViseme(
  scores: Record<AdobeViseme, number>,
  currentViseme: AdobeViseme,
  holdTime: number,
  config: SpeechAnimationConfig
): AdobeViseme {
  // Find highest scoring viseme
  let maxScore = 0;
  let winningViseme: AdobeViseme = 'Neutral';

  for (const [viseme, score] of Object.entries(scores)) {
    // Boost current viseme slightly to prevent jitter
    const adjustedScore = viseme === currentViseme ? score * config.currentVisemeBoost : score;
    if (adjustedScore > maxScore) {
      maxScore = adjustedScore;
      winningViseme = viseme as AdobeViseme;
    }
  }

  // Only switch if held long enough and score is significant
  if (winningViseme !== currentViseme && holdTime < config.minHoldTime) {
    return currentViseme;
  }

  // Require minimum score to switch from current
  if (winningViseme !== currentViseme && maxScore < config.minSwitchScore) {
    return currentViseme;
  }

  return winningViseme;
}

export default function useFace() {
  const { audioStreamer } = useLiveAPIContext();
  const speechAnimationConfig = useSpeechAnimation(state => state.config);
  const eyeScale = useBlink({ speed: 0.0125 });

  const [mouthShape, setMouthShape] = useState<MouthShape>({
    viseme: 'Neutral',
    intensity: 0,
    open: 0,
    spread: 0,
    round: 0,
  });

  // Refs for analysis state
  const currentShape = useRef({ open: 0, spread: 0, round: 0 });
  const currentViseme = useRef<AdobeViseme>('Neutral');
  const visemeHoldTime = useRef(0);

  // History for averaging and deltas
  const featureHistory = useRef<AudioFeatures[]>([]);
  const avgFeatures = useRef<AudioFeatures>({
    bands: new Array(8).fill(0.1),
    deltaBands: new Array(8).fill(0),
    volume: 0.1,
    centroid: 1000
  });
  const lastVolume = useRef(0);
  const lastCentroid = useRef(0);

  useEffect(() => {
    if (!audioStreamer) return;

    const analyser = audioStreamer.analyser;
    analyser.smoothingTimeConstant = speechAnimationConfig.analyserSmoothing;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let animationFrameId: number;
    let lastTime = performance.now();

    const analyze = () => {
      animationFrameId = requestAnimationFrame(analyze);

      const currentTime = performance.now();
      const deltaTime = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      analyser.getByteFrequencyData(dataArray);

      // Extract frequency bands (8 bands for detailed analysis)
      // Sample rate is 24000Hz, FFT size 512 -> ~46.8Hz per bin
      const bandRanges = [
        [1, 3],     // ~47-140Hz (Low bass)
        [3, 6],     // ~140-280Hz (Bass/Fundamental)
        [6, 11],    // ~280-515Hz (Low mids)
        [11, 22],   // ~515-1030Hz (Mids)
        [22, 43],   // ~1030-2015Hz (Upper mids)
        [43, 86],   // ~2015-4030Hz (High mids)
        [86, 128],  // ~4030-6000Hz (Highs)
        [128, 170], // ~6000-8000Hz (Very high)
      ];

      const bands: number[] = [];
      let totalEnergy = 0;
      let weightedSum = 0;

      for (const [start, end] of bandRanges) {
        let sum = 0;
        const count = Math.min(end, bufferLength) - start;
        for (let i = start; i < Math.min(end, bufferLength); i++) {
          const val = dataArray[i] / 255;
          sum += val;
          totalEnergy += val;
          weightedSum += val * i * 46.8; // Weighted by frequency
        }
        bands.push(count > 0 ? sum / count : 0);
      }

      // Calculate volume and centroid
      const volume = Math.min(1, totalEnergy / bufferLength);
      const centroid = totalEnergy > 0 ? weightedSum / totalEnergy : 0;

      // Calculate deltas
      const deltaVolume = volume - lastVolume.current;
      const deltaCentroid = centroid - lastCentroid.current;
      lastVolume.current = volume;
      lastCentroid.current = centroid;

      // Calculate delta bands from history
      const deltaBands = bands.map((b, i) => {
        const lastBands = featureHistory.current[featureHistory.current.length - 1]?.bands;
        return lastBands ? b - lastBands[i] : 0;
      });

      const features: AudioFeatures = { bands, deltaBands, volume, centroid };

      // Update history and running average
      featureHistory.current.push(features);
      if (featureHistory.current.length > speechAnimationConfig.featureHistoryFrames) {
        featureHistory.current.shift();
      }

      // Update running average
      if (featureHistory.current.length > 0) {
        const avgBands = new Array(8).fill(0);
        let avgVol = 0;
        let avgCent = 0;
        for (const f of featureHistory.current) {
          f.bands.forEach((b, i) => avgBands[i] += b);
          avgVol += f.volume;
          avgCent += f.centroid;
        }
        const len = featureHistory.current.length;
        avgFeatures.current = {
          bands: avgBands.map(b => b / len),
          deltaBands: new Array(8).fill(0),
          volume: avgVol / len,
          centroid: avgCent / len
        };
      }

      // Compute viseme scores
      const scores = computeVisemeScores(
        features,
        avgFeatures.current,
        deltaVolume,
        deltaCentroid,
        speechAnimationConfig
      );

      // Update hold time
      visemeHoldTime.current += deltaTime;

      // Select winning viseme
      const newViseme = selectViseme(
        scores,
        currentViseme.current,
        visemeHoldTime.current,
        speechAnimationConfig
      );

      if (newViseme !== currentViseme.current) {
        currentViseme.current = newViseme;
        visemeHoldTime.current = 0;
      }

      // Calculate shape parameters based on features
      const targetOpen = Math.min(1, volume * 1.5 + (bands[2] + bands[3]) * 0.5);
      const targetSpread = Math.min(1, (bands[5] + bands[6]) * 1.5);
      const targetRound = Math.min(1, Math.max(0, bands[0] * 2 * (1 - targetSpread)));

      // Smooth shape transitions
      const attackFactor = speechAnimationConfig.attackFactor;
      const decayFactor = speechAnimationConfig.decayFactor;

      const openFactor = targetOpen > currentShape.current.open ? attackFactor : decayFactor;
      const spreadFactor = targetSpread > currentShape.current.spread ? attackFactor : decayFactor;
      const roundFactor = targetRound > currentShape.current.round ? attackFactor : decayFactor;

      currentShape.current.open = lerp(currentShape.current.open, targetOpen, openFactor);
      currentShape.current.spread = lerp(currentShape.current.spread, targetSpread, spreadFactor);
      currentShape.current.round = lerp(currentShape.current.round, targetRound, roundFactor);

      // Calculate intensity
      const intensity = Math.min(1, volume * 2);

      setMouthShape({
        viseme: currentViseme.current,
        intensity,
        open: currentShape.current.open,
        spread: currentShape.current.spread,
        round: currentShape.current.round,
      });
    };

    analyze();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [audioStreamer, speechAnimationConfig]);

  return { eyeScale, mouthShape };
}
