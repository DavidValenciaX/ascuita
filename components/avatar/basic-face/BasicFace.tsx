/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { type RefObject, useEffect, useState, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { drawFriendlyMouth, getMouthSignature } from '../../../hooks/avatar/mouth-config';
import useFace from '../../../hooks/avatar/use-face';
import useHover from '../../../hooks/avatar/use-hover';
import useTilt from '../../../hooks/avatar/use-tilt';
import { useLiveAPIContext } from '../../../contexts/LiveAPIContext';
import { createInnerFireSystem, type InnerFireSystem } from '@/lib/fire/inner-fire';
import { useAvatarRender, useInnerFire } from '@/lib/state';
import {
  SceneEnvironmentTheme,
  setupSceneEnvironment,
} from '../../../hooks/avatar/useSceneEnvironment';

// Minimum volume level that indicates audio output is occurring
const AUDIO_OUTPUT_DETECTION_THRESHOLD = 0.05;

// Amount of delay between end of audio output and setting talking state to false
const TALKING_STATE_COOLDOWN_MS = 2000;
const FIRE_BLOOM_LAYER = 1;

type BasicFaceProps = {
  /** The canvas element on which to render the face. */
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  /** The radius of the face. */
  readonly radius?: number;
  /** The color of the face. */
  readonly color?: string;
  /** The default 3D room theme behind the avatar. */
  readonly sceneTheme?: SceneEnvironmentTheme;
};

/** Build a 4-step toon gradient map using DataTexture (WebGL2-safe, no FLIP_Y issues). */
function buildGradientMap(): THREE.DataTexture {
  const colors = new Uint8Array([128, 168, 210, 255]);
  const tex = new THREE.DataTexture(colors, 4, 1, THREE.RedFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export default function BasicFace({
  canvasRef,
  radius: _radius = 250,
  color,
  sceneTheme = 'light',
}: BasicFaceProps) {
  const timeoutRef = useRef<NodeJS.Timeout>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const innerFireRef = useRef<InnerFireSystem | null>(null);
  const innerFireConfig = useInnerFire(state => state.config);
  const avatarRenderConfig = useAvatarRender(state => state.config);

  // Audio output volume
  const { volume } = useLiveAPIContext();

  // Talking state
  const [isTalking, setIsTalking] = useState(false);

  // Face states from existing hooks
  const { eyeScale, mouthShape } = useFace();
  const hoverPosition = useHover();
  const tiltAngle = useTilt({
    maxAngle: 5,
    speed: 0.075,
    isActive: isTalking,
  });

  // Three.js renderer & camera refs for resize updates without rebuilding the scene
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const finalComposerRef = useRef<EffectComposer | null>(null);
  const fireBloomComposerRef = useRef<EffectComposer | null>(null);

  // Synchronize dynamic variables with refs to feed into the Three.js loop without closures going stale
  const eyeScaleRef = useRef(eyeScale);
  const colorRef = useRef(color);
  const hoverPositionRef = useRef(hoverPosition);
  const tiltAngleRef = useRef(tiltAngle);
  const isTalkingRef = useRef(isTalking);
  const mouthShapeRef = useRef(mouthShape);
  const innerFireConfigRef = useRef(innerFireConfig);
  const avatarRenderConfigRef = useRef(avatarRenderConfig);

  useEffect(() => { eyeScaleRef.current = eyeScale; }, [eyeScale]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { hoverPositionRef.current = hoverPosition; }, [hoverPosition]);
  useEffect(() => { tiltAngleRef.current = tiltAngle; }, [tiltAngle]);
  useEffect(() => { isTalkingRef.current = isTalking; }, [isTalking]);
  useEffect(() => { mouthShapeRef.current = mouthShape; }, [mouthShape]);
  useEffect(() => { innerFireConfigRef.current = innerFireConfig; }, [innerFireConfig]);
  useEffect(() => { avatarRenderConfigRef.current = avatarRenderConfig; }, [avatarRenderConfig]);

  // Detect whether the agent is talking based on audio output volume
  useEffect(() => {
    if (volume > AUDIO_OUTPUT_DETECTION_THRESHOLD) {
      setIsTalking(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(
        () => setIsTalking(false),
        TALKING_STATE_COOLDOWN_MS
      );
    }
  }, [volume]);

  const canvasWidth = typeof window !== 'undefined' ? window.innerWidth : 800;
  const canvasHeight = typeof window !== 'undefined' ? window.innerHeight : 600;

  // Handle resizing the WebGL renderer and updating camera projection
  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (renderer && camera) {
      renderer.setSize(canvasWidth, canvasHeight, false);
      finalComposerRef.current?.setSize(canvasWidth, canvasHeight);
      fireBloomComposerRef.current?.setSize(canvasWidth, canvasHeight);
      camera.aspect = canvasWidth / canvasHeight;
      camera.updateProjectionMatrix();
    }
  }, [canvasWidth, canvasHeight]);

  // Main Three.js Scene Setup (Runs once on mount)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── 1. Scene, Camera, Renderer ──────────────────────────────────────────
    const scene = new THREE.Scene();

    // Pulled-back, slightly raised camera looking gently downward so the floor,
    // ceiling and side walls enter the frame and their edges converge toward the
    // back wall (one-point perspective), which is what reads as a 3D room.
    const camera = new THREE.PerspectiveCamera(48, canvasWidth / canvasHeight, 0.1, 1000);
    camera.position.set(0, 0.9, 8.5);
    camera.lookAt(0, 0.0, -2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setSize(canvasWidth, canvasHeight, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = avatarRenderConfigRef.current.sceneExposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    rendererRef.current = renderer;

    // ── 1b. Bloom post-processing ───────────────────────────────────────────
    // The glow used to be a CSS drop-shadow that relied on a transparent canvas.
    // Now that an opaque room fills the canvas, the glow has to live inside the
    // 3D scene. UnrealBloomPass blooms only the brightest pixels (the emissive
    // body + additive glow sprite), leaving the dim room walls untouched.
    const composer = new EffectComposer(renderer);
    composer.setSize(canvasWidth, canvasHeight);
    const finalRenderPass = new RenderPass(scene, camera);
    const fireBloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvasWidth, canvasHeight),
      innerFireConfigRef.current.bloom.strength,
      innerFireConfigRef.current.bloom.radius,
      innerFireConfigRef.current.bloom.threshold
    );
    const fireBloomComposer = new EffectComposer(renderer);
    fireBloomComposer.renderToScreen = false;
    fireBloomComposer.setSize(canvasWidth, canvasHeight);
    fireBloomComposer.addPass(new RenderPass(scene, camera));
    fireBloomComposer.addPass(fireBloomPass);

    const fireBloomMixPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: fireBloomComposer.renderTarget2.texture },
        },
        vertexShader: `
          varying vec2 vUv;

          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D baseTexture;
          uniform sampler2D bloomTexture;
          varying vec2 vUv;

          void main() {
            gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
          }
        `,
      }),
      'baseTexture'
    );
    const sceneBloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvasWidth, canvasHeight),
      avatarRenderConfigRef.current.sceneBloomStrength,
      avatarRenderConfigRef.current.sceneBloomRadius,
      avatarRenderConfigRef.current.sceneBloomThreshold
    );
    composer.addPass(finalRenderPass);
    composer.addPass(fireBloomMixPass);
    composer.addPass(sceneBloomPass);
    composer.addPass(new OutputPass());
    finalComposerRef.current = composer;
    fireBloomComposerRef.current = fireBloomComposer;

    // ── 2. Toon shading gradient map ────────────────────────────────────────
    const gradientMap = buildGradientMap();

    // ── 3. Materials ────────────────────────────────────────────────────────
    const initialColor = colorRef.current || '#5B9BF5';
    const bodyMat = new THREE.MeshToonMaterial({
      color: initialColor,
      gradientMap,
      emissive: new THREE.Color(initialColor),
      emissiveIntensity: avatarRenderConfigRef.current.bodyEmissiveIntensity,
      transparent: true,
      opacity: avatarRenderConfigRef.current.bodyOpacity,
      depthWrite: false,
    });
    const eyeMat = new THREE.MeshBasicMaterial({
      color: '#1F2430',
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const eyeHighlightMat = new THREE.MeshBasicMaterial({
      color: '#FFFFFF',
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });

    // ── 4. Geometries ───────────────────────────────────────────────────────
    const bodyGeom = new THREE.SphereGeometry(1.55, 32, 32);
    const eyeGeom = new THREE.SphereGeometry(0.16, 32, 32);
    const eyeHighlightGeom = new THREE.SphereGeometry(0.045, 16, 16);
    const mouthGeom = new THREE.PlaneGeometry(0.78, 0.78);

    // ── 5. Character node hierarchy ─────────────────────────────────────────
    const characterGroup = new THREE.Group();
    scene.add(characterGroup);

    // Body
    const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
    bodyMesh.renderOrder = 0;
    bodyMesh.castShadow = true;
    bodyMesh.scale.set(1.04, 1.15, 0.88);
    characterGroup.add(bodyMesh);

    const innerFire = createInnerFireSystem(innerFireConfig);
    innerFire.points.layers.enable(FIRE_BLOOM_LAYER);
    innerFireRef.current = innerFire;
    bodyMesh.add(innerFire.root);

    // Soft black eyes with tiny highlights
    const leftEyePivot = new THREE.Group();
    leftEyePivot.rotation.x = THREE.MathUtils.degToRad(-14.2);
    leftEyePivot.rotation.y = THREE.MathUtils.degToRad(-16.3);
    bodyMesh.add(leftEyePivot);

    const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
    leftEye.renderOrder = 3;
    leftEye.position.set(0, 0, 1.55);
    leftEye.scale.set(1.0, 1.15, 0.42);
    leftEyePivot.add(leftEye);

    const rightEyePivot = new THREE.Group();
    rightEyePivot.rotation.x = THREE.MathUtils.degToRad(-14.2);
    rightEyePivot.rotation.y = THREE.MathUtils.degToRad(16.3);
    bodyMesh.add(rightEyePivot);

    const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
    rightEye.renderOrder = 3;
    rightEye.position.set(0, 0, 1.55);
    rightEye.scale.set(1.0, 1.15, 0.42);
    rightEyePivot.add(rightEye);

    const leftEyeHighlight = new THREE.Mesh(eyeHighlightGeom, eyeHighlightMat);
    leftEyeHighlight.renderOrder = 4;
    leftEyeHighlight.position.set(-0.04, 0.04, 0.12);
    leftEye.add(leftEyeHighlight);

    const rightEyeHighlight = new THREE.Mesh(eyeHighlightGeom, eyeHighlightMat);
    rightEyeHighlight.renderOrder = 4;
    rightEyeHighlight.position.set(-0.04, 0.04, 0.12);
    rightEye.add(rightEyeHighlight);

    // ── Mouth canvas texture ─────────────────────────────────────────────────
    const mouthCanvas = document.createElement('canvas');
    mouthCanvas.width  = 256;
    mouthCanvas.height = 256;
    const mouthCtx = mouthCanvas.getContext('2d')!;

    const mouthTexture = new THREE.CanvasTexture(mouthCanvas);
    // flipY = false prevents UNPACK_FLIP_Y_WEBGL=1 leaking into any internal
    // texImage3D call (Three.js r152+ WebGL2 bug). Compensate by flipping the
    // plane's UV V-coordinates so the mouth still renders right-side up.
    mouthTexture.flipY = false;
    // CanvasTexture defaults to NoColorSpace (linear), but the canvas paints in
    // sRGB. Without this, Three.js skips the sRGB→linear conversion and then
    // re-encodes to sRGB on output, making dark colors appear washed-out grey.
    mouthTexture.colorSpace = THREE.SRGBColorSpace;
    const mouthUVs = mouthGeom.attributes.uv;
    for (let i = 0; i < mouthUVs.count; i++) {
      mouthUVs.setY(i, 1.0 - mouthUVs.getY(i));
    }
    mouthUVs.needsUpdate = true;

    const mouthMat = new THREE.MeshBasicMaterial({
      map: mouthTexture,
      transparent: true,
      depthWrite: false,
    });
    const mouthPivot = new THREE.Group();
    mouthPivot.rotation.x = THREE.MathUtils.degToRad(8.2);
    bodyMesh.add(mouthPivot);

    const mouthMesh = new THREE.Mesh(mouthGeom, mouthMat);
    mouthMesh.renderOrder = 5;
    mouthMesh.position.set(0, 0, 1.55);
    mouthPivot.add(mouthMesh);

    const cleanupEnvironment = setupSceneEnvironment(scene, { theme: sceneTheme });

    // ── 7. Mouse/Touch tracker ───────────────────────────────────────────────
    const mouse = { x: 0, y: 0 };
    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      let clientX, clientY;
      if ('touches' in e) {
        if (e.touches.length > 0) {
          clientX = e.touches[0].clientX;
          clientY = e.touches[0].clientY;
        } else {
          return;
        }
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      mouse.x =  (clientX / window.innerWidth)  * 2 - 1;
      mouse.y = -(clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove as any);
    window.addEventListener('touchstart', handleMouseMove as any);
    window.addEventListener('touchmove', handleMouseMove as any);

    // ── 7b. Saccades (Rapid eye micro-movements) ─────────────────────────────
    let nextSaccadeTime = performance.now() + 2000;
    const saccadeTarget = { x: 0, y: 0 };
    const currentSaccade = { x: 0, y: 0 };

    // ── 8. Animation loop ─────────────────────────────────────────────────────
    let animationId: number;
    let lastMouthSignature = '';
    let lastColor = '';

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const elapsedSeconds = performance.now() / 1000;

      // Body color update
      if (colorRef.current !== lastColor) {
        lastColor = colorRef.current || '#5B9BF5';
        bodyMat.color.set(lastColor);
        bodyMat.emissive.set(lastColor);
      }

      bodyMat.emissiveIntensity = avatarRenderConfigRef.current.bodyEmissiveIntensity;
      bodyMat.opacity = avatarRenderConfigRef.current.bodyOpacity;
      renderer.toneMappingExposure = avatarRenderConfigRef.current.sceneExposure;
      fireBloomPass.strength = innerFireConfigRef.current.bloom.strength;
      fireBloomPass.radius = innerFireConfigRef.current.bloom.radius;
      fireBloomPass.threshold = innerFireConfigRef.current.bloom.threshold;
      sceneBloomPass.strength = avatarRenderConfigRef.current.sceneBloomStrength;
      sceneBloomPass.radius = avatarRenderConfigRef.current.sceneBloomRadius;
      sceneBloomPass.threshold = avatarRenderConfigRef.current.sceneBloomThreshold;

      // Eye blink — squash both eyes vertically
      const currentEyeScale = eyeScaleRef.current;
      leftEye.scale.y = 1.15 * currentEyeScale;
      rightEye.scale.y = 1.15 * currentEyeScale;
      leftEye.scale.x = 1 + (1 - currentEyeScale) * 0.18;
      rightEye.scale.x = 1 + (1 - currentEyeScale) * 0.18;

      // Saccades (Rapid eye movements)
      const nowMs = performance.now();
      if (nowMs > nextSaccadeTime) {
        if (Math.random() > 0.4) {
          // Dart eyes
          saccadeTarget.x = (Math.random() - 0.5) * 0.15;
          saccadeTarget.y = (Math.random() - 0.5) * 0.15;
          nextSaccadeTime = nowMs + 150 + Math.random() * 400; // brief dart
        } else {
          // Return to center
          saccadeTarget.x = 0;
          saccadeTarget.y = 0;
          nextSaccadeTime = nowMs + 2000 + Math.random() * 3000; // wait before next dart
        }
      }
      currentSaccade.x = THREE.MathUtils.lerp(currentSaccade.x, saccadeTarget.x, 0.4);
      currentSaccade.y = THREE.MathUtils.lerp(currentSaccade.y, saccadeTarget.y, 0.4);

      leftEyePivot.rotation.x = THREE.MathUtils.degToRad(-14.2) + currentSaccade.y;
      leftEyePivot.rotation.y = THREE.MathUtils.degToRad(-16.3) + currentSaccade.x;
      rightEyePivot.rotation.x = THREE.MathUtils.degToRad(-14.2) + currentSaccade.y;
      rightEyePivot.rotation.y = THREE.MathUtils.degToRad(16.3) + currentSaccade.x;

      // Procedural viseme drawing keeps the lip sync while avoiding uncanny mouth art.
      const currentMouthShape = mouthShapeRef.current;
      const mouthSignature = getMouthSignature(currentMouthShape);
      if (mouthSignature !== lastMouthSignature) {
        lastMouthSignature = mouthSignature;
        drawFriendlyMouth(mouthCtx, currentMouthShape);
        mouthTexture.needsUpdate = true;
      }

      // Hover bobbing
      const hoverY = (hoverPositionRef.current / 10) * 0.18;
      characterGroup.position.y = hoverY + Math.sin(elapsedSeconds * 1.8) * 0.035;
      const speechBounce = isTalkingRef.current
        ? Math.sin(elapsedSeconds * 12) * 0.018 * avatarRenderConfigRef.current.talkingBounceIntensity
        : 0;
      bodyMesh.scale.set(1.04 + speechBounce, 1.15 - speechBounce * 0.45, 0.88);

      // Fire animation inside the body core.
      const isTalking = isTalkingRef.current;
      innerFire.update(elapsedSeconds, isTalking);

      // Head gently turns toward cursor
      if (document.body.classList.contains('cursor-hidden')) {
        mouse.x = THREE.MathUtils.lerp(mouse.x, 0, 0.02);
        mouse.y = THREE.MathUtils.lerp(mouse.y, 0, 0.02);
      }
      bodyMesh.rotation.y = THREE.MathUtils.lerp(bodyMesh.rotation.y, mouse.x * 1.5, 0.08);
      bodyMesh.rotation.x = THREE.MathUtils.lerp(bodyMesh.rotation.x, -mouse.y * 1.5, 0.08);

      // Speech tilt
      const targetTilt = (tiltAngleRef.current * Math.PI) / 180;
      characterGroup.rotation.z = THREE.MathUtils.lerp(characterGroup.rotation.z, targetTilt, 0.1);

      const previousCameraLayersMask = camera.layers.mask;
      camera.layers.set(FIRE_BLOOM_LAYER);
      fireBloomComposer.render();
      camera.layers.mask = previousCameraLayersMask;
      composer.render();
    };

    animate();

    // ── 9. Cleanup ────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('mousemove', handleMouseMove as any);
      window.removeEventListener('touchstart', handleMouseMove as any);
      window.removeEventListener('touchmove', handleMouseMove as any);
      cleanupEnvironment();

      bodyGeom.dispose(); bodyMat.dispose();
      eyeGeom.dispose(); eyeMat.dispose();
      eyeHighlightGeom.dispose(); eyeHighlightMat.dispose();
      mouthGeom.dispose(); mouthMat.dispose();
      innerFire.dispose();
      innerFireRef.current = null;
      mouthTexture.dispose();
      gradientMap.dispose();
      fireBloomPass.dispose();
      sceneBloomPass.dispose();
      composer.dispose();
      fireBloomComposer.dispose();
      finalComposerRef.current = null;
      fireBloomComposerRef.current = null;
      renderer.dispose();
    };
  }, [sceneTheme]);

  useEffect(() => {
    innerFireRef.current?.replaceConfig(innerFireConfig);
  }, [innerFireConfig]);

  useEffect(() => {
    containerRef.current?.style.setProperty('--avatar-glow-color', color || '#5B9BF5');
  }, [color]);

  return (
    <div
      ref={containerRef}
      className={`basic-face${isTalking ? ' is-talking' : ''}`}
    >
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
      />
    </div>
  );
}


