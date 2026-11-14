import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listener: undefined as undefined | ((event: { isActive: boolean }) => void),
  connect: vi.fn(), disconnect: vi.fn(), stop: vi.fn(), remove: vi.fn(), resume: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: (_type: string, listener: typeof mocks.listener) => {
  mocks.listener = listener;
  return Promise.resolve({ remove: mocks.remove });
} } }));
vi.mock('@/contexts/LiveAPIContext', () => ({ useLiveAPIContext: () => ({
  client: {}, connected: false, connecting: false, audioReady: true, sources: null,
  connect: mocks.connect, disconnect: mocks.disconnect, reportAudioError: vi.fn(),
  audioRecorder: { stop: mocks.stop, off: vi.fn(), audioContext: { resume: mocks.resume } },
  audioStreamer: { context: { resume: mocks.resume } },
}) }));

import ControlTray from '@/components/console/control-tray/ControlTray';
import { useAuthGate, useUI } from '@/lib/state';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('pauses the native session in background and reconnects with preserved context on return', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  useAuthGate.setState({ authReady: true, trialExpired: false, isAuthenticated: false, introPlaying: false });
  useUI.setState({ showSettingsPanel: false });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ControlTray />));
    await act(async () => { mocks.listener!({ isActive: false }); });
    expect(mocks.disconnect).toHaveBeenCalledWith(true);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(mocks.connect).not.toHaveBeenCalled();
    mocks.connect.mockResolvedValue(undefined);
    await act(async () => { mocks.listener!({ isActive: true }); });
    expect(mocks.resume).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(mocks.connect).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
  }
  expect(mocks.remove).toHaveBeenCalled();
});
