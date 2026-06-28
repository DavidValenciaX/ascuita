import { useCallback, useEffect, useRef } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useAuthGate, useUser } from '@/lib/state';

export type FirebaseAuthProfileSnapshot = {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  providers: string[];
  emailVerified: boolean;
  creationTime: string;
  lastSignInTime: string;
};

export type UserProfileUpdates = {
  name?: string;
  info?: string;
};

async function saveUserDocument(
  uid: string,
  updates: Record<string, unknown>
) {
  const userDocRef = doc(db, 'users', uid);
  const payload: Record<string, unknown> = {
    ...updates,
    updatedAt: serverTimestamp(),
  };

  const existing = await getDoc(userDocRef);
  if (!existing.exists()) {
    payload.createdAt = serverTimestamp();
  }

  await setDoc(userDocRef, payload, { merge: true });
}

function buildFirebaseAuthProfile(user: FirebaseUser): FirebaseAuthProfileSnapshot {
  const providers = Array.from(
    new Set(
      user.providerData
        .map(provider => provider?.providerId)
        .filter((providerId): providerId is string => Boolean(providerId))
    )
  );

  return {
    uid: user.uid,
    displayName: user.displayName || '',
    email: user.email || '',
    photoURL: user.photoURL || '',
    providers,
    emailVerified: user.emailVerified,
    creationTime: user.metadata.creationTime || '',
    lastSignInTime: user.metadata.lastSignInTime || '',
  };
}

export async function saveUserProfile(updates: UserProfileUpdates) {
  if (!auth.currentUser) return;

  await saveUserDocument(auth.currentUser.uid, updates);
}

export async function syncAuthenticatedUserProfile(user: FirebaseUser) {
  const authProfile = buildFirebaseAuthProfile(user);
  await saveUserDocument(user.uid, { authProfile });
}

export function useUserProfile() {
  const { isAuthenticated, authReady } = useAuthGate();
  const {
    name,
    info,
    setName,
    setInfo,
    setPhotoURL,
    setEmail,
    setAuthDisplayName,
    setAuthProviders,
    setEmailVerified,
  } = useUser();
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (!authReady || !isAuthenticated || !auth.currentUser) {
      setName('');
      setInfo('');
      setPhotoURL('');
      setEmail('');
      setAuthDisplayName('');
      setAuthProviders([]);
      setEmailVerified(false);
      return;
    }

    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, 'users', uid);

    const unsubscribe = onSnapshot(
      userDocRef,
      snapshot => {
        const data = snapshot.data();
        const authProfile = data?.authProfile as
          | Partial<FirebaseAuthProfileSnapshot>
          | undefined;
        if (data) {
          setName(data.name || '');
          setInfo(data.info || '');
        } else {
          setName('');
          setInfo('');
        }
        setPhotoURL(authProfile?.photoURL || auth.currentUser?.photoURL || '');
        setEmail(authProfile?.email || auth.currentUser?.email || '');
        setAuthDisplayName(
          authProfile?.displayName || auth.currentUser?.displayName || ''
        );
        setAuthProviders(
          authProfile?.providers ||
            auth.currentUser?.providerData
              .map(provider => provider?.providerId)
              .filter((providerId): providerId is string => Boolean(providerId)) ||
            []
        );
        setEmailVerified(
          authProfile?.emailVerified ?? auth.currentUser?.emailVerified ?? false
        );
      },
      error => {
        console.error('Error listening to user profile:', error);
      }
    );

    unsubscribeRef.current = unsubscribe;

    return () => {
      unsubscribe();
      unsubscribeRef.current = null;
    };
  }, [
    authReady,
    isAuthenticated,
    setAuthDisplayName,
    setAuthProviders,
    setEmail,
    setEmailVerified,
    setInfo,
    setName,
    setPhotoURL,
  ]);

  const saveProfile = useCallback(
    async (updates: UserProfileUpdates) => {
      await saveUserProfile(updates);
    },
    []
  );

  return { name, info, saveProfile };
}
