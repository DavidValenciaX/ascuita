import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

type ServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function getLocalServiceAccount(): ServiceAccount | null {
  if (process.env.K_SERVICE) {
    return null;
  }

  const configuredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const candidates = [
    configuredPath,
    path.resolve(process.cwd(), 'firebase_service_account.json'),
    path.resolve(process.cwd(), '..', 'firebase_service_account.json'),
    path.resolve(process.cwd(), '..', '..', 'firebase_service_account.json'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of new Set(candidates)) {
    if (!existsSync(candidate)) {
      continue;
    }

    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key,
        };
      }
    } catch {
      // Fall back to Application Default Credentials when the local file is invalid.
    }
  }

  return null;
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

  const localServiceAccount = getLocalServiceAccount();
  if (localServiceAccount) {
    return initializeApp({
      credential: cert(localServiceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || localServiceAccount.projectId,
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
  return Boolean(getLocalServiceAccount()) || hasGoogleRuntimeCredentials();
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
