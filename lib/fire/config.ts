export const FIRE_PALETTES = {
  'classic-fire': {
    label: 'Classic Fire',
    description: 'White-hot core with yellow, orange and deep red edges.',
    stops: [0xfff4d6, 0xffd35a, 0xff7a1a, 0xd63200, 0x250200] as const,
  },
  'ember-fire': {
    label: 'Ember Fire',
    description: 'A softer bonfire look with golden mids and smoky crimson falloff.',
    stops: [0xffe7c2, 0xffb347, 0xff6a2a, 0xa61e18, 0x1b0506] as const,
  },
  'blue-flame': {
    label: 'Blue Flame',
    description: 'Gas-burner style flame with pale cyan center and cobalt exterior.',
    stops: [0xeafcff, 0x8be9ff, 0x2c9dff, 0x1d4ed8, 0x020617] as const,
  },
  'torch-fire': {
    label: 'Torch Fire',
    description: 'Tiki-torch style flame with bright cream core and warm brown tail.',
    stops: [0xfff2c2, 0xffc15a, 0xf08a1a, 0x8a3c0c, 0x1a0904] as const,
  },
  'candle-fire': {
    label: 'Candle Fire',
    description: 'Subtle candle glow with a gentle warm core and amber falloff.',
    stops: [0xfff0d2, 0xffd089, 0xf0a55a, 0x8a5a2a, 0x1c0f06] as const,
  },
  'forge-fire': {
    label: 'Forge Fire',
    description: 'Blacksmith forge with bright sparks and cherry-red heat haze.',
    stops: [0xfff6b8, 0xffb24a, 0xf2551c, 0x9b1a0a, 0x0d0202] as const,
  },
  'green-flame': {
    label: 'Green Flame',
    description: 'Boric-acid style flame with mint core and emerald exterior.',
    stops: [0xeaffd8, 0xa6f0a3, 0x4ad17c, 0x0a8a4a, 0x02180f] as const,
  },
  'violet-flame': {
    label: 'Violet Flame',
    description: 'Potassium flame with lavender core and deep violet falloff.',
    stops: [0xfae0ff, 0xd49cff, 0x9a55e6, 0x4f1aa6, 0x0a031a] as const,
  },
  'mono-amber': {
    label: 'Mono Amber',
    description: 'Monochromatic warm flame built from bright amber into burnt bronze.',
    stops: [0xfff1c2, 0xffca6b, 0xffa230, 0xb45d13, 0x221104] as const,
  },
  'mono-crimson': {
    label: 'Mono Crimson',
    description: 'Monochromatic red flame with a bright ruby core and wine-dark fade.',
    stops: [0xffd7dc, 0xff8a98, 0xf14b63, 0x8f1732, 0x18030a] as const,
  },
  'mono-cobalt': {
    label: 'Mono Cobalt',
    description: 'Monochromatic cool flame that stays readable with layered blue values.',
    stops: [0xdff4ff, 0x9ed8ff, 0x5ca9ff, 0x2859c5, 0x050b1f] as const,
  },
  'mono-emerald': {
    label: 'Mono Emerald',
    description: 'Monochromatic green flame in a balanced, easy-to-read range.',
    stops: [0xdffce5, 0x9ee3ad, 0x4cc278, 0x16784a, 0x04150c] as const,
  },
  'mono-violet': {
    label: 'Mono Violet',
    description: 'Monochromatic purple flame with a bright lilac core and indigo tail.',
    stops: [0xf0dfff, 0xc79aff, 0x9256f0, 0x4a1c9c, 0x09031a] as const,
  },
  'mono-rose': {
    label: 'Mono Rose',
    description: 'Monochromatic pink flame with a hot magenta core and burgundy falloff.',
    stops: [0xffd9ec, 0xff9ec5, 0xf0568a, 0x8a1c4a, 0x180410] as const,
  },
} as const;

export type FirePaletteId = keyof typeof FIRE_PALETTES;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type InnerFireConfig = {
  transform: {
    x: number;
    y: number;
    z: number;
  };
  particles: {
    count: number;
    spawnRadius: number;
    spawnHeight: number;
    velXZ: number;
    velYBase: number;
    velYRand: number;
    lifetimeSpeed: number;
    sway: number;
    swaySpeed: number;
    taper: number;
    size: number;
    opacity: number;
  };
  palette: {
    selected: FirePaletteId;
  };
  color: {
    threshold1: number;
    threshold2: number;
    threshold3: number;
  };
  texture: {
    size: number;
    coreOpacity: number;
    midOpacity: number;
    edgeOpacity: number;
    midStop: number;
  };
  scale: {
    idleXZ: number;
    idleY: number;
    talkingXZ: number;
    talkingY: number;
  };
};

export const defaultInnerFireConfig: InnerFireConfig = {
  transform: {
    x: 0,
    y: -0.86,
    z: -0.04,
  },
  particles: {
    count: 1800,
    spawnRadius: 0.16,
    spawnHeight: 1.18,
    velXZ: 0.018,
    velYBase: 0.022,
    velYRand: 0.032,
    lifetimeSpeed: 0.018,
    sway: 0.0038,
    swaySpeed: 5.2,
    taper: 0.962,
    size: 0.26,
    opacity: 0.88,
  },
  palette: {
    selected: 'classic-fire',
  },
  color: {
    threshold1: 0.08,
    threshold2: 0.34,
    threshold3: 0.8,
  },
  texture: {
    size: 64,
    coreOpacity: 1,
    midOpacity: 0.68,
    edgeOpacity: 0,
    midStop: 0.32,
  },
  scale: {
    idleXZ: 0.92,
    idleY: 0.98,
    talkingXZ: 1.05,
    talkingY: 1.22,
  },
};

export function cloneInnerFireConfig(config: InnerFireConfig): InnerFireConfig {
  return JSON.parse(JSON.stringify(config)) as InnerFireConfig;
}

export function mergeInnerFireConfig(
  target: InnerFireConfig,
  source: DeepPartial<InnerFireConfig>
): InnerFireConfig {
  const output = cloneInnerFireConfig(target);

  (Object.keys(source) as (keyof InnerFireConfig)[]).forEach(key => {
    const value = source[key];
    if (!value) return;

    if (typeof value === 'object' && !Array.isArray(value)) {
      output[key] = { ...output[key], ...value } as never;
      return;
    }

    output[key] = value as never;
  });

  return output;
}

