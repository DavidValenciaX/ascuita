import * as THREE from 'three';

export type InnerFireSystem = {
  root: THREE.Group;
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  update: (elapsedSeconds: number, isTalking: boolean) => void;
  dispose: () => void;
};

type FireVelocity = {
  x: number;
  y: number;
  z: number;
};

type InnerFireConfig = {
  stage1: number;
  stage2: number;
  stage3: number;
  swaySpeed: number;
  spriteSize: number;
  particleCount: number;
  spawnRadius: number;
  spawnHeight: number;
  velXZ: number;
  velYBase: number;
  velYRand: number;
  lifetimeSpeed: number;
  sway: number;
  taper: number;
  opacity: number;
  particleSize: number;
  baseY: number;
  baseZ: number;
  idleScaleXZ: number;
  idleScaleY: number;
  talkingScaleXZ: number;
  talkingScaleY: number;
  palette: readonly [number, number, number, number, number];
};

const DEFAULT_CONFIG: InnerFireConfig = {
  stage1: 0.08,
  stage2: 0.34,
  stage3: 0.8,
  swaySpeed: 5.2,
  spriteSize: 64,
  particleCount: 1800,
  spawnRadius: 0.16,
  spawnHeight: 1.18,
  velXZ: 0.018,
  velYBase: 0.022,
  velYRand: 0.032,
  lifetimeSpeed: 0.018,
  sway: 0.0038,
  taper: 0.962,
  opacity: 0.88,
  particleSize: 0.26,
  baseY: -0.86,
  baseZ: -0.04,
  idleScaleXZ: 0.92,
  idleScaleY: 0.98,
  talkingScaleXZ: 1.05,
  talkingScaleY: 1.22,
  palette: [0xfff4d6, 0xffd35a, 0xff7a1a, 0xd63200, 0x250200],
};

function buildFireSpriteTexture(spriteSize: number): THREE.CanvasTexture {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = spriteSize;
  textureCanvas.height = spriteSize;

  const context = textureCanvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create fire sprite texture.');
  }

  const center = spriteSize / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.32, 'rgba(255,255,255,0.68)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, spriteSize, spriteSize);

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

  if (life < config.stage1) {
    mixFactor = THREE.MathUtils.clamp(life / config.stage1, 0, 1);
  } else if (life < config.stage2) {
    fromIndex = 1;
    toIndex = 2;
    mixFactor = THREE.MathUtils.clamp((life - config.stage1) / (config.stage2 - config.stage1), 0, 1);
  } else if (life < config.stage3) {
    fromIndex = 2;
    toIndex = 3;
    mixFactor = THREE.MathUtils.clamp((life - config.stage2) / (config.stage3 - config.stage2), 0, 1);
  } else {
    fromIndex = 3;
    toIndex = 4;
    mixFactor = THREE.MathUtils.clamp((life - config.stage3) / (1 - config.stage3), 0, 1);
  }

  targetColor.setHex(config.palette[fromIndex]);
  mixTargetColor.setHex(config.palette[toIndex]);
  return targetColor.lerp(mixTargetColor, mixFactor);
}

export function createInnerFireSystem(overrides: Partial<InnerFireConfig> = {}): InnerFireSystem {
  const config: InnerFireConfig = { ...DEFAULT_CONFIG, ...overrides };
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(config.particleCount * 3);
  const colors = new Float32Array(config.particleCount * 3);
  const lifetimes = new Float32Array(config.particleCount);
  const velocities: FireVelocity[] = [];
  const colorScratch = new THREE.Color();
  const colorMixScratch = new THREE.Color();
  const root = new THREE.Group();
  const texture = buildFireSpriteTexture(config.spriteSize);

  const respawnParticle = (index: number, resetHeight = false) => {
    positions[index * 3] = (Math.random() - 0.5) * config.spawnRadius * 2;
    positions[index * 3 + 1] = resetHeight ? 0 : Math.random() * config.spawnHeight;
    positions[index * 3 + 2] = (Math.random() - 0.5) * config.spawnRadius * 2;

    velocities[index] = {
      x: (Math.random() - 0.5) * config.velXZ * 2,
      y: config.velYBase + Math.random() * config.velYRand,
      z: (Math.random() - 0.5) * config.velXZ * 2,
    };
  };

  for (let i = 0; i < config.particleCount; i += 1) {
    respawnParticle(i);
    lifetimes[i] = Math.random();
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: config.particleSize,
    map: texture,
    transparent: true,
    opacity: config.opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
  });

  const points = new THREE.Points(geometry, material);
  points.renderOrder = 1;
  root.add(points);
  root.position.set(0, config.baseY, config.baseZ);
  root.scale.set(config.idleScaleXZ, config.idleScaleY, config.idleScaleXZ);

  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;

  return {
    root,
    points,
    update(elapsedSeconds, isTalking) {
      const speedBoost = isTalking ? 1.45 : 1;
      const swayBoost = isTalking ? 1.35 : 1;
      const targetOpacity = isTalking ? 0.96 : config.opacity;
      const targetSize = isTalking ? config.particleSize * 1.2 : config.particleSize;
      const targetScaleXZ = isTalking ? config.talkingScaleXZ : config.idleScaleXZ;
      const targetScaleY = isTalking ? config.talkingScaleY : config.idleScaleY;

      material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, 0.08);
      material.size = THREE.MathUtils.lerp(material.size, targetSize, 0.08);

      root.position.x = Math.sin(elapsedSeconds * 2.1) * 0.025;
      root.position.y = config.baseY
        + Math.sin(elapsedSeconds * 3.2) * 0.03
        + (isTalking ? Math.sin(elapsedSeconds * 13) * 0.045 : 0);
      root.rotation.z = Math.sin(elapsedSeconds * 1.7) * 0.035;
      root.scale.x = THREE.MathUtils.lerp(root.scale.x, targetScaleXZ, 0.08);
      root.scale.y = THREE.MathUtils.lerp(root.scale.y, targetScaleY, 0.08);
      root.scale.z = THREE.MathUtils.lerp(root.scale.z, targetScaleXZ, 0.08);
      points.rotation.y = elapsedSeconds * 0.45;

      for (let i = 0; i < config.particleCount; i += 1) {
        lifetimes[i] += config.lifetimeSpeed * speedBoost;

        if (lifetimes[i] >= 1) {
          lifetimes[i] = 0;
          respawnParticle(i, true);
        }

        const baseIndex = i * 3;
        positions[baseIndex] += velocities[i].x * speedBoost
          + Math.sin(elapsedSeconds * config.swaySpeed + positions[baseIndex + 1]) * config.sway * swayBoost;
        positions[baseIndex + 1] += velocities[i].y * speedBoost;
        positions[baseIndex + 2] += velocities[i].z * speedBoost
          + Math.cos(elapsedSeconds * config.swaySpeed + positions[baseIndex + 1]) * config.sway * swayBoost;
        positions[baseIndex] *= config.taper;
        positions[baseIndex + 2] *= config.taper;

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

