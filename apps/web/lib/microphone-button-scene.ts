import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** A small, event-rendered scene: the button uses no animation loop while idle. */
export function createMicrophoneButtonScene(
  canvas: HTMLCanvasElement,
  button: HTMLButtonElement,
  onContextLost: () => void,
) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  // The face lies in XZ: look straight along Y, with the icon's top toward -Z.
  camera.up.set(0, 0, -1);
  camera.position.set(0, 5, 0);
  camera.lookAt(0, 0.05, 0);

  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, 0.06, 0.1, 100, { size: 64 });
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.55;
  room.dispose();
  pmrem.dispose();

  const key = new THREE.DirectionalLight(0xfff7ed, 1.8);
  key.position.set(-3, 7, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.camera.left = key.shadow.camera.bottom = -2;
  key.shadow.camera.right = key.shadow.camera.top = 2;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 15;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key, new THREE.HemisphereLight(0xe9f3ff, 0x617185, 0.5));

  const body = new THREE.Group();
  scene.add(body);

  const lathe = (profile: number[][], material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 96), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // One machined housing and one softly bevelled cap, with a recessed light seam.
  const housing = lathe([
    [0, -0.06], [0.95, -0.06], [1.01, -0.04], [1.035, 0],
    [1.035, 0.055], [1.01, 0.09], [0.97, 0.105], [0, 0.105],
  ], new THREE.MeshStandardMaterial({ color: 0x354858, metalness: 0.8, roughness: 0.38 }));
  body.add(housing);

  const capMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xcddbe7, metalness: 0.65, roughness: 0.32, clearcoat: 0.18, clearcoatRoughness: 0.4,
  });
  const cap = new THREE.Group();
  cap.add(lathe([
    [0, 0.105], [0.89, 0.105], [0.95, 0.12], [0.985, 0.16],
    [0.985, 0.22], [0.975, 0.265], [0.945, 0.295], [0.89, 0.313],
    [0.8, 0.323], [0.56, 0.338], [0.28, 0.345], [0, 0.347],
  ], capMaterial));
  body.add(cap);

  const lightMaterial = new THREE.MeshStandardMaterial({
    color: 0x8eb9e5, emissive: 0x4285f4, emissiveIntensity: 0.15, metalness: 0.2, roughness: 0.4,
  });
  const seam = new THREE.Mesh(new THREE.TorusGeometry(0.997, 0.012, 8, 96), lightMaterial);
  seam.rotation.x = Math.PI / 2;
  seam.position.y = 0.11;
  body.add(seam);

  // The microphone is a decal on the surface, so it shares the cap's perspective and lighting.
  const iconCanvas = document.createElement('canvas');
  iconCanvas.width = iconCanvas.height = 256;
  const context = iconCanvas.getContext('2d')!;
  context.scale(8, 8);
  context.strokeStyle = '#fff';
  context.lineWidth = 1.8;
  context.lineCap = context.lineJoin = 'round';
  context.beginPath();
  context.roundRect(11, 3, 10, 17, 5);
  context.moveTo(6.5, 14.5);
  context.lineTo(6.5, 15.5);
  context.arc(16, 15.5, 9.5, Math.PI, 0, true);
  context.lineTo(25.5, 14.5);
  context.moveTo(16, 25);
  context.lineTo(16, 29);
  context.moveTo(11, 29);
  context.lineTo(21, 29);
  context.stroke();
  const iconTexture = new THREE.CanvasTexture(iconCanvas);
  iconTexture.colorSpace = THREE.SRGBColorSpace;
  iconTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.57, 0.57), new THREE.MeshStandardMaterial({
    map: iconTexture, color: 0x233348, transparent: true, depthWrite: false, roughness: 1,
  }));
  icon.rotation.x = -Math.PI / 2;
  icon.position.y = 0.348;
  cap.add(icon);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: 0.24 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.065;
  ground.receiveShadow = true;
  scene.add(ground);

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const restColor = new THREE.Color(0xcddbe7);
  const hoverColor = new THREE.Color(0xb7d2ec);
  let hovered = false;
  let pressed = false;
  let busy = button.disabled;
  let frame = 0;
  let previousTime = 0;
  let highlight = 0;
  let disposed = false;

  function render(time: number) {
    frame = 0;
    if (disposed) return;
    const blend = motion.matches ? 1 : 1 - Math.exp(-Math.min(time - previousTime || 16, 64) / 45);
    previousTime = time;
    const targetDepth = pressed || busy ? -0.065 : hovered ? 0.018 : 0;
    const targetHighlight = hovered || busy ? 1 : 0;
    cap.position.y = THREE.MathUtils.lerp(cap.position.y, targetDepth, blend);
    highlight = THREE.MathUtils.lerp(highlight, targetHighlight, blend);
    capMaterial.color.copy(restColor).lerp(hoverColor, highlight * 0.45);
    lightMaterial.emissiveIntensity = 0.15 + highlight * 0.85;
    icon.visible = !busy;
    renderer.render(scene, camera);
    const unsettled = Math.abs(cap.position.y - targetDepth) + Math.abs(highlight - targetHighlight);
    if (unsettled > 0.001) frame = requestAnimationFrame(render);
    else previousTime = 0;
  }

  function invalidate() {
    if (!frame && !disposed) frame = requestAnimationFrame(render);
  }

  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    invalidate();
  }

  const enter = (event: PointerEvent) => { hovered = event.pointerType === 'mouse' && !busy; invalidate(); };
  const leave = () => { hovered = pressed = false; invalidate(); };
  const down = () => { pressed = !busy; invalidate(); };
  const up = () => { pressed = false; invalidate(); };
  const keyDown = (event: KeyboardEvent) => { if (event.key === ' ' || event.key === 'Enter') down(); };
  const keyUp = (event: KeyboardEvent) => { if (event.key === ' ' || event.key === 'Enter') up(); };
  const lost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frame); frame = 0; onContextLost(); };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  button.addEventListener('pointerenter', enter);
  button.addEventListener('pointerleave', leave);
  button.addEventListener('pointerdown', down);
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', leave);
  button.addEventListener('blur', leave);
  button.addEventListener('keydown', keyDown);
  button.addEventListener('keyup', keyUp);
  canvas.addEventListener('webglcontextlost', lost);
  motion.addEventListener('change', invalidate);
  resize();

  return {
    setBusy(value: boolean) { busy = value; pressed = hovered = false; invalidate(); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      button.removeEventListener('pointerenter', enter);
      button.removeEventListener('pointerleave', leave);
      button.removeEventListener('pointerdown', down);
      button.removeEventListener('pointerup', up);
      button.removeEventListener('pointercancel', leave);
      button.removeEventListener('blur', leave);
      button.removeEventListener('keydown', keyDown);
      button.removeEventListener('keyup', keyUp);
      canvas.removeEventListener('webglcontextlost', lost);
      motion.removeEventListener('change', invalidate);
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => material.dispose());
        }
      });
      key.shadow.map?.dispose();
      iconTexture.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
