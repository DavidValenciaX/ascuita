import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { setImmediate } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), verify: vi.fn(), db: vi.fn() }));
vi.mock('../../src/realtime/factory.js', () => ({ createRealtimeSession: mocks.create }));
vi.mock('../../src/lib/firebase-admin.js', () => ({
  isFirebaseAdminConfigured: () => true, verifyFirebaseIdToken: mocks.verify, getAdminDb: mocks.db,
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'now', increment: (n: number) => n } }));

import liveRoute from '../../src/routes/live.js';
import { securityState } from '../../src/lib/security-state.js';
import type { SessionCallbacks, SessionSettings } from '../../src/realtime/types.js';
import type { RealtimeSessionInfo } from '../../../../shared/realtime-protocol.js';

describe('realtime routing and persistence', () => {
  let app: ReturnType<typeof Fastify>;
  let socket: Awaited<ReturnType<typeof app.injectWS>> | undefined;
  let callbacks: SessionCallbacks;
  const sendAudio = vi.fn();
  const updateInstructions = vi.fn();
  const closeSession = vi.fn();
  const added = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('REALTIME_PROVIDER', 'qwen');
    vi.stubEnv('GEMINI_API_KEY', 'google-secret');
    vi.stubEnv('QWEN_API_KEY', 'qwen-secret');
    vi.stubEnv('QWEN_WORKSPACE_ID', 'workspace-test');
    vi.stubEnv('CORS_ORIGIN', 'https://ascuita.web.app');
    mocks.verify.mockResolvedValue({ uid: 'user' });
    added.mockResolvedValue({ id: 'conversation' });
    mocks.db.mockReturnValue({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ agentId: 'agent' }) }), set: async () => {} }), collection: (path: string) => ({ add: (data: unknown) => added(path, data) }) });
    vi.spyOn(securityState, 'getBlock').mockResolvedValue(null);
    vi.spyOn(securityState, 'incrementCounter').mockResolvedValue({ count: 1, resetAt: Date.now() + 60_000 });
    vi.spyOn(securityState, 'acquireConnectionLease').mockResolvedValue({ clientKey: 'test', id: 'lease' });
    vi.spyOn(securityState, 'releaseConnectionLease').mockResolvedValue();
    vi.spyOn(securityState, 'incrementCounterBatch').mockResolvedValue([]);
    mocks.create.mockImplementation((_config: unknown, info: RealtimeSessionInfo, handlers: SessionCallbacks) => {
      callbacks = handlers;
      return { info, connect: async (_settings: SessionSettings) => {
        handlers.onLegacyOpen?.();
        handlers.onLegacyMessage?.({ setupComplete: {} });
        handlers.onEvent({ type: 'session.ready', payload: { ...info, resumed: false } });
      }, sendAudio, updateInstructions, sendText: vi.fn(), sendToolResults: vi.fn(), close: closeSession };
    });
    app = Fastify();
    await app.register(websocket);
    await app.register(liveRoute);
    await app.ready();
  });

  afterEach(async () => {
    socket?.terminate();
    socket = undefined;
    for (const client of app.websocketServer.clients) client.terminate();
    await app.close();
    await setImmediate();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function connect(path = '/live/v2', config: object = { instructions: 'Spanish', tools: [], webSearch: true }) {
    const messages: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    socket = await app.injectWS(path);
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    socket.send(JSON.stringify({ type: 'connect', payload: { config, authToken: 'test-token', agentId: 'agent' } }));
    await vi.waitFor(() => expect(messages.some(message => message.type === 'session.ready' || message.type === 'server_message')).toBe(true));
    return messages;
  }

  it('uses the backend flag on v2 and exposes only public configuration', async () => {
    const response = await app.inject('/live/v2/config');
    expect(response.json()).toMatchObject({ provider: 'qwen', voice: { mode: 'fixed', name: 'Tina' } });
    expect(response.body).not.toContain('secret');
    const messages = await connect();
    expect(mocks.create.mock.calls[0][1].provider).toBe('qwen');
    expect(messages.find(message => message.type === 'session.ready')?.payload?.provider).toBe('qwen');
    socket!.send(JSON.stringify({ type: 'audio', payload: { data: 'AAAAAA==' } }));
    await vi.waitFor(() => expect(sendAudio).toHaveBeenCalledWith('AAAAAA=='));
  });

  it('forwards live instruction changes without persisting them as user messages', async () => {
    await connect();
    socket!.send(JSON.stringify({ type: 'instructions.update', payload: { instructions: 'New personality' } }));
    await vi.waitFor(() => expect(updateInstructions).toHaveBeenCalledWith('New personality'));
    expect(added).not.toHaveBeenCalled();
  });

  it.each([
    { exists: false, agentId: 'agent' },
    { exists: true, agentId: 'different-agent' },
  ])('rejects unavailable or mismatched conversation before passing history upstream: %j', async snapshot => {
    mocks.db.mockReturnValue({ doc: () => ({ get: async () => ({ exists: snapshot.exists, data: () => ({ agentId: snapshot.agentId }) }) }) });
    socket = await app.injectWS('/live/v2');
    const messages: unknown[] = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    socket.send(JSON.stringify({ type: 'connect', payload: {
      config: { instructions: 'Spanish' }, authToken: 'test-token', agentId: 'agent', conversationId: 'old-chat',
      history: [{ role: 'user', text: 'Private old context' }],
    } }));
    await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ type: 'error', payload: expect.objectContaining({ code: 'CONVERSATION_NOT_FOUND' }) })));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects resumption when Firestore cannot verify the requested conversation', async () => {
    mocks.db.mockReturnValue({ doc: () => ({ get: async () => { throw new Error('Firestore unavailable'); } }) });
    socket = await app.injectWS('/live/v2');
    const messages: unknown[] = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    socket.send(JSON.stringify({ type: 'connect', payload: {
      config: { instructions: 'Spanish' }, authToken: 'test-token', agentId: 'agent', conversationId: 'old-chat',
    } }));
    await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ type: 'error', payload: expect.objectContaining({ code: 'CONVERSATION_UNAVAILABLE' }) })));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(['guest', 'missing-database'] as const)('does not forward a saved conversation without a verifiable owner: %s', async mode => {
    if (mode === 'guest') mocks.verify.mockResolvedValue(null);
    else mocks.db.mockReturnValue(null);
    socket = await app.injectWS('/live/v2');
    const messages: unknown[] = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    socket.send(JSON.stringify({ type: 'connect', payload: {
      config: { instructions: 'Spanish' }, authToken: mode === 'guest' ? null : 'test-token',
      agentId: 'agent', conversationId: 'old-chat', history: [{ role: 'user', text: 'Old context' }],
    } }));
    await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ type: 'error', payload: expect.objectContaining({
      code: mode === 'guest' ? 'AUTH_REQUIRED' : 'CONVERSATION_UNAVAILABLE',
    }) })));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('allows a conversation that belongs to the authenticated user and requested agent', async () => {
    const settings = vi.fn();
    mocks.create.mockImplementation((_config: unknown, info: RealtimeSessionInfo, handlers: SessionCallbacks) => ({
      info, connect: async (value: SessionSettings) => { settings(value); handlers.onEvent({ type: 'session.ready', payload: { ...info, resumed: true } }); },
      close: closeSession,
    }));
    socket = await app.injectWS('/live/v2');
    socket.send(JSON.stringify({ type: 'connect', payload: {
      config: { instructions: 'Spanish' }, authToken: 'test-token', agentId: 'agent', conversationId: 'old-chat',
      history: [{ role: 'user', text: 'Previous context' }],
    } }));
    await vi.waitFor(() => expect(settings).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'old-chat', history: [{ role: 'user', text: 'Previous context' }],
    })));
  });

  it.each([false, true])('preserves the provider connection error classification (fatal=%s)', async fatal => {
    mocks.create.mockImplementation((_config: unknown, info: RealtimeSessionInfo) => ({
      info, connect: async () => { throw Object.assign(new Error('Provider connection failed'), { fatal }); },
      close: closeSession,
    }));
    socket = await app.injectWS('/live/v2');
    const messages: unknown[] = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    socket.send(JSON.stringify({ type: 'connect', payload: { config: { instructions: 'Test' }, authToken: 'test-token' } }));
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'error', payload: {
      code: 'PROVIDER_CONNECT_FAILED', message: 'Provider connection failed', fatal,
    } }));
    expect(closeSession).toHaveBeenCalledOnce();
  });

  it('keeps /live on Gemini and its original envelope while Qwen is active', async () => {
    const messages = await connect('/live', { responseModalities: ['AUDIO'] });
    expect(mocks.create.mock.calls[0][1].provider).toBe('gemini');
    expect(messages).toContainEqual({ type: 'open' });
    expect(messages).toContainEqual({ type: 'server_message', payload: { setupComplete: {} } });
    expect(messages.some(message => message.type === 'session.ready')).toBe(false);
  });

  it('rejects client model overrides before opening an upstream session', async () => {
    socket = await app.injectWS('/live/v2');
    const messages: Array<{ type: string; payload?: { code?: string } }> = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    socket.send(JSON.stringify({ type: 'connect', payload: { model: 'other', config: { instructions: '' } } }));
    await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ type: 'error', payload: expect.objectContaining({ code: 'INVALID_MESSAGE' }) })));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('saves each finalized transcript once, rather than persisting audio fragments', async () => {
    await connect();
    callbacks.onEvent({ type: 'transcript.delta', payload: { role: 'user', turnId: 'one', text: 'Ho' } });
    const first = { type: 'transcript.final', payload: { role: 'user', turnId: 'one', text: 'Hola' } } as const;
    callbacks.onEvent(first);
    callbacks.onEvent(first);
    callbacks.onEvent({ type: 'transcript.final', payload: { role: 'assistant', turnId: 'two', text: 'Buenos días' } });
    await vi.waitFor(() => expect(added.mock.calls.filter(([path]) => path.endsWith('/messages'))).toHaveLength(2));
    expect(added.mock.calls.filter(([path]) => path.endsWith('/messages')).map(([, data]) => data)).toEqual([
      expect.objectContaining({ role: 'user', text: 'Hola' }), expect.objectContaining({ role: 'assistant', text: 'Buenos días' }),
    ]);
  });

  it('closes the upstream and ignores late events when the browser disconnects', async () => {
    await connect();
    socket!.terminate();
    await vi.waitFor(() => expect(closeSession).toHaveBeenCalledOnce());
    callbacks.onEvent({ type: 'transcript.final', payload: { role: 'assistant', turnId: 'late', text: 'Late message' } });
    await setImmediate();
    expect(added).not.toHaveBeenCalled();
  });

  it('clears the authenticated persistence scope when the same socket starts a guest session', async () => {
    const messages = await connect();
    callbacks.onEvent({ type: 'transcript.final', payload: { role: 'user', turnId: 'authenticated', text: 'Personal message' } });
    await vi.waitFor(() => expect(added.mock.calls.filter(([path]) => path.endsWith('/messages'))).toHaveLength(1));
    mocks.verify.mockResolvedValue(null);
    vi.spyOn(securityState, 'getOrStartGuestTrial').mockResolvedValue(Date.now());
    socket!.send(JSON.stringify({ type: 'connect', payload: { config: { instructions: 'Guest' } } }));
    await vi.waitFor(() => expect(messages.filter(event => event.type === 'session.ready')).toHaveLength(2));
    callbacks.onEvent({ type: 'transcript.final', payload: { role: 'user', turnId: 'guest', text: 'Guest message' } });
    await setImmediate();
    expect(added.mock.calls.filter(([path]) => path.endsWith('/messages'))).toHaveLength(1);
    expect(securityState.getOrStartGuestTrial).toHaveBeenCalledOnce();
  });
});
