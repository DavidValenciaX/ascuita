import { API_BASE_URL } from './constants';

export const API_READINESS_TIMEOUT_MS = 8_000;
export const API_READINESS_MAX_ATTEMPTS = 3;
export const API_READINESS_RETRY_DELAY_MS = 500;

type ReadinessOptions = {
  attempts?: number;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  timeoutMs?: number;
};

function wait(milliseconds: number) {
  return new Promise<void>(resolve => {
    window.setTimeout(resolve, milliseconds);
  });
}

export async function waitForApiReady(options: ReadinessOptions = {}) {
  const attempts = Math.max(
    1,
    options.attempts ?? API_READINESS_MAX_ATTEMPTS
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryDelayMs = Math.max(
    0,
    options.retryDelayMs ?? API_READINESS_RETRY_DELAY_MS
  );
  const timeoutMs = Math.max(
    1,
    options.timeoutMs ?? API_READINESS_TIMEOUT_MS
  );
  const readinessUrl = new URL('/ready', API_BASE_URL).toString();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(readinessUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });

      if (response.ok) {
        return true;
      }
    } catch {
      // Retry transient startup, network, and timeout errors.
    } finally {
      window.clearTimeout(timeout);
    }

    if (attempt < attempts - 1) {
      await wait(retryDelayMs * (attempt + 1));
    }
  }

  return false;
}
