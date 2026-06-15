export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type InnerFireConfig = {
  transform: {
    x: number;
    y: number;
    z: number;
  };
  bloom: {
    strength: number;
    radius: number;
    threshold: number;
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
    y: -0.2,
    z: -0.04,
  },
  bloom: {
    strength: 0.5,
    radius: 0.5,
    threshold: 0.1,
  },
  particles: {
    count: 2000,
    spawnRadius: 0.1,
    spawnHeight: 1.18,
    velXZ: 0.01,
    velYBase: 0.003,
    velYRand: 0.003,
    lifetimeSpeed: 0.01,
    sway: 0.0038,
    swaySpeed: 5.2,
    taper: 0.96,
    size: 0.8,
    opacity: 0.5,
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
    idleXZ: 2.0,
    idleY: 2.0,
    talkingXZ: 2.05,
    talkingY: 2.22,
  },
};

export function cloneInnerFireConfig(config: InnerFireConfig): InnerFireConfig {
  return JSON.parse(JSON.stringify(config)) as InnerFireConfig;
}

export function normalizeInnerFireConfig(
  config: DeepPartial<InnerFireConfig>
): InnerFireConfig {
  return mergeInnerFireConfig(
    cloneInnerFireConfig(defaultInnerFireConfig),
    config
  );
}

export function mergeInnerFireConfig(
  target: InnerFireConfig,
  source: DeepPartial<InnerFireConfig>
): InnerFireConfig {
  const output = cloneInnerFireConfig(target);

  (Object.keys(target) as (keyof InnerFireConfig)[]).forEach(key => {
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

