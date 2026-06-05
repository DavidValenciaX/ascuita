/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { type RefObject, useEffect, useState, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { drawFriendlyMouth, getMouthSignature } from '../../../hooks/avatar/mouth-config';
import useFace from '../../../hooks/avatar/use-face';
import useHover from '../../../hooks/avatar/use-hover';
import useTilt from '../../../hooks/avatar/use-tilt';
import { useLiveAPIContext } from '../../../contexts/LiveAPIContext';
import {
  SceneEnvironmentTheme,
  setupSceneEnvironment,
} from '../../../hooks/avatar/useSceneEnvironment';

// Minimum volume level that indicates audio output is occurring
const AUDIO_OUTPUT_DETECTION_THRESHOLD = 0.05;

// Amount of delay between end of audio output and setting talking state to false
const TALKING_STATE_COOLDOWN_MS = 2000;

const BODY_EMISSIVE_INTENSITY = 0.32;
const BODY_OPACITY = 1;
const BLOOM_STRENGTH = 0.1;
const BLOOM_RADIUS = 0.5;
const BLOOM_THRESHOLD = 0.1;
const GLOW_WHITE_MIX = 0.4;
const GLOW_IDLE_OPACITY = 0.2;
const GLOW_PULSE_OPACITY = 0.08;
const GLOW_TALKING_OPACITY = 0.07;

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

function buildGlowTexture(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  // Se aumenta la resolución para un difuminado de mejor calidad
  canvas.width = 256; 
  canvas.height = 256;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Centro x, Centro y, Radio interior, Centro x, Centro y, Radio exterior
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  
  // Modificando estos valores controlas la fuerza del centro y la suavidad del halo
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.1, 'rgba(255, 255, 255, 0.9)'); // núcleo "gordo"
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.4)');
  gradient.addColorStop(0.45, 'rgba(255, 255, 255, 0.2)');
  gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  return canvas;
}

export default function BasicFace({
  canvasRef,
  radius: _radius = 250,
  color,
  sceneTheme = 'light',
}: BasicFaceProps) {
  const timeoutRef = useRef<NodeJS.Timeout>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
  const composerRef = useRef<EffectComposer | null>(null);

  // Synchronize dynamic variables with refs to feed into the Three.js loop without closures going stale
  const eyeScaleRef = useRef(eyeScale);
  const colorRef = useRef(color);
  const hoverPositionRef = useRef(hoverPosition);
  const tiltAngleRef = useRef(tiltAngle);
  const isTalkingRef = useRef(isTalking);
  const mouthShapeRef = useRef(mouthShape);

  useEffect(() => { eyeScaleRef.current = eyeScale; }, [eyeScale]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { hoverPositionRef.current = hoverPosition; }, [hoverPosition]);
  useEffect(() => { tiltAngleRef.current = tiltAngle; }, [tiltAngle]);
  useEffect(() => { isTalkingRef.current = isTalking; }, [isTalking]);
  useEffect(() => { mouthShapeRef.current = mouthShape; }, [mouthShape]);

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
      composerRef.current?.setSize(canvasWidth, canvasHeight);
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
    renderer.toneMappingExposure = 0.82;
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
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvasWidth, canvasHeight),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    composerRef.current = composer;

    // ── 2. Toon shading gradient map ────────────────────────────────────────
    const gradientMap = buildGradientMap();

    // ── 3. Materials ────────────────────────────────────────────────────────
    const initialColor = colorRef.current || '#5B9BF5';
    const bodyMat = new THREE.MeshToonMaterial({
      color: initialColor,
      gradientMap,
      emissive: new THREE.Color(initialColor),
      emissiveIntensity: BODY_EMISSIVE_INTENSITY,
      transparent: true,
      opacity: BODY_OPACITY,
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

    const glowTexture = new THREE.CanvasTexture(buildGlowTexture());
    glowTexture.colorSpace = THREE.SRGBColorSpace;
    const initialGlowColor = new THREE.Color(initialColor).lerp(new THREE.Color('#FFFFFF'), GLOW_WHITE_MIX);

    const innerGlowMat = new THREE.SpriteMaterial({
      map: glowTexture,
      color: initialGlowColor,
      transparent: true,
      opacity: GLOW_IDLE_OPACITY,
      blending: THREE.AdditiveBlending,
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

    const innerGlow = new THREE.Sprite(innerGlowMat);
    innerGlow.position.set(0, -0.08, -0.12);
    innerGlow.renderOrder = 1;
    innerGlow.scale.set(2.2, 2.2, 1);
    bodyMesh.add(innerGlow);

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

    // ── 8. Animation loop ─────────────────────────────────────────────────────
    let animationId: number;
    let lastMouthSignature = '';
    let lastColor = '';
    const glowColor = new THREE.Color(initialColor);
    const glowTint = new THREE.Color(initialColor);

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const elapsedSeconds = performance.now() / 1000;

      // Body color update
      if (colorRef.current !== lastColor) {
        lastColor = colorRef.current || '#5B9BF5';
        bodyMat.color.set(lastColor);
        bodyMat.emissive.set(lastColor);
        glowColor.set(lastColor);
        glowTint.copy(glowColor).lerp(new THREE.Color('#FFFFFF'), GLOW_WHITE_MIX);
        innerGlowMat.color.copy(glowTint);
      }

      // Eye blink — squash both eyes vertically
      const currentEyeScale = eyeScaleRef.current;
      leftEye.scale.y = 1.15 * currentEyeScale;
      rightEye.scale.y = 1.15 * currentEyeScale;
      leftEye.scale.x = 1 + (1 - currentEyeScale) * 0.18;
      rightEye.scale.x = 1 + (1 - currentEyeScale) * 0.18;

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
      const speechBounce = isTalkingRef.current ? Math.sin(elapsedSeconds * 12) * 0.018 : 0;
      bodyMesh.scale.set(1.04 + speechBounce, 1.15 - speechBounce * 0.45, 0.88);

      const glowPulseSpeed = isTalkingRef.current ? 7.8 : 3.4;
      const glowPulse = 0.5 + 0.5 * Math.sin(elapsedSeconds * glowPulseSpeed);
      const glowStrength = isTalkingRef.current ? 1.0 : 0.64;
      innerGlow.scale.setScalar(3.0 + glowPulse * 0.55 + glowStrength * 0.12);
      innerGlowMat.opacity = GLOW_IDLE_OPACITY + glowPulse * GLOW_PULSE_OPACITY + glowStrength * GLOW_TALKING_OPACITY;

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
      glowTexture.dispose();
      mouthTexture.dispose();
      gradientMap.dispose();
      innerGlowMat.dispose();
      bloomPass.dispose();
      composer.dispose();
      composerRef.current = null;
      renderer.dispose();
    };
  }, [sceneTheme]);

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


