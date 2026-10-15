import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { setImmediate } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@google/genai', () => ({ GoogleGenAI: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: {} }));
vi.mock('../../src/lib/firebase-admin.js', () => ({
  isFirebaseAdminConfigured: () => false,
  verifyFirebaseIdToken: vi.fn(),
  getAdminDb: vi.fn(),
}));

import liveRoute from '../../src/routes/live.js';
import { getConfig } from '../../src/config.js';
import { securityState, type ConnectionLease } from '../../src/lib/security-state.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('live WebSocket startup', () => {
  let app: ReturnType<typeof Fastify>;
  let socket: Awaited<ReturnType<typeof app.injectWS>> | undefined;
  const lease: ConnectionLease = { clientKey: '127.0.0.1', id: 'startup-test' };

  beforeEach(async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('CORS_ORIGIN', 'https://ascuita.web.app');
    vi.spyOn(securityState, 'getBlock').mockResolvedValue(null);
    vi.spyOn(securityState, 'incrementCounter').mockResolvedValue({ count: 1, resetAt: Date.now() + 60_000 });
    vi.spyOn(securityState, 'acquireConnectionLease').mockResolvedValue(lease);
    vi.spyOn(securityState, 'releaseConnectionLease').mockResolvedValue();
    vi.spyOn(securityState, 'incrementCounterBatch').mockResolvedValue([]);
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

  it('processes connect sent immediately while Redis security checks are pending', async () => {
    const block = deferred<null>();
    vi.mocked(securityState.getBlock).mockReturnValue(block.promise);
    socket = await app.injectWS('/live');
    const messages: Array<{ type: string; payload?: { message?: string } }> = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));

    socket.send(JSON.stringify({ type: 'connect', payload: { config: {} } }));
    await setImmediate();
    expect(messages).toEqual([]);
    expect(securityState.acquireConnectionLease).not.toHaveBeenCalled();

    block.resolve(null);
    // A configuration error proves the early connect reached the session handler,
    // without calling the real Gemini service or consuming a guest trial.
    await vi.waitFor(() => expect(messages).toContainEqual({
      type: 'error', payload: { message: 'GEMINI_API_KEY is missing on the backend' },
    }));
    expect(messages[0]?.type).toBe('connection.ready');
  });

  it('does not process an early connect when the security checks reject the client', async () => {
    const block = deferred<{ reason: string; expiresAt: number } | null>();
    vi.mocked(securityState.getBlock).mockReturnValue(block.promise);
    socket = await app.injectWS('/live');
    const messages: unknown[] = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    const serverSocket = [...app.websocketServer.clients][0]!;
    const close = vi.spyOn(serverSocket, 'close');
    socket.send(JSON.stringify({ type: 'connect', payload: { config: {} } }));
    await setImmediate();

    block.resolve({ reason: 'test-block', expiresAt: Date.now() + 60_000 });
    await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1008, 'Temporarily blocked'));
    expect(messages).toEqual([]);
    expect(securityState.acquireConnectionLease).not.toHaveBeenCalled();
  });

  it('releases a lease that arrives after the browser disconnects during startup', async () => {
    const acquired = deferred<ConnectionLease | null>();
    vi.mocked(securityState.acquireConnectionLease).mockReturnValue(acquired.promise);
    socket = await app.injectWS('/live');
    await vi.waitFor(() => expect(securityState.acquireConnectionLease).toHaveBeenCalled());
    const serverSocket = [...app.websocketServer.clients][0]!;
    socket.terminate();
    await vi.waitFor(() => expect(serverSocket.readyState).toBe(serverSocket.CLOSED));

    acquired.resolve(lease);
    await vi.waitFor(() => expect(securityState.releaseConnectionLease).toHaveBeenCalledExactlyOnceWith(lease));
  });

  it('bounds the total payload retained while Redis is pending', async () => {
    const block = deferred<null>();
    vi.mocked(securityState.getBlock).mockReturnValue(block.promise);
    socket = await app.injectWS('/live');
    const serverSocket = [...app.websocketServer.clients][0]!;
    const close = vi.spyOn(serverSocket, 'close');
    const chunk = Buffer.alloc(Math.floor(getConfig().wsMaxPayloadBytes / 2) + 1);
    socket.send(chunk);
    socket.send(chunk);

    await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1009, 'Startup payload too large'));
    block.resolve(null);
    await vi.waitFor(() => expect(securityState.releaseConnectionLease).toHaveBeenCalledWith(lease));
  });
});
