/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from 'three';

export interface SceneEnvironmentOptions {
  roomColor?: string;
  floorColor?: string;
  /** Width (X), height (Y) and depth (Z) of the room. */
  roomWidth?: number;
  roomHeight?: number;
  roomDepth?: number;
  enableShadows?: boolean;
}

export function setupSceneEnvironment(
  scene: THREE.Scene,
  options: SceneEnvironmentOptions = {}
): () => void {
  const {
    roomColor = '#3c3c46',
    floorColor = '#2c2c34',
    // A room that is wider/deeper than it is tall keeps the floor and ceiling
    // inside the camera frustum, so their edges converge toward the back wall
    // and the scene actually reads as a 3D room.
    roomWidth = 16,
    roomHeight = 7,
    roomDepth = 20,
    enableShadows = true,
  } = options;

  const dispose: (() => void)[] = [];
  const added: THREE.Object3D[] = [];
  const halfH = roomHeight / 2;
  const maxHalf = Math.max(roomWidth, roomHeight, roomDepth) / 2;

  // ── Room shell (inner faces) ──────────────────────────────────────────────
  const roomMat = new THREE.MeshStandardMaterial({
    color: roomColor,
    side: THREE.BackSide,
    roughness: 0.95,
    metalness: 0.0,
  });
  const roomGeom = new THREE.BoxGeometry(roomWidth, roomHeight, roomDepth);
  const room = new THREE.Mesh(roomGeom, roomMat);
  scene.add(room);
  added.push(room);
  dispose.push(() => { roomGeom.dispose(); roomMat.dispose(); });

  // ── Floor plane that receives the avatar's shadow ─────────────────────────
  const floorMat = new THREE.MeshStandardMaterial({
    color: floorColor,
    roughness: 1.0,
    metalness: 0.0,
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
  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);
  added.push(ambient);

  const mainLight = new THREE.DirectionalLight(0xffffff, 1.15);
  mainLight.position.set(3, 6, 6);
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
    mainLight.shadow.radius = 4;
  }
  scene.add(mainLight);
  added.push(mainLight);

  const rimLight = new THREE.DirectionalLight(0xffe8f8, 0.4);
  rimLight.position.set(-6, 3, -4);
  scene.add(rimLight);
  added.push(rimLight);

  const fillLight = new THREE.PointLight(0xffffff, 0.4, 16);
  fillLight.position.set(0, 1.5, 4);
  scene.add(fillLight);
  added.push(fillLight);

  return () => {
    dispose.forEach(fn => fn());
    added.forEach(obj => scene.remove(obj));
  };
}
