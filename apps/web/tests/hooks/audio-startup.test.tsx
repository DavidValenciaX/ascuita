import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventEmitter from 'eventemitter3';

const mocks = vi.hoisted(() => ({
  audioContext: vi.fn(),
  prepare: vi.fn(),
  stop: vi.fn(),
  dispose: vi.fn(),
  addWorklet: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('@/lib/utils', () => ({ audioContext: mocks.audioContext }));
vi.mock('@/lib/audio-recorder', () => ({ AudioRecorder: class {
  prepare = mocks.prepare;
  stop = mocks.stop;
  dispose = mocks.dispose;
} }));
vi.mock('@/lib/audio-streamer', () => ({ AudioStreamer: class {
  context: AudioContext;
  addWorklet = mocks.addWorklet;
  constructor(context: AudioContext) { this.context = context; }
} }));
vi.mock('@/lib/genai-live-client', () => ({ GenAILiveClient: class extends EventEmitter {
  connect = mocks.connect;
  disconnect = mocks.disconnect;
} }));

import { LiveAPIProvider, useLiveAPIContext } from '@/contexts/LiveAPIContext';
import LoadingScreen from '@/components/avatar/LoadingScreen';
import { useAuthGate } from '@/lib/state';
import { useLanguage } from '@/lib/i18n';
import type { UseLiveApiResults } from '@/hooks/media/use-live-api';

let api: UseLiveApiResults;
let root: Root;
let container: HTMLDivElement;

function CaptureAPI() {
  api = useLiveAPIContext();
  return <LoadingScreen />;
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  mocks.audioContext.mockResolvedValue({ state: 'running', close: vi.fn().mockResolvedValue(undefined) });
  mocks.prepare.mockResolvedValue(undefined);
  mocks.addWorklet.mockResolvedValue(undefined);
  useAuthGate.setState({ authReady: true, trialExpired: false, isAuthenticated: false });
  useLanguage.setState({ language: 'es' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(<LiveAPIProvider><CaptureAPI /></LiveAPIProvider>); });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('explicit audio start', () => {
  it('shows the start button without opening audio, requesting the mic, or connecting', async () => {
    expect(container.querySelector('button')?.textContent).toContain('Empezar a conversar');
    expect(container.textContent).toContain('micrófono');
    expect(mocks.audioContext).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    await act(async () => api.connect());
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('keeps keyboard focus on the start and privacy controls while the gate is open', () => {
    const button = container.querySelector('button')!;
    const privacy = container.querySelector('a')!;
    expect(document.activeElement).toBe(button);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(privacy);
    privacy.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(button);
  });

  it('unlocks both sides immediately on click and waits for permission before connecting', async () => {
    let allow!: () => void;
    mocks.prepare.mockReturnValue(new Promise<void>(resolve => { allow = resolve; }));
    await act(async () => {
      container.querySelector('button')!.click();
      expect(mocks.audioContext).toHaveBeenCalledOnce();
      expect(mocks.prepare).toHaveBeenCalledOnce();
    });
    expect(api.audioReady).toBe(false);
    expect(container.querySelector('button')?.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Permite el acceso');
    await act(async () => api.connect());
    expect(mocks.connect).not.toHaveBeenCalled();

    await act(async () => { allow(); });
    expect(api.audioReady).toBe(true);
    await act(async () => api.connect());
    expect(mocks.connect).toHaveBeenCalledOnce();
  });

  it('coalesces repeated clicks into one microphone request', async () => {
    let allow!: () => void;
    mocks.prepare.mockReturnValue(new Promise<void>(resolve => { allow = resolve; }));
    await act(async () => {
      const first = api.startAudio();
      const second = api.startAudio();
      expect(mocks.prepare).toHaveBeenCalledOnce();
      allow();
      await Promise.all([first, second]);
    });
    expect(api.audioReady).toBe(true);
  });

  it('explains a denied permission, stays disconnected, and offers a working retry', async () => {
    mocks.prepare.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    await act(async () => container.querySelector('button')!.click());
    expect(api.audioReady).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('bloqueado');
    expect(container.querySelector('button')?.textContent).toContain('Volver a intentar');
    expect(mocks.connect).not.toHaveBeenCalled();

    await act(async () => container.querySelector('button')!.click());
    expect(api.audioReady).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });
});
