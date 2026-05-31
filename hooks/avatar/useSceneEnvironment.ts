/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from 'three';

export interface SceneEnvironmentOptions {
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

export function setupSceneEnvironment(
  scene: THREE.Scene,
  options: SceneEnvironmentOptions = {}
): () => void {
  const {
    roomColor = '#2a2a38',
    floorColor = '#1e1e2a',
    ceilingColor = '#353548',
    ambientColor = '#a0a0c0',
    mainLightColor = '#fff5e8',
    mainLightIntensity = 1.0,
    roomWidth = 16,
    roomHeight = 7,
    roomDepth = 20,
    enableShadows = true,
    fogNear = 12,
    fogFar = 28,
    fogColor = '#1a1a28',
  } = options;

  const dispose: (() => void)[] = [];
  const added: THREE.Object3D[] = [];
  const halfH = roomHeight / 2;
  const maxHalf = Math.max(roomWidth, roomHeight, roomDepth) / 2;

  scene.fog = new THREE.Fog(new THREE.Color(fogColor), fogNear, fogFar);

  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;

  const backWallGeom = new THREE.PlaneGeometry(roomWidth, roomHeight);
  const backWall = new THREE.Mesh(backWallGeom, new THREE.MeshStandardMaterial({
    color: roomColor,
    roughness: 0.95,
    metalness: 0.0,
  }));
  backWall.position.set(0, 0, -halfD);
  backWall.renderOrder = 0;
  scene.add(backWall);
  added.push(backWall);
  dispose.push(() => { backWallGeom.dispose(); backWall.material.dispose(); });

  const leftWallGeom = new THREE.PlaneGeometry(roomDepth, roomHeight);
  const leftWall = new THREE.Mesh(leftWallGeom, new THREE.MeshStandardMaterial({
    color: ceilingColor,
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
    color: ceilingColor,
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
    roughness: 0.9,
    metalness: 0.05,
  });
  const floorGeom = new THREE.PlaneGeometry(roomWidth, roomDepth);
  const floor = new THREE.Mesh(floorGeom, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -halfH + 0.02;
  floor.receiveShadow = enableShadows;
  scene.add(floor);
  added.push(floor);
  dispose.push(() => { floorGeom.dispose(); floorMat.dispose(); });

  // ── Lights ────────────────────────────────────────────────────────────────
  const ambient = new THREE.AmbientLight(new THREE.Color(ambientColor), 0.5);
  scene.add(ambient);
  added.push(ambient);

  const mainLight = new THREE.DirectionalLight(new THREE.Color(mainLightColor), mainLightIntensity);
  mainLight.position.set(4, 8, 6);
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

  const rimLight = new THREE.DirectionalLight(0xd0c8ff, 0.35);
  rimLight.position.set(-6, 4, -4);
  scene.add(rimLight);
  added.push(rimLight);

  const fillLight = new THREE.PointLight(0xfff8f0, 0.35, 18);
  fillLight.position.set(0, 2, 5);
  scene.add(fillLight);
  added.push(fillLight);

  const backLight = new THREE.PointLight(0xe8e0ff, 0.25, 15);
  backLight.position.set(0, 1.5, -3);
  scene.add(backLight);
  added.push(backLight);

  return () => {
    dispose.forEach(fn => fn());
    added.forEach(obj => scene.remove(obj));
    scene.fog = null;
  };
}
