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

// Inner flame (3D sphere) constants
const FLAME_BASE_RADIUS = 0.45;
const FLAME_IDLE_SCALE = 1.0;
const FLAME_TALKING_SCALE = 1.35;
const FLAME_PULSE_SPEED_IDLE = 2.2;
const FLAME_PULSE_SPEED_TALKING = 8.5;
const FLAME_NOISE_SPEED = 1.8;
const FLAME_COLOR_CORE = '#FF6B35';      // Naranja intenso (núcleo)
const FLAME_COLOR_INNER = '#FF9F1C';     // Amarillo-naranja (zona media)
const FLAME_COLOR_OUTER = '#FFD600';     // Amarillo brillante (punta)
const FLAME_EMISSIVE_INTENSITY = 2.8;
const FLAME_OPACITY = 0.85;

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

/** Custom shader material for a volumetric flame-like sphere */
function createFlameMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorCore: { value: new THREE.Color(FLAME_COLOR_CORE) },
      uColorInner: { value: new THREE.Color(FLAME_COLOR_INNER) },
      uColorOuter: { value: new THREE.Color(FLAME_COLOR_OUTER) },
      uIntensity: { value: FLAME_EMISSIVE_INTENSITY },
      uOpacity: { value: FLAME_OPACITY },
      uScale: { value: FLAME_IDLE_SCALE },
      uIsTalking: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPosition;
      varying vec3 vNormal;
      varying float vDepth;
      
      void main() {
        vPosition = position;
        vNormal = normal;
        vDepth = gl_Position.z / gl_Position.w;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColorCore;
      uniform vec3 uColorInner;
      uniform vec3 uColorOuter;
      uniform float uIntensity;
      uniform float uOpacity;
      uniform float uScale;
      uniform float uIsTalking;
      
      varying vec3 vPosition;
      varying vec3 vNormal;
      varying float vDepth;
      
      // Simplex 3D noise (simplified for performance)
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
      vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
      
      float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        
        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);
        
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        
        i = mod289(i);
        vec4 p = permute(permute(permute(
                  i.z + vec4(0.0, i1.z, i2.z, 1.0))
                + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                + i.x + vec4(0.0, i1.x, i2.x, 1.0));
        
        float n_ = 1.0/7.0;
        vec3 ns = n_ * D.wyz - D.xzx;
        
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);
        
        vec4 x = x_ * ns.x + ns.yyyy;
        vec4 y = y_ * ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        
        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);
        
        vec4 s0 = floor(b0) * 2.0 + 1.0;
        vec4 s1 = floor(b1) * 2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        
        vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
        
        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);
        
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
      }
      
      // Fractal Brownian Motion for organic flame noise
      float fbm(vec3 p) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        for (int i = 0; i < 5; i++) {
          value += amplitude * snoise(p * frequency);
          amplitude *= 0.5;
          frequency *= 2.0;
        }
        return value;
      }
      
      void main() {
        // Normalized position from center (0 to 1 at surface)
        vec3 localPos = vPosition * uScale;
        float distFromCenter = length(localPos);
        
        // Base spherical falloff
        float sphereFalloff = 1.0 - smoothstep(0.0, 1.0, distFromCenter);
        sphereFalloff = pow(sphereFalloff, 1.8); // soft power curve — no hard core
        
        // Flame noise - animated, stretched vertically
        vec3 noisePos = localPos * 2.5;
        noisePos.y *= 1.8; // Stretch vertically like a flame
        noisePos.z *= 0.8;
        float noise = fbm(noisePos + vec3(uTime * 0.8, uTime * 1.2, uTime * 0.5));
        
        // Talking state adds more turbulence
        float talkNoise = 0.0;
        if (uIsTalking > 0.5) {
          talkNoise = fbm(noisePos * 2.0 + vec3(uTime * 3.0, uTime * 4.0, uTime * 2.0)) * uIsTalking;
        }
        
        // Combine noise — smaller noise weight avoids hard lumpy edges
        float flameShape = sphereFalloff + noise * 0.18 + talkNoise * 0.12;
        flameShape = clamp(flameShape, 0.0, 1.0);
        flameShape = pow(flameShape, 1.4); // extra soft roll-off
        
        // Vertical gradient (flame is brighter at top)
        float heightFactor = smoothstep(-0.5, 1.0, localPos.y * uScale);
        
        // Fresnel effect for glowing edges
        vec3 viewDir = normalize(-vPosition);
        float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 2.5);
        
        // Color gradient: core -> inner -> outer
        vec3 color = mix(uColorCore, uColorInner, smoothstep(0.2, 0.6, distFromCenter));
        color = mix(color, uColorOuter, smoothstep(0.5, 0.9, distFromCenter) * heightFactor);
        
        // Add fresnel glow
        color += uColorOuter * fresnel * 0.6 * heightFactor;
        
        // Talking state: brighter, more intense
        float talkBoost = 1.0 + uIsTalking * 0.6;
        color *= talkBoost;
        
        // Final alpha — cubic fade so the outermost pixels dissolve softly
        float alpha = pow(flameShape, 1.5) * uOpacity * (0.5 + 0.5 * heightFactor);
        alpha *= (0.55 + 0.45 * fresnel);
        alpha = pow(alpha, 1.2); // one more pass of softening
        
        // Emissive output for bloom
        gl_FragColor = vec4(color * uIntensity, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide, // Render inside of sphere for volumetric look
  });
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

    // ── 3b. Flame material (3D volumetric sphere) ──────────────────────────────
    const flameMaterial = createFlameMaterial();

    // ── 4. Geometries ───────────────────────────────────────────────────────
    const bodyGeom = new THREE.SphereGeometry(1.55, 32, 32);
    const eyeGeom = new THREE.SphereGeometry(0.16, 32, 32);
    const eyeHighlightGeom = new THREE.SphereGeometry(0.045, 16, 16);
    const mouthGeom = new THREE.PlaneGeometry(0.78, 0.78);
    const flameGeom = new THREE.SphereGeometry(FLAME_BASE_RADIUS, 32, 32);

    // ── 5. Character node hierarchy ─────────────────────────────────────────
    const characterGroup = new THREE.Group();
    scene.add(characterGroup);

    // Body
    const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
    bodyMesh.renderOrder = 0;
    bodyMesh.castShadow = true;
    bodyMesh.scale.set(1.04, 1.15, 0.88);
    characterGroup.add(bodyMesh);

    // Inner flame (3D volumetric sphere) - replaces the 2D glow sprite
    const flameMesh = new THREE.Mesh(flameGeom, flameMaterial);
    flameMesh.renderOrder = 1;
    flameMesh.position.set(0, -0.08, -0.12);
    bodyMesh.add(flameMesh);

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
      const speechBounce = isTalkingRef.current ? Math.sin(elapsedSeconds * 12) * 0.018 : 0;
      bodyMesh.scale.set(1.04 + speechBounce, 1.15 - speechBounce * 0.45, 0.88);

      // Flame animation (replaces 2D glow sprite)
      const isTalking = isTalkingRef.current;
      const pulseSpeed = isTalking ? FLAME_PULSE_SPEED_TALKING : FLAME_PULSE_SPEED_IDLE;
      const pulseScale = isTalking ? FLAME_TALKING_SCALE : FLAME_IDLE_SCALE;
      const pulse = 0.5 + 0.5 * Math.sin(elapsedSeconds * pulseSpeed);
      const currentFlameScale = pulseScale * (0.85 + 0.3 * pulse);
      
      // Update flame shader uniforms
      flameMaterial.uniforms.uTime.value = elapsedSeconds * FLAME_NOISE_SPEED;
      flameMaterial.uniforms.uScale.value = currentFlameScale;
      flameMaterial.uniforms.uIsTalking.value = isTalking ? 1.0 : 0.0;
      
      // Subtle flame position wobble
      flameMesh.position.y = -0.08 + Math.sin(elapsedSeconds * 3.7) * 0.02 + (isTalking ? Math.sin(elapsedSeconds * 15) * 0.015 : 0);
      flameMesh.position.x = Math.sin(elapsedSeconds * 2.3) * 0.015;
      flameMesh.rotation.y = elapsedSeconds * 0.15; // Slow rotation for dynamic feel

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
      flameGeom.dispose(); flameMaterial.dispose();
      mouthTexture.dispose();
      gradientMap.dispose();
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


