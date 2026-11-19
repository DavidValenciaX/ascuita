import * as THREE from 'three';
import {
  cloneInnerFireConfig,
  defaultInnerFireConfig,
  DeepPartial,
  InnerFireConfig,
  mergeInnerFireConfig,
} from './config';

const DEFAULT_AVATAR_FIRE_COLOR = '#5B9BF5';
const PALETTE_LUT_SIZE = 256;

export type InnerFireSystem = {
  root: THREE.Group;
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  setAvatarColor: (nextAvatarColor: string) => void;
  applyConfig: (overrides: DeepPartial<InnerFireConfig>) => void;
  replaceConfig: (nextConfig: InnerFireConfig) => void;
  /** `dtSeconds` is the real frame time; particle speeds are tuned for 60 fps. */
  update: (elapsedSeconds: number, isTalking: boolean, dtSeconds?: number) => void;
  dispose: () => void;
};

/** Same as a per-frame lerp factor tuned at 60 fps, but frame-rate independent. */
function damp(perFrameFactor: number, dtSeconds: number): number {
  return 1 - Math.pow(1 - perFrameFactor, dtSeconds * 60);
}

function buildFireSpriteTexture(
  config: InnerFireConfig,
  avatarColor: string
): THREE.CanvasTexture {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = config.texture.size;
  textureCanvas.height = config.texture.size;

  const context = textureCanvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create fire sprite texture.');
  }

  const spriteBaseColor = new THREE.Color(avatarColor || DEFAULT_AVATAR_FIRE_COLOR);
  const spriteHsl: THREE.HSL = { h: 0, s: 0, l: 0 };
  spriteBaseColor.getHSL(spriteHsl);

  const hue = spriteHsl.h;
  const saturation = THREE.MathUtils.clamp(Math.max(spriteHsl.s, 0.5), 0, 1);
  const lightness = THREE.MathUtils.clamp(spriteHsl.l, 0.28, 0.62);
  const spriteCoreColor = new THREE.Color().setHSL(
    hue,
    THREE.MathUtils.clamp(saturation * 0.92, 0, 1),
    THREE.MathUtils.clamp(lightness + 0.08, 0.4, 0.68)
  );
  const spriteMidColor = new THREE.Color().setHSL(
    hue,
    THREE.MathUtils.clamp(saturation * 0.98, 0, 1),
    THREE.MathUtils.clamp(lightness + 0.02, 0.34, 0.58)
  );
  const spriteEdgeColor = new THREE.Color().setHSL(
    hue,
    THREE.MathUtils.clamp(saturation * 0.9, 0, 1),
    THREE.MathUtils.clamp(lightness - 0.1, 0.16, 0.4)
  );
  const center = config.texture.size / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(
    0,
    `rgba(${Math.round(spriteCoreColor.r * 255)},${Math.round(spriteCoreColor.g * 255)},${Math.round(spriteCoreColor.b * 255)},${config.texture.coreOpacity})`
  );
  gradient.addColorStop(
    config.texture.midStop,
    `rgba(${Math.round(spriteMidColor.r * 255)},${Math.round(spriteMidColor.g * 255)},${Math.round(spriteMidColor.b * 255)},${config.texture.midOpacity})`
  );
  gradient.addColorStop(
    1,
    `rgba(${Math.round(spriteEdgeColor.r * 255)},${Math.round(spriteEdgeColor.g * 255)},${Math.round(spriteEdgeColor.b * 255)},${config.texture.edgeOpacity})`
  );
  context.fillStyle = gradient;
  context.fillRect(0, 0, config.texture.size, config.texture.size);

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function getMonochromeFireStops(
  avatarColor: string,
  targetStops: THREE.Color[],
  scratchHsl: THREE.HSL
) {
  const baseColor = targetStops[2].set(avatarColor || DEFAULT_AVATAR_FIRE_COLOR);
  baseColor.getHSL(scratchHsl);

  const hue = scratchHsl.h;
  const saturation = THREE.MathUtils.clamp(Math.max(scratchHsl.s, 0.45), 0, 1);
  const midLightness = THREE.MathUtils.clamp(Math.max(scratchHsl.l, 0.44), 0, 1);

  targetStops[0].setHSL(
    hue,
    THREE.MathUtils.clamp(saturation * 0.88, 0, 1),
    THREE.MathUtils.clamp(midLightness + 0.12, 0.46, 0.7)
  );
  targetStops[1].setHSL(
    hue,
    THREE.MathUtils.clamp(saturation * 0.96, 0, 1),
    THREE.MathUtils.clamp(midLightness + 0.05, 0.42, 0.66)
  );
  targetStops[2].setHSL(hue, saturation, THREE.MathUtils.clamp(midLightness, 0.4, 0.68));
  targetStops[3].setHSL(hue, saturation * 0.9, THREE.MathUtils.clamp(midLightness - 0.2, 0.18, 0.5));
  targetStops[4].setHSL(hue, saturation * 0.75, THREE.MathUtils.clamp(midLightness - 0.38, 0.04, 0.28));
}

