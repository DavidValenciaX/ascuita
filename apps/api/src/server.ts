import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { getConfig } from './config.js';
import healthRoute from './routes/health.js';
import liveRoute from './routes/live.js';

const config = getConfig();

const app = Fastify({
  logger: {
    level: config.logLevel,
  },
});

await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || config.corsOrigin.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin not allowed: ${origin}`), false);
  },
  credentials: true,
});

await app.register(websocket);
await app.register(healthRoute);
await app.register(liveRoute);

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'Unhandled request error');

  reply.status(500).send({
    ok: false,
    error: 'Internal server error',
  });
});

const start = async () => {
  try {
    await app.listen({
      host: config.host,
      port: config.port,
    });

    app.log.info(
      {
        host: config.host,
        port: config.port,
        corsOrigin: config.corsOrigin,
        geminiConfigured: Boolean(config.geminiApiKey),
        geminiModel: config.geminiModel,
      },
      'Ascuita API started'
    );
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start Ascuita API');
    process.exit(1);
  }
};

await start();
