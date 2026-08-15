import { FastifyPluginAsync } from 'fastify';

export type ReadinessCheck = {
  name: string;
  ready: boolean;
};

export type HealthRouteOptions = {
  isServing?: () => boolean;
  checkReadiness?: () => Promise<ReadinessCheck[]>;
};

const healthRoute: FastifyPluginAsync<HealthRouteOptions> = async (
  fastify,
  options
) => {
  const isServing = options.isServing ?? (() => true);
  const checkReadiness =
    options.checkReadiness ??
    (async () => [{ name: 'api', ready: true }]);

  fastify.get('/health', async () => {
    return {
      ok: true,
      service: 'ascuita-api',
      timestamp: new Date().toISOString(),
    };
  });

  fastify.get('/ready', async (request, reply) => {
    let checks: ReadinessCheck[];
    try {
      checks = await checkReadiness();
    } catch (error) {
      request.log.warn({ err: error }, 'Readiness check failed');
      checks = [{ name: 'api', ready: false }];
    }

    const allChecksReady = checks.every(check => check.ready);
    const ready = isServing() && allChecksReady;

    return reply.status(ready ? 200 : 503).send({
      ok: ready,
      ready,
      service: 'ascuita-api',
      checks: Object.fromEntries(
        checks.map(check => [check.name, check.ready])
      ),
      timestamp: new Date().toISOString(),
    });
  });
};

export default healthRoute;