/**
 * Precomputes the fire palette (life 0→1) into a flat RGB lookup table so the
 * per-particle loop does a single array read instead of 5 HSL conversions.
 */
export function buildFirePaletteLut(
  config: InnerFireConfig,
  avatarColor: string,
  target: Float32Array = new Float32Array(PALETTE_LUT_SIZE * 3)
): Float32Array {
  const size = target.length / 3;
  const stops = Array.from({ length: 5 }, () => new THREE.Color());
  const hsl: THREE.HSL = { h: 0, s: 0, l: 0 };
  const mixed = new THREE.Color();
  getMonochromeFireStops(avatarColor, stops, hsl);
  const { threshold1, threshold2, threshold3 } = config.color;

  for (let i = 0; i < size; i += 1) {
    const life = i / (size - 1);
    let fromIndex: number;
    let mixFactor: number;
    if (life < threshold1) {
      fromIndex = 0;
      mixFactor = life / threshold1;
    } else if (life < threshold2) {
      fromIndex = 1;
      mixFactor = (life - threshold1) / (threshold2 - threshold1);
    } else if (life < threshold3) {
      fromIndex = 2;
      mixFactor = (life - threshold2) / (threshold3 - threshold2);
    } else {
      fromIndex = 3;
      mixFactor = (life - threshold3) / (1 - threshold3);
    }
    mixed
      .copy(stops[fromIndex])
      .lerp(stops[fromIndex + 1], THREE.MathUtils.clamp(Number.isFinite(mixFactor) ? mixFactor : 1, 0, 1));
    target[i * 3] = mixed.r;
    target[i * 3 + 1] = mixed.g;
    target[i * 3 + 2] = mixed.b;
  }
  return target;
}

