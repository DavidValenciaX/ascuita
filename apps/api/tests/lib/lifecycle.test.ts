import { describe, expect, it } from 'vitest';
import { ServerLifecycle } from '../../src/lib/lifecycle.js';

describe('ServerLifecycle', () => {
  it('starts unavailable and becomes ready only after startup completes', () => {
    const lifecycle = new ServerLifecycle();

    expect(lifecycle.state).toBe('starting');
    expect(lifecycle.isReady()).toBe(false);

    lifecycle.markReady();

    expect(lifecycle.state).toBe('ready');
    expect(lifecycle.isReady()).toBe(true);
  });

  it('stops advertising readiness while draining and remains idempotent', () => {
    const lifecycle = new ServerLifecycle();
    lifecycle.markReady();

    lifecycle.beginShutdown();
    lifecycle.beginShutdown();

    expect(lifecycle.state).toBe('draining');
    expect(lifecycle.isReady()).toBe(false);

    lifecycle.markStopped();
    lifecycle.beginShutdown();
    expect(lifecycle.state).toBe('stopped');
  });
});
