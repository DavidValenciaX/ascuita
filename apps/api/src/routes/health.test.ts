import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import healthRoute from './health.js';

describe('healthRoute', () => {
  let app: ReturnType<typeof Fastify> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('returns service health metadata', async () => {
    app = Fastify();
    await app.register(healthRoute);

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    const payload = response.json();

    expect(response.statusCode).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.service).toBe('ascuita-api');
    expect(typeof payload.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
  });
});
