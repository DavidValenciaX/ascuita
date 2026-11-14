import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfig, realtimeConfigurationErrors, realtimeReadinessChecks, realtimeSessionInfo } from '../../src/config.js';
import { parseClientMessage } from '../../src/realtime/validation.js';

beforeEach(() => {
  for (const name of ['REALTIME_PROVIDER', 'QWEN_API_KEY', 'QWEN_WORKSPACE_ID', 'QWEN_MODEL', 'QWEN_VOICE', 'WEB_SEARCH_MODEL']) vi.stubEnv(name, '');
  vi.stubEnv('GEMINI_API_KEY', 'google-test');
});
afterEach(() => vi.unstubAllEnvs());

describe('provider configuration', () => {
  it('defaults to Gemini without requiring Qwen credentials', () => {
    const config = getConfig();
    expect(config.realtimeProvider).toBe('gemini');
    expect(realtimeConfigurationErrors(config)).toEqual([]);
    expect(realtimeSessionInfo(config).voice.mode).toBe('agent');
  });
  it('rejects an invalid provider', () => {
    vi.stubEnv('REALTIME_PROVIDER', 'other');
    expect(getConfig).toThrow('REALTIME_PROVIDER must be gemini or qwen');
  });
  it('requires a Qwen key and valid workspace only when Qwen is active', () => {
    vi.stubEnv('REALTIME_PROVIDER', 'qwen');
    expect(realtimeConfigurationErrors(getConfig())).toHaveLength(2);
    vi.stubEnv('QWEN_API_KEY', 'qwen-test');
    vi.stubEnv('QWEN_WORKSPACE_ID', 'workspace-test');
    expect(realtimeConfigurationErrors(getConfig())).toEqual([]);
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(realtimeConfigurationErrors(getConfig())).toEqual(['GEMINI_API_KEY is missing on the backend']);
  });
  it('exposes capabilities and the fixed voice, never secrets', () => {
    vi.stubEnv('REALTIME_PROVIDER', 'qwen');
    const info = realtimeSessionInfo(getConfig());
    expect(info).toMatchObject({ provider: 'qwen', model: 'qwen3.8-omni-flash-realtime', voice: { mode: 'fixed', name: 'Tina' } });
    expect(JSON.stringify(info)).not.toContain('google-test');
    expect(info.capabilities.nativeResumption).toBe(false);
  });
  it('identifies missing credentials in readiness without contacting a provider', () => {
    expect(realtimeReadinessChecks(getConfig())).toEqual([{ name: 'geminiApiKey', ready: true }]);
    vi.stubEnv('REALTIME_PROVIDER', 'qwen');
    expect(realtimeReadinessChecks(getConfig())).toEqual([
      { name: 'geminiApiKey', ready: true }, { name: 'qwenApiKey', ready: false }, { name: 'qwenWorkspaceId', ready: false },
    ]);
  });
});

describe('neutral client validation', () => {
  it('does not allow the client to select a provider or model', () => {
    for (const override of [{ provider: 'gemini' }, { model: 'expensive-model' }]) {
      expect(() => parseClientMessage({ type: 'connect', payload: { config: { instructions: '' }, ...override } })).toThrow();
    }
  });
  it('rejects malformed audio, tool schemas, and forged resume state', () => {
    expect(() => parseClientMessage({ type: 'audio', payload: { data: '<bad>' } })).toThrow();
    expect(() => parseClientMessage({ type: 'audio', payload: { data: 'AA==' } })).toThrow();
    expect(() => parseClientMessage({ type: 'connect', payload: { config: { instructions: '', tools: [{ name: 'tool', parameters: { type: 'wrong' } }] } } })).toThrow();
    expect(() => parseClientMessage({ type: 'connect', payload: { config: { instructions: '' }, resume: { handle: 'x' } } })).toThrow();
  });
});
