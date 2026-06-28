import { useCallback, useEffect, useRef } from 'react';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  serverTimestamp,
  query,
  orderBy,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useAuthGate, useAgent } from '@/lib/state';
import type { Agent } from '@/lib/presets/agents';

export async function saveUserAgent(agent: Agent) {
  if (!auth.currentUser) return;
  if (!agent.name.trim() || !agent.personality.trim()) return;

  const uid = auth.currentUser.uid;
  const agentRef = doc(db, 'users', uid, 'agents', agent.id);

  await setDoc(
    agentRef,
    {
      name: agent.name,
      personality: agent.personality,
      bodyColor: agent.bodyColor,
      voice: agent.voice,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function deleteUserAgent(agentId: string) {
  if (!auth.currentUser) return;

  const uid = auth.currentUser.uid;
  const agentRef = doc(db, 'users', uid, 'agents', agentId);
  await deleteDoc(agentRef);
}

export function useUserAgents() {
  const { isAuthenticated, authReady } = useAuthGate();
  const setPersonalAgents = useAgent(state => state.setPersonalAgents);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!authReady || !isAuthenticated || !auth.currentUser) {
      setPersonalAgents([]);
      loadedRef.current = false;
      return;
    }

    if (loadedRef.current) return;
    loadedRef.current = true;

    const uid = auth.currentUser.uid;
    const agentsRef = collection(db, 'users', uid, 'agents');
    const q = query(agentsRef, orderBy('updatedAt', 'desc'));

    getDocs(q)
      .then(snapshot => {
        const agents: Agent[] = snapshot.docs.map(docSnap => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            name: data.name || '',
            personality: data.personality || '',
            bodyColor: data.bodyColor || '#4285f4',
            voice: data.voice || 'Aoede',
          };
        });
        setPersonalAgents(agents);
      })
      .catch(error => {
        console.error('Error loading user agents:', error);
      });
  }, [authReady, isAuthenticated, setPersonalAgents]);

  const saveAgent = useCallback(async (agent: Agent) => {
    await saveUserAgent(agent);
  }, []);

  const removeAgent = useCallback(async (agentId: string) => {
    await deleteUserAgent(agentId);
  }, []);

  return { saveAgent, removeAgent };
}
