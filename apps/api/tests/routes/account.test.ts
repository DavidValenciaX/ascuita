import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import accountRoute from '../../src/routes/account.js';

const firebaseMocks = vi.hoisted(() => ({
  isFirebaseAdminConfigured: vi.fn(),
  verifyFirebaseIdToken: vi.fn(),
  deleteFirebaseUserData: vi.fn(),
  deleteFirebaseUserAccount: vi.fn(),
}));

vi.mock('../../src/lib/firebase-admin.js', () => firebaseMocks);

describe('accountRoute', () => {
  let app: ReturnType<typeof Fastify> | undefined;

  beforeEach(() => {
    firebaseMocks.isFirebaseAdminConfigured.mockReturnValue(true);
    firebaseMocks.verifyFirebaseIdToken.mockResolvedValue({ uid: 'user-123' });
    firebaseMocks.deleteFirebaseUserData.mockResolvedValue(undefined);
    firebaseMocks.deleteFirebaseUserAccount.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    vi.clearAllMocks();
  });

  it('requires a bearer token', async () => {
    app = Fastify();
    await app.register(accountRoute);

    const response = await app.inject({
      method: 'DELETE',
      url: '/account',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      ok: false,
      error: 'Authentication is required',
    });
  });

  it('rejects invalid tokens', async () => {
    firebaseMocks.verifyFirebaseIdToken.mockRejectedValue(
      new Error('invalid token')
    );
    app = Fastify();
    await app.register(accountRoute);

    const response = await app.inject({
      method: 'DELETE',
      url: '/account',
      headers: {
        authorization: 'Bearer invalid-token',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(firebaseMocks.deleteFirebaseUserData).not.toHaveBeenCalled();
  });

  it('deletes user data and the Firebase account', async () => {
    app = Fastify();
    await app.register(accountRoute);

    const response = await app.inject({
      method: 'DELETE',
      url: '/account',
      headers: {
        authorization: 'Bearer valid-token',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      deleted: true,
    });
    expect(firebaseMocks.verifyFirebaseIdToken).toHaveBeenCalledWith(
      'valid-token'
    );
    expect(firebaseMocks.deleteFirebaseUserData).toHaveBeenCalledWith(
      'user-123'
    );
    expect(firebaseMocks.deleteFirebaseUserAccount).toHaveBeenCalledWith(
      'user-123'
    );
  });

  it('returns an error when deletion fails', async () => {
    firebaseMocks.deleteFirebaseUserData.mockRejectedValue(
      new Error('firestore unavailable')
    );
    app = Fastify();
    await app.register(accountRoute);

    const response = await app.inject({
      method: 'DELETE',
      url: '/account',
      headers: {
        authorization: 'Bearer valid-token',
      },
    });

    expect(response.statusCode).toBe(500);
    expect(firebaseMocks.deleteFirebaseUserAccount).not.toHaveBeenCalled();
  });
});
