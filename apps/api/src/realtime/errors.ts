import { isRecord } from './validation.js';

/** Keep the retry decision intact from the provider through the WebSocket route. */
export class RealtimeProviderError extends Error {
  readonly code: string;
  readonly fatal: boolean;

  constructor(message: string, options: { fatal: boolean; code?: string }) {
    super(message);
    this.name = 'RealtimeProviderError';
    this.code = options.code ?? 'PROVIDER_ERROR';
    this.fatal = options.fatal;
  }
}

export function getProviderError(error: unknown, fallbackCode = 'PROVIDER_ERROR'): RealtimeProviderError {
  if (error instanceof RealtimeProviderError) return error;
  const value = isRecord(error) ? error : {};
  const nested = isRecord(value.error) ? value.error : {};
  const message = typeof error === 'string' ? error
    : typeof value.message === 'string' && value.message ? value.message
      : typeof nested.message === 'string' ? nested.message : 'Realtime provider failed';
  const category = [value.type, value.code, nested.type, nested.code].filter(item => typeof item === 'string').join(' ');
  const status = Number(value.status ?? value.statusCode ?? nested.status ?? value.code
    ?? message.match(/Unexpected server response:\s*(\d{3})/i)?.[1]);
  // Unknown transport failures, timeouts, 429s and 5xx responses may be retried.
  // Invalid requests, authentication, access and billing require intervention.
  const fatal = typeof value.fatal === 'boolean' ? value.fatal
    : [400, 401, 402, 403, 404, 405, 422, 1008].includes(status)
      || /invalid[_ .-]?(request|argument|parameter|api[_ .-]?key)|authentication|unauthorized|permission|forbidden|model[_ .-]?not[_ .-]?found|insufficient[_ .-]?quota|billing|payment/i.test(category)
      || /API[_ ]?key.*(invalid|not valid|missing|expired)|invalid.*API[_ ]?key|permission[_ ]denied|unauthorized|forbidden|prepayment|(?:credit|balance).*(?:deplet|exhaust|insufficient)|billing|payment|quota|RESOURCE_EXHAUSTED|invalid[_ ](?:argument|parameter)|model.*(?:not found|not supported|does not exist)/i.test(message);
  return new RealtimeProviderError(message, { code: fallbackCode, fatal });
}
