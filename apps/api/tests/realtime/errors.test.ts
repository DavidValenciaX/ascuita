import { describe, expect, it } from 'vitest';
import { getProviderError, RealtimeProviderError } from '../../src/realtime/errors.js';

describe('provider retry classification', () => {
  it.each([
    [new Error('socket hang up'), false],
    [new Error('Qwen session setup timed out'), false],
    [{ status: 503, message: 'Service unavailable' }, false],
    [{ status: 429, message: 'Too many requests' }, false],
    [{ type: 'server_error', message: 'Upstream unavailable' }, false],
    [new Error('Unexpected server response: 401'), true],
    [{ status: 403, message: 'Access denied' }, true],
    [{ status: 1008, message: 'Policy violation' }, true],
    [{ type: 'invalid_request_error', message: 'Unsupported setting' }, true],
    [{ error: { code: 'invalid_api_key', message: 'Authentication failed' } }, true],
    [new Error('Your prepayment credits are depleted'), true],
  ])('classifies %j as fatal=%s', (error, fatal) => {
    expect(getProviderError(error).fatal).toBe(fatal);
  });

  it('preserves explicit classification instead of changing it at the route boundary', () => {
    const failure = new RealtimeProviderError('Expired resume handle', { code: 'RESUMPTION_REJECTED', fatal: false });
    expect(getProviderError(failure, 'PROVIDER_CONNECT_FAILED')).toBe(failure);
    expect(getProviderError(Object.assign(new Error('Temporary failure'), { fatal: false }), 'PROVIDER_CONNECT_FAILED'))
      .toMatchObject({ code: 'PROVIDER_CONNECT_FAILED', fatal: false, message: 'Temporary failure' });
  });
});
