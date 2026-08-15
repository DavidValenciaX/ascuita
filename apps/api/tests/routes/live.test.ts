import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(),
    increment: vi.fn(),
  },
}));

vi.mock('../../src/lib/firebase-admin.js', () => ({
  isFirebaseAdminConfigured: vi.fn(),
  verifyFirebaseIdToken: vi.fn(),
  getAdminDb: vi.fn(),
}));

import {
  safeJsonParse,
  getErrorMessage,
  withLongLivedLiveConfig,
  extractTextFromServerMessage,
  extractTranscriptionFromServerMessage,
  isServerTurnComplete,
  getClientKey,
  incrementCounter,
  getPayloadSize,
  getAudioPayloadBytes,
  isConnectMessage,
  isSendMessage,
  isRealtimeInputMessage,
  isToolResponseMessage,
  toBuffer,
} from '../../src/routes/live.js';

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    const result = safeJsonParse(Buffer.from('{"type":"ping"}'));
    expect(result.type).toBe('ping');
  });

  it('returns empty object for invalid JSON', () => {
    const result = safeJsonParse(Buffer.from('not json'));
    expect(result).toEqual({});
  });

  it('returns empty object for empty input', () => {
    const result = safeJsonParse(Buffer.from(''));
    expect(result).toEqual({});
  });
});

describe('getErrorMessage', () => {
  it('extracts message from an Error instance', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns a string error as-is', () => {
    expect(getErrorMessage('oops')).toBe('oops');
  });

  it('stringifies objects', () => {
    expect(getErrorMessage({ code: 500 })).toBe('[object Object]');
  });

  it('stringifies numbers', () => {
    expect(getErrorMessage(42)).toBe('42');
  });
});

describe('withLongLivedLiveConfig', () => {
  it('enables context compression and transparent resumption by default', () => {
    expect(withLongLivedLiveConfig({})).toMatchObject({
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: { transparent: true },
    });
  });

  it('preserves an existing resumption handle and configuration', () => {
    expect(
      withLongLivedLiveConfig({
        sessionResumption: {
          handle: 'existing-handle',
          transparent: false,
        },
        contextWindowCompression: {
          slidingWindow: { targetTokens: '12000' },
        },
      })
    ).toMatchObject({
      contextWindowCompression: {
        slidingWindow: { targetTokens: '12000' },
      },
      sessionResumption: {
        handle: 'existing-handle',
        transparent: false,
      },
    });
  });
});

describe('extractTextFromServerMessage', () => {
  it('concatenates text from all parts', () => {
    const msg = {
      serverContent: {
        modelTurn: {
          parts: [{ text: 'Hello ' }, { text: 'world' }],
        },
      },
    };
    expect(extractTextFromServerMessage(msg)).toBe('Hello world');
  });

  it('filters out non-text parts', () => {
    const msg = {
      serverContent: {
        modelTurn: {
          parts: [{ inlineData: {} }, { text: 'hi' }],
        },
      },
    };
    expect(extractTextFromServerMessage(msg)).toBe('hi');
  });

  it('returns empty string when serverContent is missing', () => {
    expect(extractTextFromServerMessage({ foo: 'bar' })).toBe('');
  });

  it('returns empty string when parts is missing', () => {
    expect(
      extractTextFromServerMessage({ serverContent: { modelTurn: {} } })
    ).toBe('');
  });

  it('returns empty string for null input', () => {
    expect(extractTextFromServerMessage(null)).toBe('');
  });

  it('returns empty string for non-object input', () => {
    expect(extractTextFromServerMessage('string')).toBe('');
  });
});

describe('extractTranscriptionFromServerMessage', () => {
  it('extracts input transcription text and finished flag', () => {
    const msg = {
      serverContent: {
        inputTranscription: { text: 'hello', finished: true },
      },
    };
    expect(
      extractTranscriptionFromServerMessage(msg, 'inputTranscription')
    ).toEqual({ text: 'hello', finished: true });
  });

  it('extracts output transcription text and finished flag', () => {
    const msg = {
      serverContent: {
        outputTranscription: { text: 'world', finished: false },
      },
    };
    expect(
      extractTranscriptionFromServerMessage(msg, 'outputTranscription')
    ).toEqual({ text: 'world', finished: false });
  });

  it('returns empty defaults when transcription is missing', () => {
    expect(
      extractTranscriptionFromServerMessage(
        { serverContent: {} },
        'inputTranscription'
      )
    ).toEqual({ text: '', finished: false });
  });

  it('returns empty defaults for null input', () => {
    expect(
      extractTranscriptionFromServerMessage(null, 'inputTranscription')
    ).toEqual({ text: '', finished: false });
  });
});

describe('isServerTurnComplete', () => {
  it('returns true when turnComplete is true', () => {
    expect(
      isServerTurnComplete({ serverContent: { turnComplete: true } })
    ).toBe(true);
  });

  it('returns false when turnComplete is false', () => {
    expect(
      isServerTurnComplete({ serverContent: { turnComplete: false } })
    ).toBe(false);
  });

  it('returns false when turnComplete is missing', () => {
    expect(isServerTurnComplete({ serverContent: {} })).toBe(false);
  });

  it('returns false for null input', () => {
    expect(isServerTurnComplete(null)).toBe(false);
  });
});

