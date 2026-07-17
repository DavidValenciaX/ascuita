import { FastifyPluginAsync } from 'fastify';
import {
  deleteFirebaseUserAccount,
  deleteFirebaseUserData,
  isFirebaseAdminConfigured,
  verifyFirebaseIdToken,
} from '../lib/firebase-admin.js';

function getBearerToken(authorization?: string) {
  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

const accountRoute: FastifyPluginAsync = async fastify => {
  fastify.delete('/account', async (request, reply) => {
    if (!isFirebaseAdminConfigured()) {
      return reply.status(503).send({
        ok: false,
        error: 'Account deletion is unavailable',
      });
    }

    const token = getBearerToken(request.headers.authorization);
    if (!token) {
      return reply.status(401).send({
        ok: false,
        error: 'Authentication is required',
      });
    }

    let decodedToken;
    try {
      decodedToken = await verifyFirebaseIdToken(token);
    } catch {
      return reply.status(401).send({
        ok: false,
        error: 'Invalid authentication token',
      });
    }

    if (!decodedToken) {
      return reply.status(401).send({
        ok: false,
        error: 'Invalid authentication token',
      });
    }

    try {
      await deleteFirebaseUserData(decodedToken.uid);
      await deleteFirebaseUserAccount(decodedToken.uid);
    } catch (error) {
      request.log.error({ err: error, uid: decodedToken.uid }, 'Account deletion failed');
      return reply.status(500).send({
        ok: false,
        error: 'Account deletion failed',
      });
    }

    return {
      ok: true,
      deleted: true,
    };
  });
};

export default accountRoute;
