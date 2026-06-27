import { useCallback, useEffect, useRef } from 'react';
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useAuthGate, useUser } from '@/lib/state';

export type UserProfileUpdates = {
  name?: string;
  info?: string;
};

export async function saveUserProfile(updates: UserProfileUpdates) {
  if (!auth.currentUser) return;

  const uid = auth.currentUser.uid;
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

export function useUserProfile() {
  const { isAuthenticated, authReady } = useAuthGate();
  const { name, info, setName, setInfo } = useUser();
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (!authReady || !isAuthenticated || !auth.currentUser) {
      setName('');
      setInfo('');
      return;
    }

    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, 'users', uid);

    const unsubscribe = onSnapshot(
      userDocRef,
      snapshot => {
        const data = snapshot.data();
        if (data) {
          setName(data.name || '');
          setInfo(data.info || '');
        }
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
  }, [authReady, isAuthenticated, setName, setInfo]);

  const saveProfile = useCallback(
    async (updates: UserProfileUpdates) => {
      await saveUserProfile(updates);
    },
    []
  );

  return { name, info, saveProfile };
}