describe('getClientKey', () => {
  it('returns the IP when provided', () => {
    expect(getClientKey('1.2.3.4')).toBe('1.2.3.4');
  });

  it('returns "unknown" for an empty string', () => {
    expect(getClientKey('')).toBe('unknown');
  });
});

describe('incrementCounter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts counting at 1 for a new key', () => {
    vi.useFakeTimers();
    const map = new Map();
    const result = incrementCounter(map, 'ip1', 1000);
    expect(result.count).toBe(1);
    expect(map.get('ip1').count).toBe(1);
  });

  it('increments count for subsequent calls within the window', () => {
    vi.useFakeTimers();
    const map = new Map();
    incrementCounter(map, 'ip1', 1000);
    const result = incrementCounter(map, 'ip1', 1000);
    expect(result.count).toBe(2);
  });

  it('resets count when the window expires', () => {
    vi.useFakeTimers();
    const map = new Map();
    incrementCounter(map, 'ip1', 1000);
    expect(map.get('ip1').count).toBe(1);
    vi.advanceTimersByTime(1001);
    const result = incrementCounter(map, 'ip1', 1000);
    expect(result.count).toBe(1);
  });

  it('handles multiple keys independently', () => {
    vi.useFakeTimers();
    const map = new Map();
    incrementCounter(map, 'ip1', 1000);
    incrementCounter(map, 'ip2', 1000);
    incrementCounter(map, 'ip1', 1000);
    expect(map.get('ip1').count).toBe(2);
    expect(map.get('ip2').count).toBe(1);
  });
});

describe('getPayloadSize', () => {
  it('returns byte length of a string', () => {
    expect(getPayloadSize('hello')).toBe(5);
  });

  it('returns byte length of a Buffer', () => {
    expect(getPayloadSize(Buffer.from('hello'))).toBe(5);
  });

  it('returns byte length of an ArrayBuffer', () => {
    expect(getPayloadSize(new ArrayBuffer(10))).toBe(10);
  });

  it('returns byte length of a stringified number', () => {
    expect(getPayloadSize(42)).toBe(2);
  });
});

describe('getAudioPayloadBytes', () => {
  const makeMessage = (chunks: Array<{ mimeType: string; data: string }>) => ({
    type: 'realtime_input' as const,
    payload: { chunks },
  });

  it('sums decoded byte length of audio chunks', () => {
    const data = Buffer.from('hello').toString('base64');
    const msg = makeMessage([{ mimeType: 'audio/pcm;rate=24000', data }]);
    expect(getAudioPayloadBytes(msg)).toBe(5);
  });

  it('ignores non-audio chunks', () => {
    const data = Buffer.from('hello').toString('base64');
    const msg = makeMessage([{ mimeType: 'image/jpeg', data }]);
    expect(getAudioPayloadBytes(msg)).toBe(0);
  });

  it('sums only audio chunks in a mixed payload', () => {
    const audioData = Buffer.from('hello').toString('base64');
    const imageData = Buffer.from('world').toString('base64');
    const msg = makeMessage([
      { mimeType: 'audio/pcm', data: audioData },
      { mimeType: 'image/png', data: imageData },
      { mimeType: 'audio/pcm', data: audioData },
    ]);
    expect(getAudioPayloadBytes(msg)).toBe(10);
  });

  it('returns 0 for an empty chunks array', () => {
    const msg = makeMessage([]);
    expect(getAudioPayloadBytes(msg)).toBe(0);
  });
});

describe('type guards', () => {
  it('isConnectMessage', () => {
    expect(isConnectMessage({ type: 'connect' })).toBe(true);
    expect(isConnectMessage({ type: 'send' })).toBe(false);
    expect(isConnectMessage({})).toBe(false);
  });

  it('isSendMessage', () => {
    expect(isSendMessage({ type: 'send' })).toBe(true);
    expect(isSendMessage({ type: 'ping' })).toBe(false);
  });

  it('isRealtimeInputMessage', () => {
    expect(isRealtimeInputMessage({ type: 'realtime_input' })).toBe(true);
    expect(isRealtimeInputMessage({ type: 'connect' })).toBe(false);
  });

  it('isToolResponseMessage', () => {
    expect(isToolResponseMessage({ type: 'tool_response' })).toBe(true);
    expect(isToolResponseMessage({ type: 'send' })).toBe(false);
  });
});

describe('toBuffer', () => {
  it('returns the same Buffer when passed a Buffer', () => {
    const buf = Buffer.from('hello');
    expect(toBuffer(buf)).toBe(buf);
  });

  it('converts a string to a Buffer', () => {
    expect(toBuffer('hello')).toEqual(Buffer.from('hello'));
  });

  it('converts an ArrayBuffer to a Buffer', () => {
    const arr = new Uint8Array([1, 2, 3]).buffer;
    expect(toBuffer(arr)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('converts a number to a Buffer via String()', () => {
    expect(toBuffer(42)).toEqual(Buffer.from('42'));
  });
});
