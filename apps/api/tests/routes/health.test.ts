import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import healthRoute from '../../src/routes/health.js';

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

  it('reports readiness when the service and its dependencies are ready', async () => {
    app = Fastify();
    await app.register(healthRoute, {
      isServing: () => true,
      checkReadiness: async () => [
        { name: 'securityState', ready: true },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      ready: true,
      checks: { securityState: true },
    });
  });

  it('returns 503 when a dependency is unavailable or the service is draining', async () => {
    app = Fastify();
    await app.register(healthRoute, {
      isServing: () => false,
      checkReadiness: async () => [
        { name: 'securityState', ready: false },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ok: false,
      ready: false,
      checks: { securityState: false },
    });
  });

  it('fails readiness safely when a check throws', async () => {
    app = Fastify();
    await app.register(healthRoute, {
      checkReadiness: async () => {
        throw new Error('dependency unavailable');
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ok: false,
      ready: false,
      checks: { api: false },
    });
  });
});
