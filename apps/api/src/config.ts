type AppConfig = {
  host: string;
  port: number;
  corsOrigin: string[];
  geminiApiKey?: string;
  geminiModel: string;
  logLevel: string;
};

const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-live-preview';

function parseCorsOrigin(value?: string): string[] {
  if (!value) {
    return ['https://ascuita.web.app'];
  }

  return value
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

export function getConfig(): AppConfig {
  return {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || '3000'),
    corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}
