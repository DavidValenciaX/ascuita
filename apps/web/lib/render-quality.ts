/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { create } from 'zustand';

/**
 * Render quality tiers for the full-screen 3D avatar.
 *
 * Low-end Android GPUs (PowerVR GE8320, Mali-G52 MC2, TV SoCs...) are limited
 * by how many pixels they can shade per frame, so each tier mostly trades
 * resolution and post-processing passes.
 */
export type RenderQualityTier = 'low' | 'medium' | 'high';
export type RenderQualitySetting = 'auto' | RenderQualityTier;

export type RenderQualityProfile = {
  /** Upper bound for the renderer pixel ratio (CSS px → render px). */
  maxPixelRatio: number;
  /** Upper bound for rendered pixels (width × height) regardless of screen size. */
  maxRenderPixels: number;
  /**
   * none: draw straight to the screen with a cheap glow sprite.
   * fire: selective fire/body bloom only, at reduced resolution.
   * full: fire bloom + scene bloom at full resolution (original look).
   */
  postprocessing: 'none' | 'fire' | 'full';
  /** Fraction of the canvas resolution used by the bloom render targets. */
  bloomScale: number;
  shadows: boolean;
  /** Rim / fill / back / accent lights and PBR walls. */
  extraLights: boolean;
  /** Multiplier applied to the inner fire particle count. */
  particleFactor: number;
  maxFps: number;
  /** CSS backdrop-filter blur on overlays drawn above the animated canvas. */
  overlayBlur: boolean;
  /** Draw the 3D microphone button with its own WebGL context. */
  webglMicrophoneButton: boolean;
};

export const RENDER_QUALITY_PROFILES: Record<RenderQualityTier, RenderQualityProfile> = {
  low: {
    maxPixelRatio: 0.75,
    maxRenderPixels: 320_000,
    postprocessing: 'none',
    bloomScale: 0,
    shadows: false,
    extraLights: false,
    particleFactor: 0.3,
    maxFps: 30,
    overlayBlur: false,
    webglMicrophoneButton: false,
  },
  medium: {
    maxPixelRatio: 1,
    maxRenderPixels: 900_000,
    postprocessing: 'fire',
    bloomScale: 0.5,
    shadows: false,
    extraLights: false,
    particleFactor: 0.6,
    maxFps: 60,
    overlayBlur: true,
    webglMicrophoneButton: true,
  },
  high: {
    maxPixelRatio: 2,
    maxRenderPixels: Number.POSITIVE_INFINITY,
    postprocessing: 'full',
    bloomScale: 1,
    shadows: true,
    extraLights: true,
    particleFactor: 1,
    maxFps: 60,
    overlayBlur: true,
    webglMicrophoneButton: true,
  },
};

const TIER_ORDER: RenderQualityTier[] = ['low', 'medium', 'high'];

export function lowerTier(tier: RenderQualityTier): RenderQualityTier {
  return TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(tier) - 1)];
}

/** Pixel ratio for a canvas of `width × height` CSS px under a profile. */
export function resolvePixelRatio(
  profile: RenderQualityProfile,
  width: number,
  height: number,
  devicePixelRatio: number,
  dynamicScale = 1,
): number {
  const area = Math.max(1, width * height);
  const byPixelBudget = Math.sqrt(profile.maxRenderPixels / area);
  return Math.max(0.25, Math.min(devicePixelRatio, profile.maxPixelRatio, byPixelBudget) * dynamicScale);
}

// GPUs measured or known to struggle with a full-screen post-processed scene.
const WEAK_GPU_PATTERN = new RegExp(
  [
    'PowerVR', // GE8320 / GE8322 / GE8100 / GX6250 / SGX...
    'Mali-(?:T|4|G31|G51|G52|G57 MC1|G68 MC2)',
    'Adreno \\(TM\\) (?:[1-4]\\d\\d|50\\d|51\\d|60\\d|610|612|613)\\b',
    'Vivante',
    'VideoCore',
    'Intel\\(R\\) HD Graphics (?:[2-5]\\d{2}|Haswell|Bay ?Trail)',
    'SwiftShader', // software rendering
    'llvmpipe',
  ].join('|'),
  'i',
);
const TV_PATTERN = /Android TV|GoogleTV|Google TV|\bAFT\w*|BRAVIA|SmartTV|SMART-TV|AndroidTV|\bTV\b/i;

export type DeviceInfo = {
  gpuRenderer: string;
  userAgent: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  isCoarsePointer: boolean;
};

