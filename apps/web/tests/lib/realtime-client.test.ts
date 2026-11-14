import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient, LIVE_HANDSHAKE_TIMEOUT_MS } from '@/lib/realtime-client';
import type { RealtimeServerMessage, RealtimeSessionInfo } from '../../../../shared/realtime-protocol';

type Listener = (event: Event | MessageEvent<string>) => void;
class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = 0;
  readonly sent: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  private readonly listeners = new Map<string, Listener[]>();
  constructor(readonly url: string) { sockets.push(this); }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.emit('close', new CloseEvent('close')); }
  emit(type: string, event: Event | MessageEvent<string> = new Event(type)) {
    if (type === 'open') this.readyState = 1;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  receive(message: RealtimeServerMessage) {
    this.emit('message', new MessageEvent('message', { data: JSON.stringify(message) }));
  }
}

const sockets: MockWebSocket[] = [];
const clients: RealtimeClient[] = [];
const info: RealtimeSessionInfo = {
  provider: 'gemini', model: 'test-gemini', voice: { mode: 'agent' },
  audio: { inputSampleRate: 16000, outputSampleRate: 24000, format: 'pcm_s16le', channels: 1 },
  capabilities: { tools: true, webSearch: true, nativeResumption: true },
};
const config = { instructions: 'Speak Spanish.', webSearch: true };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => info }));
  vi.stubGlobal('WebSocket', MockWebSocket);
});
afterEach(() => {
  clients.forEach(client => client.disconnect());
  clients.length = sockets.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function client() { const value = new RealtimeClient(); clients.push(value); return value; }
async function open(value: RealtimeClient, conversationId?: string) {
  const count = sockets.length;
  const promise = value.connect(config, 'token', { id: 'agent', name: 'Ascuita' }, conversationId);
  await vi.waitFor(() => expect(sockets.length).toBe(count + 1));
  const socket = sockets.at(-1)!;
  socket.emit('open');
  return { socket, promise };
}

describe('RealtimeClient', () => {
  it('uses v2, sends no provider/model override, and waits for session.ready', async () => {
    const value = client();
    const { socket, promise } = await open(value);
    expect(socket.url).toContain('/live/v2');
    expect(socket.sent[0]?.payload).toMatchObject({ config, authToken: 'token' });
    expect(socket.sent[0]?.payload).not.toHaveProperty('model');
    expect(socket.sent[0]?.payload).not.toHaveProperty('provider');
    socket.receive({ type: 'connection.ready', payload: info });
    expect(value.status).toBe('connecting');
    socket.receive({ type: 'session.ready', payload: { ...info, resumed: false } });
    await expect(promise).resolves.toBe(true);
    expect(value.status).toBe('connected');
  });

  it('closes the socket when provider setup never completes', async () => {
    vi.useFakeTimers();
    const value = client();
    const errors: ErrorEvent[] = [];
    value.on('error', error => errors.push(error));
    const { socket, promise } = await open(value);
    await vi.advanceTimersByTimeAsync(LIVE_HANDSHAKE_TIMEOUT_MS);
    await expect(promise).resolves.toBe(false);
    expect(value.status).toBe('disconnected');
    expect(socket.readyState).toBe(3);
    expect(errors[0]?.message).toContain('setup timed out');
  });

  it('cancels the timeout after session.ready and decodes audio', async () => {
    vi.useFakeTimers();
    const value = client();
    const audio = vi.fn();
    const error = vi.fn();
    value.on('audio', audio).on('error', error);
    const { socket, promise } = await open(value);
    socket.receive({ type: 'audio', payload: { data: 'AAAAAA==', responseId: 'early' } });
    expect(audio).not.toHaveBeenCalled();
    socket.receive({ type: 'session.ready', payload: { ...info, resumed: false } });
    await promise;
    socket.receive({ type: 'audio', payload: { data: 'AAAAAA==', responseId: 'response' } });
    expect(audio).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(LIVE_HANDSHAKE_TIMEOUT_MS);
    expect(error).not.toHaveBeenCalled();
  });

  it('rehydrates bounded text history, deduplicates finals, and scopes native handles', async () => {
    const value = client();
    const first = await open(value, 'conversation');
    first.socket.receive({ type: 'session.ready', payload: { ...info, resumed: false } });
    await first.promise;
    first.socket.receive({ type: 'session.resumption', payload: { provider: 'gemini', model: info.model, agentId: 'agent', conversationId: 'conversation', handle: 'native-handle' } });
    for (let i = 0; i < 30; i++) {
      const event = { type: 'transcript.final', payload: { role: 'user', text: 'x'.repeat(1000), turnId: String(i) } } as const;
      first.socket.receive(event);
      first.socket.receive(event);
    }
    value.disconnect(true);
    const second = await open(value, 'conversation');
    const payload = second.socket.sent[0]?.payload;
    expect(payload?.resume).toMatchObject({ handle: 'native-handle' });
    const history = payload?.history as Array<{ text: string }>;
    expect(history.length).toBeLessThanOrEqual(20);
    expect(history.reduce((size, item) => size + item.text.length, 0)).toBe(12_000);
    second.socket.receive({ type: 'session.ready', payload: { ...info, provider: 'qwen', resumed: true } });
    await second.promise;
    value.disconnect(true);
    const third = await open(value, 'conversation');
    expect(third.socket.sent[0]?.payload?.resume).toBeUndefined();
    value.disconnect(true);
    const different = await open(value, 'other-conversation');
    expect(different.socket.sent[0]?.payload?.history).toEqual([]);
  });

  it('keeps errors provider-independent and forwards tool calls and sources', async () => {
    const value = client();
    const tools = vi.fn();
    const sources = vi.fn();
    const errors = vi.fn();
    value.on('toolcall', tools).on('sources', sources).on('error', errors);
    const { socket, promise } = await open(value);
    socket.receive({ type: 'session.ready', payload: { ...info, resumed: false } });
    await promise;
    socket.receive({ type: 'tool.call', payload: { calls: [{ callId: 'call', name: 'save_user_memory', args: {} }] } });
    socket.receive({ type: 'sources', payload: { summary: 'Result', sources: [{ title: 'Source', url: 'https://example.com' }] } });
    expect(tools).toHaveBeenCalledOnce();
    expect(sources).toHaveBeenCalledOnce();
    await value.sendToolResults([{ callId: 'call', name: 'save_user_memory', result: { success: true } }]);
    expect(socket.sent.at(-1)?.type).toBe('tool.results');
    socket.receive({ type: 'error', payload: { code: 'PROVIDER_NOT_CONFIGURED', message: 'Qwen missing credentials', fatal: true } });
    expect(errors.mock.calls[0]?.[0].error).toEqual({ code: 'PROVIDER_NOT_CONFIGURED', fatal: true });
    expect(value.status).toBe('disconnected');
  });
});
