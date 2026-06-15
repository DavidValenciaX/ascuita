/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { SpeechAnimationConfig } from '../../lib/state';

export type AdobeViseme =
  | 'Neutral'
  | 'M'
  | 'F'
  | 'L'
  | 'D'
  | 'S'
  | 'R'
  | 'Ah'
  | 'Ee'
  | 'Oh'
  | 'Uh'
  | 'WO-o'
  | 'Smile'
  | 'Surprised';

export type MouthShape = {
  viseme: AdobeViseme;
  intensity: number;
  open: number;
  spread: number;
  round: number;
};

export interface AudioFeatures {
  bands: number[];
  deltaBands: number[];
  volume: number;
  centroid: number;
}

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

  if (volume < config.silenceThreshold) {
    scores.Neutral = 1;
    return scores;
  }

  const normalizedBands = bands.map((b, i) =>
    avgFeatures.bands[i] > 0 ? b / avgFeatures.bands[i] : b
  );

  const lowEnergy = (normalizedBands[0] + normalizedBands[1] + normalizedBands[2]) / 3;
  const midEnergy = (normalizedBands[3] + normalizedBands[4] + normalizedBands[5]) / 3;
  const highEnergy = (normalizedBands[6] + normalizedBands[7]) / 2;

  if (deltaVolume > 0.15 && lowEnergy > midEnergy * 0.8) {
    scores.M = 0.6 + deltaVolume * 0.4;
  }

  if (highEnergy > 0.4 && centroid > 3000) {
    scores.F = 0.5 + highEnergy * 0.3;
  }

  if (midEnergy > 0.3 && highEnergy > 0.2 && volume < 0.6) {
    scores.D = 0.4 + midEnergy * 0.3;
  }

  if (lowEnergy > 0.4 && midEnergy > 0.2 && highEnergy < 0.2) {
    scores.L = 0.5 + lowEnergy * 0.3;
  }

  if (highEnergy > 0.6 && centroid > 4000) {
    scores.S = 0.7 + highEnergy * 0.3;
  }

  if (midEnergy > 0.3 && lowEnergy > 0.2 && highEnergy < 0.25) {
    scores.R = 0.4 + midEnergy * 0.3;
  }

  if (lowEnergy > 0.5 && midEnergy > 0.4 && highEnergy < 0.3) {
    scores.Ah = 0.6 + volume * 0.3;
  }

  if (highEnergy > 0.25 && midEnergy > 0.3 && centroid > 2000) {
    scores.Ee = 0.5 + highEnergy * 0.3;
  }

  if (lowEnergy > 0.4 && midEnergy > 0.2 && midEnergy < 0.5 && highEnergy < 0.2) {
    scores.Oh = 0.5 + lowEnergy * 0.3;
  }

  if (lowEnergy > 0.3 && midEnergy > 0.2 && midEnergy < 0.4 && highEnergy < 0.15) {
    scores.Uh = 0.5 + lowEnergy * 0.25;
  }

  if (lowEnergy > 0.5 && midEnergy < 0.3 && highEnergy < 0.15 && centroid < 1000) {
    scores['WO-o'] = 0.6 + lowEnergy * 0.3;
  }

  if (deltaVolume > 0.25 && highEnergy > 0.5 && volume > 0.7) {
    scores.Surprised = 0.4 + deltaVolume * 0.4;
  }

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

function selectViseme(
  scores: Record<AdobeViseme, number>,
  currentViseme: AdobeViseme,
  holdTime: number,
  config: SpeechAnimationConfig
): AdobeViseme {
  let maxScore = 0;
  let winningViseme: AdobeViseme = 'Neutral';

  for (const [viseme, score] of Object.entries(scores)) {
    const adjustedScore = viseme === currentViseme ? score * config.currentVisemeBoost : score;
    if (adjustedScore > maxScore) {
      maxScore = adjustedScore;
      winningViseme = viseme as AdobeViseme;
    }
  }

  if (winningViseme !== currentViseme && holdTime < config.minHoldTime) {
    return currentViseme;
  }

  if (winningViseme !== currentViseme && maxScore < config.minSwitchScore) {
    return currentViseme;
  }

  return winningViseme;
}

export { computeVisemeScores, selectViseme, easeOutQuint, clamp, smoothstep };

function drawSmileLine(ctx: CanvasRenderingContext2D, width: number, lift: number) {
  ctx.beginPath();
  ctx.moveTo(-width / 2, 4);
  ctx.quadraticCurveTo(0, 22 + lift, width / 2, 4);
  ctx.stroke();
}

function drawFriendlyMouth(ctx: CanvasRenderingContext2D, mouthShape: MouthShape) {
  ctx.clearRect(0, 0, 256, 256);
  ctx.save();
  ctx.translate(128, 132);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1F2430';
  ctx.fillStyle = '#1F2430';

  if (mouthShape.viseme === 'Neutral') {
    ctx.lineWidth = 14;
    drawSmileLine(ctx, 74, -4);
    ctx.restore();
    return;
  }

  if (mouthShape.viseme === 'M') {
    ctx.lineWidth = 18;
    drawSmileLine(ctx, 58, -12);
    ctx.restore();
    return;
  }

  if (mouthShape.viseme === 'Smile') {
    ctx.lineWidth = 16;
    drawSmileLine(ctx, 104, 6);
    ctx.restore();
    return;
  }

  const isRoundMouth = ['Oh', 'Uh', 'WO-o', 'Surprised'].includes(mouthShape.viseme);
  const openness = Math.max(
    mouthShape.open,
    mouthShape.viseme === 'Surprised' ? 0.75 : isRoundMouth ? 0.42 : 0.25
  );
  const spread = Math.max(mouthShape.spread, mouthShape.viseme === 'Ee' ? 0.58 : 0.22);
  const roundness = Math.max(mouthShape.round, isRoundMouth ? 0.7 : 0.15);
  const mouthWidth = isRoundMouth ? 52 + roundness * 34 : 70 + spread * 62;
  const mouthHeight = 22 + openness * 76;
  const top = -mouthHeight / 2 + 8;

  ctx.beginPath();
  ctx.ellipse(0, top + mouthHeight / 2, mouthWidth / 2, mouthHeight / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  if (mouthHeight > 44) {
    const tongueGradient = ctx.createLinearGradient(0, top + mouthHeight * 0.45, 0, top + mouthHeight);
    tongueGradient.addColorStop(0, '#FF9AB5');
    tongueGradient.addColorStop(1, '#FF6F9A');
    ctx.fillStyle = tongueGradient;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.ellipse(0, top + mouthHeight * 0.65, mouthWidth * 0.28, mouthHeight * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function getMouthSignature(mouthShape: MouthShape) {
  return [
    mouthShape.viseme,
    mouthShape.intensity.toFixed(2),
    mouthShape.open.toFixed(2),
    mouthShape.spread.toFixed(2),
    mouthShape.round.toFixed(2),
  ].join(':');
}

export { drawSmileLine, drawFriendlyMouth, getMouthSignature };
