import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendAbuseLog } from '../../src/lib/abuse-log.js';

describe('appendAbuseLog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses the current timestamp when the event does not include one', () => {
    const now = Date.UTC(2026, 6, 11, 18, 30, 0);

    vi.useFakeTimers();
    vi.setSystemTime(now);

    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    appendAbuseLog({
      type: 'http.rate_limit',
      ip: '8.8.8.8',
      reason: 'burst_detected',
    });

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy.mock.calls[0]?.[0]).toContain(`"ts":${now}`);
  });

  it('writes structured security events to stdout', () => {
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    appendAbuseLog({
      type: 'security.block',
      ip: '9.9.9.9',
      reason: 'too_many_messages',
      metadata: { count: 4 },
      ts: 123,
    });

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy.mock.calls[0]?.[0]).toContain('"loggingEvent":"ascuita.security"');
    expect(writeSpy.mock.calls[0]?.[0]).toContain('"reason":"too_many_messages"');
    expect(writeSpy.mock.calls[0]?.[0]).toContain('"severity":"WARNING"');
  });
});
