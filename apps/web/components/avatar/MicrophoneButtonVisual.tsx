import { useEffect, useRef, useState } from 'react';
import type { createMicrophoneButtonScene } from '@/lib/microphone-button-scene';
import { RENDER_QUALITY_PROFILES, useRenderQuality } from '@/lib/render-quality';

type ButtonScene = ReturnType<typeof createMicrophoneButtonScene>;

export default function MicrophoneButtonVisual({ busy }: { busy: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ButtonScene | null>(null);
  const [rendered, setRendered] = useState(false);
  // A second WebGL context is too much for low-end GPUs; use the SVG button there.
  const useWebGL = useRenderQuality(state => RENDER_QUALITY_PROFILES[state.tier].webglMicrophoneButton);

  useEffect(() => {
    const canvas = canvasRef.current;
    const button = canvas?.closest('button');
    if (!useWebGL || !canvas || !button || typeof window.WebGL2RenderingContext === 'undefined') return;
    let cancelled = false;
    void import('@/lib/microphone-button-scene').then(({ createMicrophoneButtonScene }) => {
      if (cancelled) return;
      sceneRef.current = createMicrophoneButtonScene(canvas, button, () => {
        sceneRef.current?.dispose();
        sceneRef.current = null;
        setRendered(false);
      });
      setRendered(true);
    }).catch(() => {
      // Keep a fully usable, lightweight button when WebGL is unavailable.
      if (!cancelled) setRendered(false);
    });
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      setRendered(false);
    };
  }, [useWebGL]);

  useEffect(() => { sceneRef.current?.setBusy(busy); }, [busy]);

  return (
    <span className={`audio-welcome__microphone${rendered ? ' is-rendered' : ''}`}>
      <canvas ref={canvasRef} className="audio-welcome__button-scene" />
      {busy ? (
        <span className="audio-welcome__spinner" />
      ) : (
        <svg viewBox="0 0 32 32" fill="none">
          <rect x="11" y="3" width="10" height="17" rx="5" stroke="currentColor" strokeWidth="2" />
          <path d="M6.5 14.5v1a9.5 9.5 0 0 0 19 0v-1M16 25v4m-5 0h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}
