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
const httpRequestRate = new Map<string, { count: number; resetAt: number }>();

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

function isRateLimited(ip: string) {
  const now = Date.now();
  const key = getClientKey(ip);
  const existing = httpRequestRate.get(key);

  if (!existing || existing.resetAt <= now) {
    httpRequestRate.set(key, {
      count: 1,
      resetAt: now + config.httpRateLimitWindowMs,
    });
    return false;
  }

  if (existing.count >= config.httpRateLimitMaxRequests) {
    return true;
  }

  existing.count += 1;
  return false;
}

function logSecurityEvent(
  ip: string,
  reason: string,
  metadata?: Record<string, unknown>
) {
  appendAbuseLog(
    path.resolve(process.cwd(), config.securityLogDir),
    config.securityLogRetentionDays,
    {
      type: 'http.rate_limit',
      ip,
      reason,
      metadata,
    }
  );
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

  if (isRateLimited(request.ip)) {
    logSecurityEvent(request.ip, 'too_many_http_requests', {
      path: request.url,
      method: request.method,
    });
    return reply.status(429).send({
      ok: false,
      error: 'Too many requests',
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
        securityLogDestination: isRunningInCloudRun()
          ? 'cloud-logging'
          : path.resolve(process.cwd(), config.securityLogDir),
        securityLogRetentionDays: config.securityLogRetentionDays,
      },
      'Ascuita API started'
    );
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start Ascuita API');
    process.exit(1);
  }
};

await start();
