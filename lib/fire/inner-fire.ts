import * as THREE from 'three';
import {
  cloneInnerFireConfig,
  defaultInnerFireConfig,
  DeepPartial,
  FIRE_PALETTES,
  InnerFireConfig,
  mergeInnerFireConfig,
} from './config';

export type InnerFireSystem = {
  root: THREE.Group;
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  applyConfig: (overrides: DeepPartial<InnerFireConfig>) => void;
  replaceConfig: (nextConfig: InnerFireConfig) => void;
  update: (elapsedSeconds: number, isTalking: boolean) => void;
  dispose: () => void;
};

type FireVelocity = {
  x: number;
  y: number;
  z: number;
};

function buildFireSpriteTexture(config: InnerFireConfig): THREE.CanvasTexture {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = config.texture.size;
  textureCanvas.height = config.texture.size;

  const context = textureCanvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create fire sprite texture.');
  }

  const center = config.texture.size / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, `rgba(255,255,255,${config.texture.coreOpacity})`);
  gradient.addColorStop(config.texture.midStop, `rgba(255,255,255,${config.texture.midOpacity})`);
  gradient.addColorStop(1, `rgba(255,255,255,${config.texture.edgeOpacity})`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, config.texture.size, config.texture.size);

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function sampleFirePalette(
  config: InnerFireConfig,
  life: number,
  targetColor: THREE.Color,
  mixTargetColor: THREE.Color
): THREE.Color {
  let fromIndex = 0;
  let toIndex = 1;
  let mixFactor = 0;

  if (life < config.color.threshold1) {
    mixFactor = THREE.MathUtils.clamp(life / config.color.threshold1, 0, 1);
  } else if (life < config.color.threshold2) {
    fromIndex = 1;
    toIndex = 2;
    mixFactor = THREE.MathUtils.clamp(
      (life - config.color.threshold1) / (config.color.threshold2 - config.color.threshold1),
      0,
      1
    );
  } else if (life < config.color.threshold3) {
    fromIndex = 2;
    toIndex = 3;
    mixFactor = THREE.MathUtils.clamp(
      (life - config.color.threshold2) / (config.color.threshold3 - config.color.threshold2),
      0,
      1
    );
  } else {
    fromIndex = 3;
    toIndex = 4;
    mixFactor = THREE.MathUtils.clamp((life - config.color.threshold3) / (1 - config.color.threshold3), 0, 1);
  }

  const paletteStops = FIRE_PALETTES[config.palette.selected].stops;
  targetColor.setHex(paletteStops[fromIndex]);
  mixTargetColor.setHex(paletteStops[toIndex]);
  return targetColor.lerp(mixTargetColor, mixFactor);
}

export function createInnerFireSystem(overrides: DeepPartial<InnerFireConfig> = {}): InnerFireSystem {
  let config = mergeInnerFireConfig(cloneInnerFireConfig(defaultInnerFireConfig), overrides);
  let geometry = new THREE.BufferGeometry();
  let positions = new Float32Array(config.particles.count * 3);
  let colors = new Float32Array(config.particles.count * 3);
  let lifetimes = new Float32Array(config.particles.count);
  let velocities: FireVelocity[] = [];
  const colorScratch = new THREE.Color();
  const colorMixScratch = new THREE.Color();
  const root = new THREE.Group();
  let texture = buildFireSpriteTexture(config);
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
    positions[index * 3] = (Math.random() - 0.5) * config.particles.spawnRadius * 2;
    positions[index * 3 + 1] = resetHeight ? 0 : Math.random() * config.particles.spawnHeight;
    positions[index * 3 + 2] = (Math.random() - 0.5) * config.particles.spawnRadius * 2;

    velocities[index] = {
      x: (Math.random() - 0.5) * config.particles.velXZ * 2,
      y: config.particles.velYBase + Math.random() * config.particles.velYRand,
      z: (Math.random() - 0.5) * config.particles.velXZ * 2,
    };
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
    texture = buildFireSpriteTexture(config);
    material.map = texture;
    material.needsUpdate = true;
  };

  const regenerateParticles = () => {
    geometry.dispose();
    colors = new Float32Array(config.particles.count * 3);
    positions = new Float32Array(config.particles.count * 3);
    lifetimes = new Float32Array(config.particles.count);
    velocities = [];
    geometry = new THREE.BufferGeometry();

    for (let i = 0; i < config.particles.count; i += 1) {
      respawnParticle(i);
      lifetimes[i] = Math.random();
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    points.geometry = geometry;
  };

  points.renderOrder = 1;
  root.add(points);
  syncTransform();
  regenerateParticles();

  return {
    root,
    points,
    applyConfig(overrides) {
      const previousConfig = config;
      config = mergeInnerFireConfig(config, overrides);

      syncTransform();
      syncMaterial();

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
      refreshTexture();
      regenerateParticles();
    },
    update(elapsedSeconds, isTalking) {
      const speedBoost = isTalking ? 1.45 : 1;
      const swayBoost = isTalking ? 1.35 : 1;
      const targetOpacity = isTalking ? 0.96 : config.particles.opacity;
      const targetSize = isTalking ? config.particles.size * 1.2 : config.particles.size;
      const targetScaleXZ = isTalking ? config.scale.talkingXZ : config.scale.idleXZ;
      const targetScaleY = isTalking ? config.scale.talkingY : config.scale.idleY;

      material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, 0.08);
      material.size = THREE.MathUtils.lerp(material.size, targetSize, 0.08);

      root.position.x = config.transform.x + Math.sin(elapsedSeconds * 2.1) * 0.025;
      root.position.y = config.transform.y
        + Math.sin(elapsedSeconds * 3.2) * 0.03
        + (isTalking ? Math.sin(elapsedSeconds * 13) * 0.045 : 0);
      root.rotation.z = Math.sin(elapsedSeconds * 1.7) * 0.035;
      root.scale.x = THREE.MathUtils.lerp(root.scale.x, targetScaleXZ, 0.08);
      root.scale.y = THREE.MathUtils.lerp(root.scale.y, targetScaleY, 0.08);
      root.scale.z = THREE.MathUtils.lerp(root.scale.z, targetScaleXZ, 0.08);
      points.rotation.y = elapsedSeconds * 0.45;

      const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
      const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;

      for (let i = 0; i < config.particles.count; i += 1) {
        lifetimes[i] += config.particles.lifetimeSpeed * speedBoost;

        if (lifetimes[i] >= 1) {
          lifetimes[i] = 0;
          respawnParticle(i, true);
        }

        const baseIndex = i * 3;
        positions[baseIndex] += velocities[i].x * speedBoost
          + Math.sin(elapsedSeconds * config.particles.swaySpeed + positions[baseIndex + 1]) * config.particles.sway * swayBoost;
        positions[baseIndex + 1] += velocities[i].y * speedBoost;
        positions[baseIndex + 2] += velocities[i].z * speedBoost
          + Math.cos(elapsedSeconds * config.particles.swaySpeed + positions[baseIndex + 1]) * config.particles.sway * swayBoost;
        positions[baseIndex] *= config.particles.taper;
        positions[baseIndex + 2] *= config.particles.taper;

        const color = sampleFirePalette(config, lifetimes[i], colorScratch, colorMixScratch);
        colors[baseIndex] = color.r;
        colors[baseIndex + 1] = color.g;
        colors[baseIndex + 2] = color.b;
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