export function createInnerFireSystem(
  overrides: DeepPartial<InnerFireConfig> = {},
  initialAvatarColor = DEFAULT_AVATAR_FIRE_COLOR
): InnerFireSystem {
  let config = mergeInnerFireConfig(cloneInnerFireConfig(defaultInnerFireConfig), overrides);
  let avatarColor = initialAvatarColor;
  let geometry = new THREE.BufferGeometry();
  let positions = new Float32Array(config.particles.count * 3);
  let colors = new Float32Array(config.particles.count * 3);
  let lifetimes = new Float32Array(config.particles.count);
  let velocities = new Float32Array(config.particles.count * 3);
  const paletteLut = new Float32Array(PALETTE_LUT_SIZE * 3);
  buildFirePaletteLut(config, avatarColor, paletteLut);
  const root = new THREE.Group();
  let texture = buildFireSpriteTexture(config, avatarColor);
  let material = new THREE.PointsMaterial({
    size: config.particles.size,
    map: texture,
    transparent: true,
    opacity: config.particles.opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
  });
  let points = new THREE.Points(geometry, material);

  const respawnParticle = (index: number, resetHeight = false) => {
    const base = index * 3;
    positions[base] = (Math.random() - 0.5) * config.particles.spawnRadius * 2;
    positions[base + 1] = resetHeight ? 0 : Math.random() * config.particles.spawnHeight;
    positions[base + 2] = (Math.random() - 0.5) * config.particles.spawnRadius * 2;

    velocities[base] = (Math.random() - 0.5) * config.particles.velXZ * 2;
    velocities[base + 1] = config.particles.velYBase + Math.random() * config.particles.velYRand;
    velocities[base + 2] = (Math.random() - 0.5) * config.particles.velXZ * 2;
  };

  const syncTransform = () => {
    root.position.set(config.transform.x, config.transform.y, config.transform.z);
    root.scale.set(config.scale.idleXZ, config.scale.idleY, config.scale.idleXZ);
  };

  const syncMaterial = () => {
    material.size = config.particles.size;
    material.opacity = config.particles.opacity;
    material.needsUpdate = true;
  };

  const refreshTexture = () => {
    texture.dispose();
    texture = buildFireSpriteTexture(config, avatarColor);
    material.map = texture;
    material.needsUpdate = true;
  };

  const regenerateParticles = () => {
    geometry.dispose();
    colors = new Float32Array(config.particles.count * 3);
    positions = new Float32Array(config.particles.count * 3);
    lifetimes = new Float32Array(config.particles.count);
    velocities = new Float32Array(config.particles.count * 3);
    geometry = new THREE.BufferGeometry();

    for (let i = 0; i < config.particles.count; i += 1) {
      respawnParticle(i);
      lifetimes[i] = Math.random();
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    points.geometry = geometry;
  };

  points.renderOrder = 0;
  root.add(points);
  syncTransform();
  regenerateParticles();

  return {
    root,
    points,
    setAvatarColor(nextAvatarColor) {
      const resolvedAvatarColor = nextAvatarColor || DEFAULT_AVATAR_FIRE_COLOR;
      if (resolvedAvatarColor === avatarColor) return;

      avatarColor = resolvedAvatarColor;
      buildFirePaletteLut(config, avatarColor, paletteLut);
      refreshTexture();
    },
    applyConfig(overrides) {
      const previousConfig = config;
      config = mergeInnerFireConfig(config, overrides);

      syncTransform();
      syncMaterial();
      buildFirePaletteLut(config, avatarColor, paletteLut);

      if (
        previousConfig.texture.size !== config.texture.size ||
        previousConfig.texture.coreOpacity !== config.texture.coreOpacity ||
        previousConfig.texture.midOpacity !== config.texture.midOpacity ||
        previousConfig.texture.edgeOpacity !== config.texture.edgeOpacity ||
        previousConfig.texture.midStop !== config.texture.midStop
      ) {
        refreshTexture();
      }

      if (previousConfig.particles.count !== config.particles.count) {
        regenerateParticles();
      }
    },
    replaceConfig(nextConfig) {
      config = cloneInnerFireConfig(nextConfig);
      syncTransform();
      syncMaterial();
      buildFirePaletteLut(config, avatarColor, paletteLut);
      refreshTexture();
      regenerateParticles();
    },
    update(elapsedSeconds, isTalking, dtSeconds = 1 / 60) {
      // Particle constants are tuned per 60 fps frame; scale them by real time.
      const frames = Math.min(dtSeconds * 60, 6);
      const ease = damp(0.08, dtSeconds);
      const speedBoost = isTalking ? 1.45 : 1;
      const swayBoost = isTalking ? 1.35 : 1;
      const targetOpacity = isTalking ? 0.96 : config.particles.opacity;
      const targetSize = isTalking ? config.particles.size * 1.2 : config.particles.size;
      const targetScaleXZ = isTalking ? config.scale.talkingXZ : config.scale.idleXZ;
      const targetScaleY = isTalking ? config.scale.talkingY : config.scale.idleY;

      material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, ease);
      material.size = THREE.MathUtils.lerp(material.size, targetSize, ease);

      root.position.x = config.transform.x + Math.sin(elapsedSeconds * 2.1) * 0.025;
      root.position.y = config.transform.y
        + Math.sin(elapsedSeconds * 3.2) * 0.03
        + (isTalking ? Math.sin(elapsedSeconds * 13) * 0.045 : 0);
      root.rotation.z = Math.sin(elapsedSeconds * 1.7) * 0.035;
      root.scale.x = THREE.MathUtils.lerp(root.scale.x, targetScaleXZ, ease);
      root.scale.y = THREE.MathUtils.lerp(root.scale.y, targetScaleY, ease);
      root.scale.z = THREE.MathUtils.lerp(root.scale.z, targetScaleXZ, ease);
      points.rotation.y = elapsedSeconds * 0.45;

      const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
      const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;

      const count = config.particles.count;
      const lifeStep = config.particles.lifetimeSpeed * speedBoost * frames;
      const moveScale = speedBoost * frames;
      const swayAmount = config.particles.sway * swayBoost * frames;
      const swayPhase = elapsedSeconds * config.particles.swaySpeed;
      const taper = Math.pow(config.particles.taper, frames);
      const lutMax = PALETTE_LUT_SIZE - 1;

      for (let i = 0; i < count; i += 1) {
        let life = lifetimes[i] + lifeStep;
        if (life >= 1) {
          life = 0;
          respawnParticle(i, true);
        }
        lifetimes[i] = life;

        const base = i * 3;
        const y = positions[base + 1];
        positions[base] = (positions[base]
          + velocities[base] * moveScale
          + Math.sin(swayPhase + y) * swayAmount) * taper;
        positions[base + 1] = y + velocities[base + 1] * moveScale;
        positions[base + 2] = (positions[base + 2]
          + velocities[base + 2] * moveScale
          + Math.cos(swayPhase + y) * swayAmount) * taper;

        const lutIndex = ((life * lutMax) | 0) * 3;
        colors[base] = paletteLut[lutIndex];
        colors[base + 1] = paletteLut[lutIndex + 1];
        colors[base + 2] = paletteLut[lutIndex + 2];
      }

      positionAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
