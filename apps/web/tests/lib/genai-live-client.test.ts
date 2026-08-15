import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GenAILiveClient,
  LIVE_HANDSHAKE_TIMEOUT_MS,
} from '@/lib/genai-live-client';

type Listener = (event: Event | MessageEvent<string>) => void;

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readonly url: string;
  readyState = 0;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    mockSockets.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send() {}

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', new CloseEvent('close'));
  }

  emit(type: 'open' | 'close' | 'message', event?: Event | MessageEvent<string>) {
    if (type === 'open') {
      this.readyState = MockWebSocket.OPEN;
    }

    for (const listener of this.listeners.get(type) ?? []) {
      listener(event ?? new Event(type));
    }
  }
}

const mockSockets: MockWebSocket[] = [];

describe('GenAILiveClient', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    mockSockets.length = 0;
  });

  it('closes a connection when Gemini never sends setupComplete', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.stubGlobal('WebSocket', MockWebSocket);

    const client = new GenAILiveClient();
    const errors: ErrorEvent[] = [];
    client.on('error', error => errors.push(error));

    const connectionPromise = client.connect({});
    await vi.waitFor(() => expect(mockSockets).toHaveLength(1));
    const socket = mockSockets[0];
    if (!socket) {
      throw new Error('Expected a WebSocket connection');
    }
    socket.emit('open');
    await connectionPromise;

    await vi.advanceTimersByTimeAsync(LIVE_HANDSHAKE_TIMEOUT_MS);

    expect(client.status).toBe('disconnected');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('setup timed out');
  });

  it('cancels the timeout after setupComplete arrives', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.stubGlobal('WebSocket', MockWebSocket);

    const client = new GenAILiveClient();
    const setupComplete = vi.fn();
    const errors: ErrorEvent[] = [];
    client.on('setupcomplete', setupComplete);
    client.on('error', error => errors.push(error));

    const connectionPromise = client.connect({});
    await vi.waitFor(() => expect(mockSockets).toHaveLength(1));
    const socket = mockSockets[0];
    if (!socket) {
      throw new Error('Expected a WebSocket connection');
    }
    socket.emit('open');
    await connectionPromise;
    socket.emit(
      'message',
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'open' }),
      })
    );
    socket.emit(
      'message',
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'server_message',
          payload: { setupComplete: {} },
        }),
      })
    );

    await vi.advanceTimersByTimeAsync(LIVE_HANDSHAKE_TIMEOUT_MS);

    expect(setupComplete).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(0);
    expect(client.status).toBe('connected');
  });
});
