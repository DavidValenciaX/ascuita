import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseCorsOrigin,
  isAllowedOrigin,
  parseNumber,
  getConfig,
  getDefaultHost,
  isRunningInCloudRun,
} from '../src/config.js';

describe('parseCorsOrigin', () => {
  it('returns default origins when value is undefined', () => {
    expect(parseCorsOrigin(undefined)).toEqual([
      'https://ascuita.web.app',
      'https://ascuita.firebaseapp.com',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
      'https://localhost',
    ]);
  });

  it('returns default origins when value is an empty string', () => {
    expect(parseCorsOrigin('')).toEqual([
      'https://ascuita.web.app',
      'https://ascuita.firebaseapp.com',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
      'https://localhost',
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

  it('allows the Capacitor Android origin when configured', () => {
    expect(isAllowedOrigin(['https://localhost'], 'https://localhost')).toBe(
      true
    );
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
    'K_SERVICE',
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
      'https://ascuita.firebaseapp.com',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
      'https://localhost',
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

  it('uses 0.0.0.0 by default on Cloud Run', () => {
    process.env.K_SERVICE = 'ascuita-api';
    const config = getConfig();
    expect(config.host).toBe('0.0.0.0');
  });

  it('uses env vars when set', () => {
    process.env.HOST = '0.0.0.0';
    process.env.PORT = '8080';
    process.env.CORS_ORIGIN = 'https://custom.com, https://other.com';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_MODEL = 'gemini-custom';
    const config = getConfig();
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(8080);
    expect(config.corsOrigin).toEqual([
      'https://custom.com',
      'https://other.com',
    ]);
    expect(config.geminiApiKey).toBe('test-key');
    expect(config.geminiModel).toBe('gemini-custom');
  });

  it('keeps runtime limits fixed even if env vars are present', () => {
    process.env.LOG_LEVEL = 'debug';
    process.env.SECURITY_LOG_RETENTION_DAYS = '7';
    process.env.HTTP_RATE_LIMIT_WINDOW_MS = '10';
    process.env.HTTP_RATE_LIMIT_MAX_REQUESTS = '11';
    process.env.WS_CONNECT_WINDOW_MS = '12';
    process.env.WS_MAX_CONNECT_ATTEMPTS_PER_IP = '13';
    process.env.WS_MAX_CONCURRENT_CONNECTIONS_PER_IP = '14';
    process.env.WS_MESSAGE_WINDOW_MS = '15';
    process.env.WS_MAX_MESSAGES_PER_WINDOW = '16';
    process.env.WS_MAX_PAYLOAD_BYTES = '17';
    process.env.WS_AUDIO_BYTE_WINDOW_MS = '18';
    process.env.WS_MAX_AUDIO_BYTES_PER_WINDOW = '19';
    process.env.WS_TEMPORARY_BLOCK_DURATION_MS = '20';
    process.env.FREE_TRIAL_DURATION_MS = '21';
    const config = getConfig();
    expect(config.logLevel).toBe('info');
    expect(config.securityLogRetentionDays).toBe(3);
    expect(config.wsMaxMessagesPerWindow).toBe(2400);
    expect(config.httpRateLimitWindowMs).toBe(60_000);
    expect(config.httpRateLimitMaxRequests).toBe(300);
    expect(config.wsConnectWindowMs).toBe(300_000);
    expect(config.wsMaxConnectAttemptsPerIp).toBe(20);
    expect(config.wsMaxConcurrentConnectionsPerIp).toBe(3);
    expect(config.wsMessageWindowMs).toBe(60_000);
    expect(config.wsMaxPayloadBytes).toBe(262_144);
    expect(config.wsAudioByteWindowMs).toBe(60_000);
    expect(config.wsMaxAudioBytesPerWindow).toBe(7_500_000);
    expect(config.wsTemporaryBlockDurationMs).toBe(15 * 60_000);
    expect(config.freeTrialDurationMs).toBe(180_000);
  });
});

describe('Cloud Run helpers', () => {
  const savedKService = process.env.K_SERVICE;

  afterEach(() => {
    if (savedKService === undefined) {
      delete process.env.K_SERVICE;
    } else {
      process.env.K_SERVICE = savedKService;
    }
  });

  it('detects when the process runs on Cloud Run', () => {
    process.env.K_SERVICE = 'ascuita-api';
    expect(isRunningInCloudRun()).toBe(true);
    expect(getDefaultHost()).toBe('0.0.0.0');
  });

  it('falls back to localhost outside Cloud Run', () => {
    delete process.env.K_SERVICE;
    expect(isRunningInCloudRun()).toBe(false);
    expect(getDefaultHost()).toBe('127.0.0.1');
  });
});
