/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from 'three';

export type SceneEnvironmentTheme = 'dark' | 'light';

export interface SceneEnvironmentOptions {
  theme?: SceneEnvironmentTheme;
  roomColor?: string;
  floorColor?: string;
  ceilingColor?: string;
  ambientColor?: string;
  mainLightColor?: string;
  mainLightIntensity?: number;
  /** Width (X), height (Y) and depth (Z) of the room. */
  roomWidth?: number;
  roomHeight?: number;
  roomDepth?: number;
  enableShadows?: boolean;
  /** Fog near and far distances for atmosphere depth */
  fogNear?: number;
  fogFar?: number;
  fogColor?: string;
}

const DARK_STUDIO_PRESET = {
  roomColor: '#2a2a38',
  floorColor: '#1e1e2a',
  ceilingColor: '#353548',
  ambientColor: '#a0a0c0',
  mainLightColor: '#fff5e8',
  mainLightIntensity: 1.0,
  fogNear: 12,
  fogFar: 28,
  fogColor: '#1a1a28',
};

const LIGHT_STUDIO_PRESET = {
  roomColor: '#e7eefc',
  floorColor: '#f8ead7',
  ceilingColor: '#f6f1ff',
  ambientColor: '#fff2df',
  mainLightColor: '#fff7e8',
  mainLightIntensity: 1.18,
  fogNear: 13,
  fogFar: 30,
  fogColor: '#f3efff',
};

function createStudioGradientTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;

  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const base = ctx.createLinearGradient(0, 0, 0, 512);
  base.addColorStop(0, '#f7f1ff');
  base.addColorStop(0.45, '#e8f3ff');
  base.addColorStop(1, '#fff2dc');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);

  const leftGlow = ctx.createRadialGradient(130, 170, 0, 130, 170, 330);
  leftGlow.addColorStop(0, 'rgba(154, 199, 255, 0.55)');
  leftGlow.addColorStop(0.45, 'rgba(154, 199, 255, 0.22)');
  leftGlow.addColorStop(1, 'rgba(154, 199, 255, 0)');
  ctx.fillStyle = leftGlow;
  ctx.fillRect(0, 0, 512, 512);

  const warmGlow = ctx.createRadialGradient(390, 360, 0, 390, 360, 360);
  warmGlow.addColorStop(0, 'rgba(255, 191, 148, 0.42)');
  warmGlow.addColorStop(0.5, 'rgba(255, 191, 148, 0.16)');
  warmGlow.addColorStop(1, 'rgba(255, 191, 148, 0)');
  ctx.fillStyle = warmGlow;
  ctx.fillRect(0, 0, 512, 512);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createHorizonGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;

  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createSoftCircleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;

  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(109, 137, 176, 0.26)');
  gradient.addColorStop(0.45, 'rgba(109, 137, 176, 0.12)');
  gradient.addColorStop(1, 'rgba(109, 137, 176, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function setupSceneEnvironment(
  scene: THREE.Scene,
  options: SceneEnvironmentOptions = {}
): () => void {
  const theme = options.theme ?? 'light';
  const isLightTheme = theme === 'light';
  const preset = isLightTheme ? LIGHT_STUDIO_PRESET : DARK_STUDIO_PRESET;
  const {
    roomColor = preset.roomColor,
    floorColor = preset.floorColor,
    ceilingColor = preset.ceilingColor,
    ambientColor = preset.ambientColor,
    mainLightColor = preset.mainLightColor,
    mainLightIntensity = preset.mainLightIntensity,
    roomWidth = 16,
    roomHeight = 7,
    roomDepth = 20,
    enableShadows = true,
    fogNear = preset.fogNear,
    fogFar = preset.fogFar,
    fogColor = preset.fogColor,
  } = options;

  const dispose: (() => void)[] = [];
  const added: THREE.Object3D[] = [];
  const previousBackground = scene.background;
  const previousFog = scene.fog;
  const halfH = roomHeight / 2;
  const maxHalf = Math.max(roomWidth, roomHeight, roomDepth) / 2;

  if (isLightTheme) {
    scene.background = new THREE.Color(fogColor);
  }
  scene.fog = new THREE.Fog(new THREE.Color(fogColor), fogNear, fogFar);

  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;

  const backWallTexture = isLightTheme ? createStudioGradientTexture() : null;
  const backWallGeom = new THREE.PlaneGeometry(roomWidth, roomHeight);
  const backWallMat = backWallTexture
    ? new THREE.MeshBasicMaterial({
        map: backWallTexture,
        color: roomColor,
      })
    : new THREE.MeshStandardMaterial({
        color: roomColor,
        roughness: 0.95,
        metalness: 0.0,
      });
  const backWall = new THREE.Mesh(backWallGeom, backWallMat);
  backWall.position.set(0, 0, -halfD);
  backWall.renderOrder = 0;
  scene.add(backWall);
  added.push(backWall);
  dispose.push(() => { backWallGeom.dispose(); backWallMat.dispose(); backWallTexture?.dispose(); });

  const leftWallGeom = new THREE.PlaneGeometry(roomDepth, roomHeight);
  const leftWall = new THREE.Mesh(leftWallGeom, new THREE.MeshStandardMaterial({
    color: isLightTheme ? '#dfeaff' : ceilingColor,
    roughness: 0.95,
    metalness: 0.0,
  }));
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-halfW, 0, 0);
  leftWall.renderOrder = 0;
  scene.add(leftWall);
  added.push(leftWall);
  dispose.push(() => { leftWallGeom.dispose(); leftWall.material.dispose(); });

  const rightWallGeom = new THREE.PlaneGeometry(roomDepth, roomHeight);
  const rightWall = new THREE.Mesh(rightWallGeom, new THREE.MeshStandardMaterial({
    color: isLightTheme ? '#fff0dc' : ceilingColor,
    roughness: 0.95,
    metalness: 0.0,
  }));
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(halfW, 0, 0);
  rightWall.renderOrder = 0;
  scene.add(rightWall);
  added.push(rightWall);
  dispose.push(() => { rightWallGeom.dispose(); rightWall.material.dispose(); });

  const ceilingGeom = new THREE.PlaneGeometry(roomWidth, roomDepth);
  const ceiling = new THREE.Mesh(ceilingGeom, new THREE.MeshStandardMaterial({
    color: ceilingColor,
    roughness: 0.95,
    metalness: 0.0,
  }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = halfH;
  ceiling.renderOrder = 0;
  scene.add(ceiling);
  added.push(ceiling);
  dispose.push(() => { ceilingGeom.dispose(); ceiling.material.dispose(); });

  const floorMat = new THREE.MeshStandardMaterial({
    color: floorColor,
    roughness: isLightTheme ? 0.82 : 0.9,
    metalness: isLightTheme ? 0.02 : 0.05,
  });
  const floorGeom = new THREE.PlaneGeometry(roomWidth, roomDepth);
  const floor = new THREE.Mesh(floorGeom, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -halfH + 0.02;
  floor.receiveShadow = enableShadows;
  scene.add(floor);
  added.push(floor);
  dispose.push(() => { floorGeom.dispose(); floorMat.dispose(); });

  if (isLightTheme) {
    const floorGlowTexture = createSoftCircleTexture();
    const floorGlowMat = new THREE.MeshBasicMaterial({
      map: floorGlowTexture,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const floorGlowGeom = new THREE.PlaneGeometry(5.4, 5.4);
    const floorGlow = new THREE.Mesh(floorGlowGeom, floorGlowMat);
    floorGlow.rotation.x = -Math.PI / 2;
    floorGlow.position.set(0, -halfH + 0.035, 0.2);
    scene.add(floorGlow);
    added.push(floorGlow);
    dispose.push(() => { floorGlowGeom.dispose(); floorGlowMat.dispose(); floorGlowTexture.dispose(); });

    const horizonGlowTexture = createHorizonGlowTexture();
    const horizonGlowMat = new THREE.MeshBasicMaterial({
      map: horizonGlowTexture,
      color: '#ffffff',
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const horizonGlowGeom = new THREE.PlaneGeometry(roomWidth * 0.72, roomHeight * 0.34);
    const horizonGlow = new THREE.Mesh(horizonGlowGeom, horizonGlowMat);
    horizonGlow.position.set(0, -0.55, -halfD + 0.02);
    scene.add(horizonGlow);
    added.push(horizonGlow);
    dispose.push(() => { horizonGlowGeom.dispose(); horizonGlowMat.dispose(); horizonGlowTexture.dispose(); });
  }

  // ── Lights ────────────────────────────────────────────────────────────────
  const ambient = new THREE.AmbientLight(new THREE.Color(ambientColor), isLightTheme ? 0.62 : 0.5);
  scene.add(ambient);
  added.push(ambient);

  const mainLight = new THREE.DirectionalLight(new THREE.Color(mainLightColor), mainLightIntensity);
  mainLight.position.set(isLightTheme ? 3.5 : 4, isLightTheme ? 7.5 : 8, isLightTheme ? 5.5 : 6);
  if (enableShadows) {
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.set(1024, 1024);
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 50;
    mainLight.shadow.camera.left = -maxHalf;
    mainLight.shadow.camera.right = maxHalf;
    mainLight.shadow.camera.top = maxHalf;
    mainLight.shadow.camera.bottom = -maxHalf;
    mainLight.shadow.bias = -0.0005;
    mainLight.shadow.radius = 3;
  }
  scene.add(mainLight);
  added.push(mainLight);

  const rimLight = new THREE.DirectionalLight(isLightTheme ? 0xb8d7ff : 0xd0c8ff, isLightTheme ? 0.42 : 0.35);
  rimLight.position.set(-6, 4, -4);
  scene.add(rimLight);
  added.push(rimLight);

  const fillLight = new THREE.PointLight(isLightTheme ? 0xfff1d8 : 0xfff8f0, isLightTheme ? 0.48 : 0.35, 18);
  fillLight.position.set(0, isLightTheme ? 2.4 : 2, isLightTheme ? 4.5 : 5);
  scene.add(fillLight);
  added.push(fillLight);

  const backLight = new THREE.PointLight(isLightTheme ? 0xbfdcff : 0xe8e0ff, isLightTheme ? 0.36 : 0.25, isLightTheme ? 16 : 15);
  backLight.position.set(0, isLightTheme ? 1.7 : 1.5, isLightTheme ? -3.2 : -3);
  scene.add(backLight);
  added.push(backLight);

  if (isLightTheme) {
    const warmAccent = new THREE.PointLight(0xffc790, 0.28, 14);
    warmAccent.position.set(4.8, -0.6, -2.8);
    scene.add(warmAccent);
    added.push(warmAccent);
  }

  return () => {
    dispose.forEach(fn => fn());
    added.forEach(obj => scene.remove(obj));
    scene.background = previousBackground;
    scene.fog = previousFog;
  };
}
