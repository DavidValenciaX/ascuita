/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useRef, useState } from 'react';
import { useLiveAPIContext } from '../../contexts/LiveAPIContext';
import { useSpeechAnimation } from '../../lib/state';
import type { AdobeViseme, AudioFeatures, MouthShape } from './mouth-config';
import { computeVisemeScores, selectViseme } from './mouth-config';

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

  const currentShape = useRef({ open: 0, spread: 0, round: 0 });
  const currentViseme = useRef<AdobeViseme>('Neutral');
  const visemeHoldTime = useRef(0);

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

      const bandRanges = [
        [1, 3],
        [3, 6],
        [6, 11],
        [11, 22],
        [22, 43],
        [43, 86],
        [86, 128],
        [128, 170],
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
          weightedSum += val * i * 46.8;
        }
        bands.push(count > 0 ? sum / count : 0);
      }

      const volume = Math.min(1, totalEnergy / bufferLength);
      const centroid = totalEnergy > 0 ? weightedSum / totalEnergy : 0;

      const deltaVolume = volume - lastVolume.current;
      const deltaCentroid = centroid - lastCentroid.current;
      lastVolume.current = volume;
      lastCentroid.current = centroid;

      const deltaBands = bands.map((b, i) => {
        const lastBands = featureHistory.current[featureHistory.current.length - 1]?.bands;
        return lastBands ? b - lastBands[i] : 0;
      });

      const features: AudioFeatures = { bands, deltaBands, volume, centroid };

      featureHistory.current.push(features);
      if (featureHistory.current.length > speechAnimationConfig.featureHistoryFrames) {
        featureHistory.current.shift();
      }

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

      const scores = computeVisemeScores(
        features,
        avgFeatures.current,
        deltaVolume,
        deltaCentroid,
        speechAnimationConfig
      );

      visemeHoldTime.current += deltaTime;

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

      const targetOpen = Math.min(1, volume * 1.5 + (bands[2] + bands[3]) * 0.5);
      const targetSpread = Math.min(1, (bands[5] + bands[6]) * 1.5);
      const targetRound = Math.min(1, Math.max(0, bands[0] * 2 * (1 - targetSpread)));

      const attackFactor = speechAnimationConfig.attackFactor;
      const decayFactor = speechAnimationConfig.decayFactor;

      const openFactor = targetOpen > currentShape.current.open ? attackFactor : decayFactor;
      const spreadFactor = targetSpread > currentShape.current.spread ? attackFactor : decayFactor;
      const roundFactor = targetRound > currentShape.current.round ? attackFactor : decayFactor;

      currentShape.current.open = lerp(currentShape.current.open, targetOpen, openFactor);
      currentShape.current.spread = lerp(currentShape.current.spread, targetSpread, spreadFactor);
      currentShape.current.round = lerp(currentShape.current.round, targetRound, roundFactor);

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
