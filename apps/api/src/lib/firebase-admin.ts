import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function getPrivateKey() {
  return process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
}

function hasFirebaseAdminEnv() {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      getPrivateKey()
  );
}

function hasGoogleRuntimeCredentials() {
  return Boolean(
    process.env.K_SERVICE ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
}

function getFirebaseAdminApp() {
  if (getApps().length) {
    return getApps()[0];
  }

  if (hasFirebaseAdminEnv()) {
    return initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: getPrivateKey(),
      }),
    });
  }

  if (hasGoogleRuntimeCredentials()) {
    return initializeApp({
      credential: applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
    });
  }

  return null;
}

export function isFirebaseAdminConfigured() {
  return hasFirebaseAdminEnv() || hasGoogleRuntimeCredentials();
}

export async function verifyFirebaseIdToken(idToken?: string | null) {
  if (!idToken) {
    return null;
  }

  const app = getFirebaseAdminApp();
  if (!app) {
    return null;
  }

  return getAuth(app).verifyIdToken(idToken);
}

export function getAdminDb() {
  const app = getFirebaseAdminApp();
  if (!app) {
    return null;
  }
  return getFirestore(app);
}

export async function deleteFirebaseUserData(uid: string) {
  const db = getAdminDb();
  if (!db) {
    throw new Error('Firebase Admin is not configured');
  }

  await db.recursiveDelete(db.collection('users').doc(uid));
}

export async function deleteFirebaseUserAccount(uid: string) {
  const app = getFirebaseAdminApp();
  if (!app) {
    throw new Error('Firebase Admin is not configured');
  }

  try {
    await getAuth(app).deleteUser(uid);
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'auth/user-not-found'
    ) {
      throw error;
    }
  }
}
