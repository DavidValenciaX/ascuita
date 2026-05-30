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

import useFace from '../../../hooks/avatar/use-face';
import type { MouthShape } from '../../../hooks/avatar/use-face';
import useHover from '../../../hooks/avatar/use-hover';
import useTilt from '../../../hooks/avatar/use-tilt';
import { useLiveAPIContext } from '../../../contexts/LiveAPIContext';
import { setupSceneEnvironment } from '../../../hooks/avatar/useSceneEnvironment';

// Minimum volume level that indicates audio output is occurring
const AUDIO_OUTPUT_DETECTION_THRESHOLD = 0.05;

// Amount of delay between end of audio output and setting talking state to false
const TALKING_STATE_COOLDOWN_MS = 2000;

type BasicFaceProps = {
  /** The canvas element on which to render the face. */
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  /** The radius of the face. */
  readonly radius?: number;
  /** The color of the face. */
  readonly color?: string;
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
  canvas.width = 128;
  canvas.height = 128;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.78)');
  gradient.addColorStop(0.28, 'rgba(255, 255, 255, 0.52)');
  gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.16)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);

  return canvas;
}

function drawSmileLine(ctx: CanvasRenderingContext2D, width: number, lift: number) {
  ctx.beginPath();
  ctx.moveTo(-width / 2, 4);
  ctx.quadraticCurveTo(0, 22 + lift, width / 2, 4);
  ctx.stroke();
}

function drawFriendlyMouth(ctx: CanvasRenderingContext2D, mouthShape: MouthShape) {
  ctx.clearRect(0, 0, 256, 256);
  ctx.save();
  ctx.translate(128, 132);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1F2430';
  ctx.fillStyle = '#1F2430';

  if (mouthShape.viseme === 'Neutral') {
    ctx.lineWidth = 14;
    drawSmileLine(ctx, 74, -4);
    ctx.restore();
    return;
  }

  if (mouthShape.viseme === 'M') {
    ctx.lineWidth = 18;
    drawSmileLine(ctx, 58, -12);
    ctx.restore();
    return;
  }

  if (mouthShape.viseme === 'Smile') {
    ctx.lineWidth = 16;
    drawSmileLine(ctx, 104, 6);
    ctx.restore();
    return;
  }

  const isRoundMouth = ['Oh', 'Uh', 'WO-o', 'Surprised'].includes(mouthShape.viseme);
  const openness = Math.max(
    mouthShape.open,
    mouthShape.viseme === 'Surprised' ? 0.75 : isRoundMouth ? 0.42 : 0.25
  );
  const spread = Math.max(mouthShape.spread, mouthShape.viseme === 'Ee' ? 0.58 : 0.22);
  const roundness = Math.max(mouthShape.round, isRoundMouth ? 0.7 : 0.15);
  const mouthWidth = isRoundMouth ? 52 + roundness * 34 : 70 + spread * 62;
  const mouthHeight = 22 + openness * 76;
  const top = -mouthHeight / 2 + 8;

  ctx.beginPath();
  ctx.ellipse(0, top + mouthHeight / 2, mouthWidth / 2, mouthHeight / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  if (mouthHeight > 44) {
    const tongueGradient = ctx.createLinearGradient(0, top + mouthHeight * 0.45, 0, top + mouthHeight);
    tongueGradient.addColorStop(0, '#FF9AB5');
    tongueGradient.addColorStop(1, '#FF6F9A');
    ctx.fillStyle = tongueGradient;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.ellipse(0, top + mouthHeight * 0.65, mouthWidth * 0.28, mouthHeight * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function getMouthSignature(mouthShape: MouthShape) {
  return [
    mouthShape.viseme,
    mouthShape.intensity.toFixed(2),
    mouthShape.open.toFixed(2),
    mouthShape.spread.toFixed(2),
    mouthShape.round.toFixed(2),
  ].join(':');
}


export default function BasicFace({
  canvasRef,
  radius: _radius = 250,
  color,
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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
      1.2,  // strength - aumentado para colors menos luminosos
      0.55, // radius
      0.3   // threshold - BAJADO significativamente para que colores fríos también hagan bloom
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
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#1F2430' });
    const eyeHighlightMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });

    const glowTexture = new THREE.CanvasTexture(buildGlowTexture());
    glowTexture.colorSpace = THREE.SRGBColorSpace;

    const innerGlowMat = new THREE.SpriteMaterial({
      map: glowTexture,
      color: initialColor,
      transparent: true,
      opacity: 0.42,
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
    leftEye.position.set(0, 0, 1.55);
    leftEye.scale.set(1.0, 1.15, 0.42);
    leftEyePivot.add(leftEye);

    const rightEyePivot = new THREE.Group();
    rightEyePivot.rotation.x = THREE.MathUtils.degToRad(-14.2);
    rightEyePivot.rotation.y = THREE.MathUtils.degToRad(16.3);
    bodyMesh.add(rightEyePivot);

    const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
    rightEye.position.set(0, 0, 1.55);
    rightEye.scale.set(1.0, 1.15, 0.42);
    rightEyePivot.add(rightEye);

    const leftEyeHighlight = new THREE.Mesh(eyeHighlightGeom, eyeHighlightMat);
    leftEyeHighlight.position.set(-0.04, 0.04, 0.12);
    leftEye.add(leftEyeHighlight);

    const rightEyeHighlight = new THREE.Mesh(eyeHighlightGeom, eyeHighlightMat);
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
    mouthMesh.renderOrder = 2;
    mouthMesh.position.set(0, 0, 1.55);
    mouthPivot.add(mouthMesh);

    const cleanupEnvironment = setupSceneEnvironment(scene);

    // ── 7. Mouse tracker ─────────────────────────────────────────────────────
    const mouse = { x: 0, y: 0 };
    const handleMouseMove = (e: MouseEvent) => {
      mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove);

    // ── 8. Animation loop ─────────────────────────────────────────────────────
    let animationId: number;
    let lastMouthSignature = '';
    let lastColor = '';
    const white = new THREE.Color('#FFFFFF');
    const glowColor = new THREE.Color(initialColor);

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const elapsedSeconds = performance.now() / 1000;

      // Body color update
      if (colorRef.current !== lastColor) {
        lastColor = colorRef.current || '#5B9BF5';
        bodyMat.color.set(lastColor);
        bodyMat.emissive.set(lastColor);
        glowColor.set(lastColor);
        innerGlowMat.color.copy(glowColor).lerp(white, 0.62);
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
      innerGlow.scale.setScalar(3.5 + glowPulse + glowStrength * 0.2);
      innerGlowMat.opacity = 0.35 + glowPulse * 0.15 + glowStrength * 0.15;

      // Head gently turns toward cursor
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
      window.removeEventListener('mousemove', handleMouseMove);
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
  }, []);

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


