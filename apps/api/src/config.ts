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
const DEFAULT_LOG_LEVEL = 'info';
const DEFAULT_SECURITY_LOG_RETENTION_DAYS = 3;
const DEFAULT_HTTP_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_HTTP_RATE_LIMIT_MAX_REQUESTS = 300;
const DEFAULT_WS_CONNECT_WINDOW_MS = 300_000;
const DEFAULT_WS_MAX_CONNECT_ATTEMPTS_PER_IP = 20;
const DEFAULT_WS_MAX_CONCURRENT_CONNECTIONS_PER_IP = 3;
const DEFAULT_WS_MESSAGE_WINDOW_MS = 60_000;
const DEFAULT_WS_MAX_MESSAGES_PER_WINDOW = 2400;
const DEFAULT_WS_MAX_PAYLOAD_BYTES = 262_144;
const DEFAULT_WS_AUDIO_BYTE_WINDOW_MS = 60_000;
const DEFAULT_WS_MAX_AUDIO_BYTES_PER_WINDOW = 7_500_000;
const DEFAULT_WS_TEMPORARY_BLOCK_DURATION_MS = 15 * 60_000;
const DEFAULT_FREE_TRIAL_DURATION_MS = 180_000;
const DEFAULT_CORS_ORIGINS = [
  'https://ascuita.web.app',
  'https://ascuita.firebaseapp.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://localhost',
];

export function isRunningInCloudRun() {
  return Boolean(process.env.K_SERVICE);
}

export function getDefaultHost() {
  return isRunningInCloudRun() ? '0.0.0.0' : '127.0.0.1';
}

export function parseCorsOrigin(value?: string): string[] {
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

export function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getConfig(): AppConfig {
  return {
    host: process.env.HOST || getDefaultHost(),
    port: Number(process.env.PORT || '3000'),
    corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    logLevel: DEFAULT_LOG_LEVEL,
    securityLogDir: process.env.SECURITY_LOG_DIR || 'logs/security',
    securityLogRetentionDays: DEFAULT_SECURITY_LOG_RETENTION_DAYS,
    httpRateLimitWindowMs: DEFAULT_HTTP_RATE_LIMIT_WINDOW_MS,
    httpRateLimitMaxRequests: DEFAULT_HTTP_RATE_LIMIT_MAX_REQUESTS,
    wsConnectWindowMs: DEFAULT_WS_CONNECT_WINDOW_MS,
    wsMaxConnectAttemptsPerIp: DEFAULT_WS_MAX_CONNECT_ATTEMPTS_PER_IP,
    wsMaxConcurrentConnectionsPerIp: DEFAULT_WS_MAX_CONCURRENT_CONNECTIONS_PER_IP,
    wsMessageWindowMs: DEFAULT_WS_MESSAGE_WINDOW_MS,
    wsMaxMessagesPerWindow: DEFAULT_WS_MAX_MESSAGES_PER_WINDOW,
    wsMaxPayloadBytes: DEFAULT_WS_MAX_PAYLOAD_BYTES,
    wsAudioByteWindowMs: DEFAULT_WS_AUDIO_BYTE_WINDOW_MS,
    wsMaxAudioBytesPerWindow: DEFAULT_WS_MAX_AUDIO_BYTES_PER_WINDOW,
    wsTemporaryBlockDurationMs: DEFAULT_WS_TEMPORARY_BLOCK_DURATION_MS,
    freeTrialDurationMs: DEFAULT_FREE_TRIAL_DURATION_MS,
  };
}
