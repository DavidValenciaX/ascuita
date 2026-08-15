import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  API_READINESS_MAX_ATTEMPTS,
  waitForApiReady,
} from '@/lib/api-readiness';

describe('waitForApiReady', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves when the API readiness endpoint is healthy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });

    await expect(
      waitForApiReady({ fetchImpl, attempts: 1 })
    ).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/ready'),
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
      })
    );
  });

  it('retries transient readiness failures', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true });

    await expect(
      waitForApiReady({ fetchImpl, attempts: 2, retryDelayMs: 0 })
    ).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops after the configured number of attempts', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network error'));

    await expect(
      waitForApiReady({
        fetchImpl,
        attempts: API_READINESS_MAX_ATTEMPTS,
        retryDelayMs: 0,
      })
    ).resolves.toBe(false);

    expect(fetchImpl).toHaveBeenCalledTimes(API_READINESS_MAX_ATTEMPTS);
  });
});
