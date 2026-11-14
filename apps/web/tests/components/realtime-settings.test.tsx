import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeSessionInfo } from '../../../../shared/realtime-protocol';

const mocks = vi.hoisted(() => ({ info: null as RealtimeSessionInfo | null, saveAgent: vi.fn() }));
vi.mock('@/contexts/LiveAPIContext', () => ({ useLiveAPIContext: () => ({
  sessionInfo: mocks.info, connected: false, disconnect: vi.fn(), client: { send: vi.fn() },
}) }));
vi.mock('@/hooks/useUserAgents', () => ({ useUserAgents: () => ({ saveAgent: mocks.saveAgent }) }));
vi.mock('@/hooks/useUserProfile', () => ({ saveUserProfile: vi.fn() }));
vi.mock('@/hooks/useUserMemories', () => ({ useUserMemories: () => ({}) }));
vi.mock('@/components/FireSettingsTab', () => ({ default: () => null }));
vi.mock('@/firebase', () => ({ auth: {}, signOutFromGoogle: vi.fn() }));
vi.mock('@/lib/account-deletion', () => ({ deleteAccount: vi.fn() }));

import SettingsPanel from '@/components/SettingsPanel';
import SourcesPanel from '@/components/console/control-tray/SourcesPanel';
import { useAgent } from '@/lib/state';
import { useLanguage } from '@/lib/i18n';
import { Ascuita } from '@/lib/presets/agents';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  useLanguage.setState({ language: 'es' });
  const agent = { ...Ascuita, id: 'personal', voice: 'Aoede' as const };
  useAgent.setState({ current: agent, availablePersonal: [agent] });
  mocks.info = { provider: 'qwen', model: 'qwen-test', voice: { mode: 'fixed', name: 'Tina' },
    audio: { inputSampleRate: 16000, outputSampleRate: 24000, channels: 1, format: 'pcm_s16le' },
    capabilities: { tools: true, webSearch: true, nativeResumption: false } };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('provider-specific settings', () => {
  it('shows the fixed Qwen voice, saves the original Gemini preference, and restores its selector', async () => {
    await act(async () => root.render(<SettingsPanel />));
    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('nav button')).find(button => button.textContent?.includes('Agentes'))!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[title="Editar"]')!.click());
    const select = container.querySelector<HTMLSelectElement>('#settings-new-agent-voice')!;
    expect(select.disabled).toBe(true);
    expect(select.value).toBe('Tina');
    expect(useAgent.getState().current.voice).toBe('Aoede');
    await act(async () => container.querySelector<HTMLButtonElement>('.settingsPanel__saveAgentBtn')!.click());
    expect(mocks.saveAgent).toHaveBeenCalledWith(expect.objectContaining({ voice: 'Aoede' }));

    mocks.info = { ...mocks.info!, provider: 'gemini', voice: { mode: 'agent' } };
    await act(async () => root.render(<SettingsPanel />));
    await act(async () => container.querySelector<HTMLButtonElement>('[title="Editar"]')!.click());
    const restored = container.querySelector<HTMLSelectElement>('#settings-new-agent-voice')!;
    expect(restored.disabled).toBe(false);
    expect(restored.value).toBe('Aoede');
  });
});

describe('search attribution', () => {
  it('keeps sources collapsed and isolates suggestion markup without script permissions', async () => {
    await act(async () => root.render(<SourcesPanel result={{ summary: 'Resumen', sources: [
      { title: 'Fuente', url: 'https://example.com' }, { title: 'Unsafe', url: 'javascript:alert(1)' },
    ], searchEntryPoint: { renderedContent: '<p>Google suggestions</p><script>window.bad=true</script>' } }} />));
    expect(container.querySelector('details')?.open).toBe(false);
    expect(container.querySelector('summary')?.textContent).toBe('Fuentes');
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('a')?.rel).toContain('noopener');
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe.title).toBeTruthy();
  });
  it('hides the panel before a search has returned attribution', async () => {
    await act(async () => root.render(<SourcesPanel result={null} />));
    expect(container.childElementCount).toBe(0);
  });
});
