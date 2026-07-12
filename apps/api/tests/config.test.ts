import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseCorsOrigin,
  isAllowedOrigin,
  parseNumber,
  getConfig,
} from '../src/config.js';

describe('parseCorsOrigin', () => {
  it('returns default origins when value is undefined', () => {
    expect(parseCorsOrigin(undefined)).toEqual([
      'https://ascuita.web.app',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
    ]);
  });

  it('returns default origins when value is an empty string', () => {
    expect(parseCorsOrigin('')).toEqual([
      'https://ascuita.web.app',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
    ]);
  });

  it('parses a single origin', () => {
    expect(parseCorsOrigin('https://example.com')).toEqual([
      'https://example.com',
    ]);
  });

  it('parses comma-separated origins and trims whitespace', () => {
    expect(
      parseCorsOrigin('https://a.com , https://b.com , https://c.com')
    ).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
  });

  it('filters out empty entries from trailing commas', () => {
    expect(parseCorsOrigin('https://a.com,')).toEqual(['https://a.com']);
  });
});

describe('isAllowedOrigin', () => {
  const allowed = ['https://a.com', 'https://b.com'];

  it('returns true when origin is in the allowed list', () => {
    expect(isAllowedOrigin(allowed, 'https://a.com')).toBe(true);
  });

  it('returns false when origin is not in the allowed list', () => {
    expect(isAllowedOrigin(allowed, 'https://evil.com')).toBe(false);
  });

  it('returns true when origin is undefined', () => {
    expect(isAllowedOrigin(allowed, undefined)).toBe(true);
  });

  it('returns true when origin is null', () => {
    expect(isAllowedOrigin(allowed, null)).toBe(true);
  });
});

describe('parseNumber', () => {
  it('returns the parsed value for a valid positive number', () => {
    expect(parseNumber('42', 10)).toBe(42);
  });

  it('returns fallback for a non-numeric string', () => {
    expect(parseNumber('not-a-number', 10)).toBe(10);
  });

  it('returns fallback for a negative number', () => {
    expect(parseNumber('-5', 10)).toBe(10);
  });

  it('returns fallback for zero', () => {
    expect(parseNumber('0', 10)).toBe(10);
  });

  it('returns fallback for undefined', () => {
    expect(parseNumber(undefined, 10)).toBe(10);
  });

  it('returns fallback for Infinity', () => {
    expect(parseNumber('Infinity', 10)).toBe(10);
  });
});

describe('getConfig', () => {
  const ENV_VARS = [
    'HOST',
    'PORT',
    'CORS_ORIGIN',
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
    'LOG_LEVEL',
    'SECURITY_LOG_DIR',
    'SECURITY_LOG_RETENTION_DAYS',
    'HTTP_RATE_LIMIT_WINDOW_MS',
    'HTTP_RATE_LIMIT_MAX_REQUESTS',
    'WS_CONNECT_WINDOW_MS',
    'WS_MAX_CONNECT_ATTEMPTS_PER_IP',
    'WS_MAX_CONCURRENT_CONNECTIONS_PER_IP',
    'WS_MESSAGE_WINDOW_MS',
    'WS_MAX_MESSAGES_PER_WINDOW',
    'WS_MAX_PAYLOAD_BYTES',
    'WS_AUDIO_BYTE_WINDOW_MS',
    'WS_MAX_AUDIO_BYTES_PER_WINDOW',
    'WS_TEMPORARY_BLOCK_DURATION_MS',
    'FREE_TRIAL_DURATION_MS',
  ];

  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_VARS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it('returns default values when env vars are not set', () => {
    const config = getConfig();
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
    expect(config.corsOrigin).toEqual([
      'https://ascuita.web.app',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
    ]);
    expect(config.geminiApiKey).toBeUndefined();
    expect(config.geminiModel).toBe('gemini-3.1-flash-live-preview');
    expect(config.logLevel).toBe('info');
    expect(config.securityLogDir).toBe('logs/security');
    expect(config.securityLogRetentionDays).toBe(3);
    expect(config.httpRateLimitWindowMs).toBe(60_000);
    expect(config.httpRateLimitMaxRequests).toBe(300);
    expect(config.wsConnectWindowMs).toBe(300_000);
    expect(config.wsMaxConnectAttemptsPerIp).toBe(20);
    expect(config.wsMaxConcurrentConnectionsPerIp).toBe(3);
    expect(config.wsMessageWindowMs).toBe(60_000);
    expect(config.wsMaxMessagesPerWindow).toBe(2400);
    expect(config.wsMaxPayloadBytes).toBe(262_144);
    expect(config.wsAudioByteWindowMs).toBe(60_000);
    expect(config.wsMaxAudioBytesPerWindow).toBe(7_500_000);
    expect(config.wsTemporaryBlockDurationMs).toBe(15 * 60_000);
    expect(config.freeTrialDurationMs).toBe(180_000);
  });

  it('uses env vars when set', () => {
    process.env.HOST = '0.0.0.0';
    process.env.PORT = '8080';
    process.env.CORS_ORIGIN = 'https://custom.com, https://other.com';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_MODEL = 'gemini-custom';
    process.env.SECURITY_LOG_RETENTION_DAYS = '7';
    const config = getConfig();
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(8080);
    expect(config.corsOrigin).toEqual([
      'https://custom.com',
      'https://other.com',
    ]);
    expect(config.geminiApiKey).toBe('test-key');
    expect(config.geminiModel).toBe('gemini-custom');
    expect(config.securityLogRetentionDays).toBe(7);
  });

  it('falls back to defaults for invalid numeric env values', () => {
    process.env.SECURITY_LOG_RETENTION_DAYS = 'not-a-number';
    process.env.WS_MAX_MESSAGES_PER_WINDOW = '-5';
    const config = getConfig();
    expect(config.securityLogRetentionDays).toBe(3);
    expect(config.wsMaxMessagesPerWindow).toBe(2400);
  });
});
