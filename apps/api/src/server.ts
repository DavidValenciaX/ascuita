import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, isAllowedOrigin, isRunningInCloudRun } from './config.js';
import { appendAbuseLog } from './lib/abuse-log.js';
import { isFirebaseAdminConfigured } from './lib/firebase-admin.js';
import { RedisUnavailableError, securityState } from './lib/security-state.js';
import accountRoute from './routes/account.js';
import healthRoute from './routes/health.js';
import liveRoute from './routes/live.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(moduleDir, '..');
const repoRootDir = path.resolve(apiDir, '..', '..');

const envCandidates = Array.from(
  new Set([
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), '.env'),
    path.join(apiDir, '.env.local'),
    path.join(apiDir, '.env'),
    path.join(repoRootDir, '.env.local'),
    path.join(repoRootDir, '.env'),
  ])
);

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

const config = getConfig();

function getClientKey(ip: string) {
  return ip || 'unknown';
}

function securityHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'cross-origin-resource-policy': 'same-site',
    'permissions-policy': 'microphone=(self)',
    'cache-control': 'no-store',
  };
}

function logSecurityEvent(
  ip: string,
  reason: string,
  metadata?: Record<string, unknown>
) {
  appendAbuseLog({
    type: 'http.rate_limit',
    ip,
    reason,
    metadata,
  });
}

const app = Fastify({
  logger: {
    level: config.logLevel,
  },
  trustProxy: true,
});

await app.register(cors, {
  origin: (origin, callback) => {
    if (isAllowedOrigin(config.corsOrigin, origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin not allowed: ${origin}`), false);
  },
  credentials: true,
});

app.addHook('onRequest', async (request, reply) => {
  reply.headers(securityHeaders());

  try {
    const rateState = await securityState.incrementCounter(
      'http',
      getClientKey(request.ip),
      config.httpRateLimitWindowMs
    );

    if (rateState.count > config.httpRateLimitMaxRequests) {
      logSecurityEvent(request.ip, 'too_many_http_requests', {
        path: request.url,
        method: request.method,
      });
      return reply.status(429).send({
        ok: false,
        error: 'Too many requests',
      });
    }
  } catch (error) {
    if (!(error instanceof RedisUnavailableError)) {
      request.log.error({ err: error }, 'Security state store failed');
    }
    return reply.status(503).send({
      ok: false,
      error: 'Security state store unavailable',
    });
  }
});

await app.register(websocket);
await app.register(accountRoute);
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
    await securityState.connect();

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
        firebaseAdminConfigured: isFirebaseAdminConfigured(),
        cloudRun: isRunningInCloudRun(),
        securityStateBackend: securityState.backend,
        securityLogDestination: 'stdout',
      },
      'Ascuita API started'
    );
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start Ascuita API');
    process.exit(1);
  }
};

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down Ascuita API');
  try {
    await app.close();
    await securityState.close();
  } catch (error) {
    app.log.error({ err: error }, 'Failed to shut down Ascuita API cleanly');
    process.exitCode = 1;
  }
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await start();