export function classifyDevice(info: DeviceInfo): RenderQualityTier {
  if (WEAK_GPU_PATTERN.test(info.gpuRenderer)) return 'low';
  if (TV_PATTERN.test(info.userAgent)) return 'low';
  const isMobile = /Android|iPhone|iPad|Mobile/i.test(info.userAgent) || info.isCoarsePointer;
  if (!isMobile) return 'high';
  if (info.deviceMemory !== undefined && info.deviceMemory <= 4) return 'low';
  if (info.hardwareConcurrency !== undefined && info.hardwareConcurrency <= 4) return 'low';
  return 'medium';
}

export function readGpuRenderer(): string {
  if (typeof document === 'undefined') return '';
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug
      ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? '')
      : String(gl.getParameter(gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return renderer;
  } catch {
    return '';
  }
}

function detectDeviceTier(): RenderQualityTier {
  if (typeof window === 'undefined') return 'high';
  const nav = navigator as Navigator & { deviceMemory?: number };
  return classifyDevice({
    gpuRenderer: readGpuRenderer(),
    userAgent: nav.userAgent,
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    isCoarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
  });
}

/**
 * Detects sustained slow frames. Feed it the interval between rendered frames;
 * it reports `true` once the average over a window is clearly over budget.
 */
export class FrameRateMonitor {
  private elapsedMs = 0;
  private windowMs = 0;
  private frames = 0;

  constructor(
    private readonly targetFps: number,
    private readonly warmupMs = 4000,
    private readonly sampleWindowMs = 3000,
    /** Allowed slowdown over the frame budget before reporting. */
    private readonly tolerance = 1.35,
  ) {}

  reset() {
    this.elapsedMs = 0;
    this.windowMs = 0;
    this.frames = 0;
  }

  /** Returns true when the last full window was too slow. */
  sample(frameMs: number): boolean {
    // Ignore stalls (tab switches, GC pauses, shader compiles).
    if (frameMs <= 0 || frameMs > 250) return false;
    this.elapsedMs += frameMs;
    if (this.elapsedMs < this.warmupMs) return false;
    this.windowMs += frameMs;
    this.frames += 1;
    if (this.windowMs < this.sampleWindowMs) return false;
    const averageMs = this.windowMs / this.frames;
    this.windowMs = 0;
    this.frames = 0;
    return averageMs > (1000 / this.targetFps) * this.tolerance;
  }
}

const SETTING_KEY = 'ascuita.renderQuality';
const AUTO_TIER_KEY = 'ascuita.renderQuality.autoTier';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode); the setting just won't persist.
  }
}

function isTier(value: unknown): value is RenderQualityTier {
  return value === 'low' || value === 'medium' || value === 'high';
}

function initialSetting(): RenderQualitySetting {
  const stored = typeof window === 'undefined' ? null : readStorage(SETTING_KEY);
  return stored === 'auto' || isTier(stored) ? stored : 'auto';
}

function initialAutoTier(): RenderQualityTier {
  const detected = detectDeviceTier();
  const stored = typeof window === 'undefined' ? null : readStorage(AUTO_TIER_KEY);
  // A previous session may have stepped down after measuring real frame times.
  if (isTier(stored) && TIER_ORDER.indexOf(stored) < TIER_ORDER.indexOf(detected)) return stored;
  return detected;
}

export function resolveTier(setting: RenderQualitySetting, autoTier: RenderQualityTier): RenderQualityTier {
  return setting === 'auto' ? autoTier : setting;
}

export const useRenderQuality = create<{
  setting: RenderQualitySetting;
  autoTier: RenderQualityTier;
  tier: RenderQualityTier;
  setSetting: (setting: RenderQualitySetting) => void;
  /** Called by the renderer when frames are consistently too slow. */
  reportSlowFrames: () => void;
}>((set, get) => {
  const setting = initialSetting();
  const autoTier = initialAutoTier();
  return {
    setting,
    autoTier,
    tier: resolveTier(setting, autoTier),
    setSetting: next => {
      writeStorage(SETTING_KEY, next);
      set({ setting: next, tier: resolveTier(next, get().autoTier) });
    },
    reportSlowFrames: () => {
      const { setting: current, autoTier: currentAuto } = get();
      if (current !== 'auto') return;
      const next = lowerTier(currentAuto);
      if (next === currentAuto) return;
      writeStorage(AUTO_TIER_KEY, next);
      set({ autoTier: next, tier: next });
    },
  };
});
