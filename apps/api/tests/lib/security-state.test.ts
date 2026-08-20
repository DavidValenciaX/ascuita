import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecurityStateStore } from '../../src/lib/security-state.js';

describe('SecurityStateStore memory backend', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('increments counters and applies independent windows', async () => {
    vi.useFakeTimers();
    const store = new SecurityStateStore({ redisUrl: '', redisRequired: false });

    await expect(store.incrementCounter('http', 'ip-a', 1000)).resolves.toMatchObject({
      count: 1,
    });
    await expect(store.incrementCounter('http', 'ip-a', 1000)).resolves.toMatchObject({
      count: 2,
    });
    await expect(store.incrementCounter('http', 'ip-b', 1000)).resolves.toMatchObject({
      count: 1,
    });
    await expect(store.incrementCounter('audio', 'ip-a', 1000, 50)).resolves.toMatchObject({
      count: 50,
    });

    vi.advanceTimersByTime(1001);
    await expect(store.incrementCounter('http', 'ip-a', 1000)).resolves.toMatchObject({
      count: 1,
    });
  });

  it('increments a batch of counters with independent amounts and windows', async () => {
    const store = new SecurityStateStore({ redisUrl: '', redisRequired: false });

    await expect(
      store.incrementCounterBatch([
        {
          scope: 'ws-message',
          clientKey: 'ip-a',
          windowMs: 60_000,
          amount: 8,
        },
        {
          scope: 'ws-audio',
          clientKey: 'ip-a',
          windowMs: 60_000,
          amount: 320,
        },
      ])
    ).resolves.toEqual([
      expect.objectContaining({ count: 8 }),
      expect.objectContaining({ count: 320 }),
    ]);

    await expect(
      store.incrementCounterBatch([
        {
          scope: 'ws-message',
          clientKey: 'ip-a',
          windowMs: 60_000,
          amount: 2,
        },
        {
          scope: 'ws-audio',
          clientKey: 'ip-a',
          windowMs: 60_000,
          amount: 80,
        },
      ])
    ).resolves.toEqual([
      expect.objectContaining({ count: 10 }),
      expect.objectContaining({ count: 400 }),
    ]);
  });

  it('reports the memory backend as ready when Redis is not required', async () => {
    const store = new SecurityStateStore({
      redisUrl: '',
      redisRequired: false,
    });

    await expect(store.checkReadiness()).resolves.toBe(true);
  });

  it('reports the memory backend as unavailable when Redis is required', async () => {
    const store = new SecurityStateStore({
      redisUrl: '',
      redisRequired: true,
    });

    await expect(store.checkReadiness()).resolves.toBe(false);
  });

  it('expires temporary blocks and retains guest trial start during retention', async () => {
    vi.useFakeTimers();
    const store = new SecurityStateStore({ redisUrl: '', redisRequired: false });

    await store.block('ip-a', 'too_many_messages', 1000);
    await expect(store.getBlock('ip-a')).resolves.toMatchObject({
      reason: 'too_many_messages',
    });

    const firstTrialStart = await store.getOrStartGuestTrial('ip-a', 5000);
    vi.advanceTimersByTime(1000);
    await expect(store.getOrStartGuestTrial('ip-a', 5000)).resolves.toBe(
      firstTrialStart
    );

    vi.advanceTimersByTime(4001);
    await expect(store.getBlock('ip-a')).resolves.toBeNull();
    await expect(store.getOrStartGuestTrial('ip-a', 5000)).resolves.toBe(
      Date.now()
    );
  });

  it('enforces, refreshes and releases connection leases', async () => {
    vi.useFakeTimers();
    const store = new SecurityStateStore({ redisUrl: '', redisRequired: false });

    const first = await store.acquireConnectionLease('ip-a', 1, 1000);
    expect(first).not.toBeNull();
    await expect(store.acquireConnectionLease('ip-a', 1, 1000)).resolves.toBeNull();

    vi.advanceTimersByTime(500);
    await expect(store.refreshConnectionLease(first!, 1000)).resolves.toBe(true);
    vi.advanceTimersByTime(600);
    await expect(store.acquireConnectionLease('ip-a', 1, 1000)).resolves.toBeNull();

    await store.releaseConnectionLease(first!);
    await expect(store.acquireConnectionLease('ip-a', 1, 1000)).resolves.not.toBeNull();
  });
});
