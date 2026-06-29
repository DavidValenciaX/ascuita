type AppConfig = {
  host: string;
  port: number;
  corsOrigin: string[];
  geminiApiKey?: string;
  geminiModel: string;
  logLevel: string;
  securityLogDir: string;
  securityLogRetentionDays: number;
  httpRateLimitWindowMs: number;
  httpRateLimitMaxRequests: number;
  wsConnectWindowMs: number;
  wsMaxConnectAttemptsPerIp: number;
  wsMaxConcurrentConnectionsPerIp: number;
  wsMessageWindowMs: number;
  wsMaxMessagesPerWindow: number;
  wsMaxPayloadBytes: number;
  wsAudioByteWindowMs: number;
  wsMaxAudioBytesPerWindow: number;
  wsTemporaryBlockDurationMs: number;
  freeTrialDurationMs: number;
};

const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-live-preview';
const DEFAULT_CORS_ORIGINS = [
  'https://ascuita.web.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

function parseCorsOrigin(value?: string): string[] {
  if (!value) {
    return DEFAULT_CORS_ORIGINS;
  }

  return value
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(
  allowedOrigins: string[],
  origin?: string | null
) {
  if (!origin) {
    return true;
  }

  return allowedOrigins.includes(origin);
}

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getConfig(): AppConfig {
  return {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || '3000'),
    corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    logLevel: process.env.LOG_LEVEL || 'info',
    securityLogDir: process.env.SECURITY_LOG_DIR || 'logs/security',
    securityLogRetentionDays: parseNumber(
      process.env.SECURITY_LOG_RETENTION_DAYS,
      3
    ),
    httpRateLimitWindowMs: parseNumber(
      process.env.HTTP_RATE_LIMIT_WINDOW_MS,
      60_000
    ),
    httpRateLimitMaxRequests: parseNumber(
      process.env.HTTP_RATE_LIMIT_MAX_REQUESTS,
      300
    ),
    wsConnectWindowMs: parseNumber(
      process.env.WS_CONNECT_WINDOW_MS,
      300_000
    ),
    wsMaxConnectAttemptsPerIp: parseNumber(
      process.env.WS_MAX_CONNECT_ATTEMPTS_PER_IP,
      20
    ),
    wsMaxConcurrentConnectionsPerIp: parseNumber(
      process.env.WS_MAX_CONCURRENT_CONNECTIONS_PER_IP,
      3
    ),
    wsMessageWindowMs: parseNumber(
      process.env.WS_MESSAGE_WINDOW_MS,
      60_000
    ),
    wsMaxMessagesPerWindow: parseNumber(
      process.env.WS_MAX_MESSAGES_PER_WINDOW,
      2400
    ),
    wsMaxPayloadBytes: parseNumber(
      process.env.WS_MAX_PAYLOAD_BYTES,
      262_144
    ),
    wsAudioByteWindowMs: parseNumber(
      process.env.WS_AUDIO_BYTE_WINDOW_MS,
      60_000
    ),
    wsMaxAudioBytesPerWindow: parseNumber(
      process.env.WS_MAX_AUDIO_BYTES_PER_WINDOW,
      7_500_000
    ),
    wsTemporaryBlockDurationMs: parseNumber(
      process.env.WS_TEMPORARY_BLOCK_DURATION_MS,
      15 * 60_000
    ),
    freeTrialDurationMs: parseNumber(
      process.env.FREE_TRIAL_DURATION_MS,
      180_000
    ),
  };
}
