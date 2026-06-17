import { FastifyPluginAsync } from 'fastify';

const healthRoute: FastifyPluginAsync = async fastify => {
  fastify.get('/health', async () => {
    return {
      ok: true,
      service: 'ascuita-api',
      timestamp: new Date().toISOString(),
    };
  });
};

export default healthRoute;
