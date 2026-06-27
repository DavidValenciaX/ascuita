import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
  getDocs,
  limit,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useAuthGate } from '@/lib/state';

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
};

export type Conversation = {
  id: string;
  agentId: string;
  agentName: string;
  startedAt: number;
  endedAt: number | null;
  messageCount: number;
};

export function useConversations() {
  const { isAuthenticated, authReady } = useAuthGate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (!authReady || !isAuthenticated || !auth.currentUser) {
      setConversations([]);
      return;
    }

    const uid = auth.currentUser.uid;
    const conversationsRef = collection(
      db,
      'users',
      uid,
      'conversations'
    );
    const q = query(conversationsRef, orderBy('startedAt', 'desc'), limit(50));

    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        const list: Conversation[] = snapshot.docs.map(docSnap => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            agentId: data.agentId || '',
            agentName: data.agentName || '',
            startedAt: data.startedAt?.toMillis?.() || 0,
            endedAt: data.endedAt?.toMillis?.() || null,
            messageCount: data.messageCount || 0,
          };
        });
        setConversations(list);
      },
      error => {
        console.error('Error loading conversations:', error);
      }
    );

    unsubscribeRef.current = unsubscribe;

    return () => {
      unsubscribe();
      unsubscribeRef.current = null;
    };
  }, [authReady, isAuthenticated]);

  const createConversation = useCallback(
    async (agentId: string, agentName: string) => {
      if (!auth.currentUser) return null;

      const uid = auth.currentUser.uid;
      const conversationsRef = collection(db, 'users', uid, 'conversations');

      const docRef = await addDoc(conversationsRef, {
        agentId,
        agentName,
        startedAt: serverTimestamp(),
        endedAt: null,
        messageCount: 0,
      });

      return docRef.id;
    },
    []
  );

  const endConversation = useCallback(
    async (conversationId: string) => {
      if (!auth.currentUser) return;

      const uid = auth.currentUser.uid;
      const convRef = doc(db, 'users', uid, 'conversations', conversationId);

      await setDoc(
        convRef,
        { endedAt: serverTimestamp() },
        { merge: true }
      );
    },
    []
  );

  const loadMessages = useCallback(
    async (conversationId: string): Promise<ConversationMessage[]> => {
      if (!auth.currentUser) return [];

      const uid = auth.currentUser.uid;
      const messagesRef = collection(
        db,
        'users',
        uid,
        'conversations',
        conversationId,
        'messages'
      );
      const q = query(messagesRef, orderBy('timestamp', 'asc'));
      const snapshot = await getDocs(q);

      return snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          role: data.role || 'user',
          text: data.text || '',
          timestamp: data.timestamp?.toMillis?.() || 0,
        };
      });
    },
    []
  );

  return {
    conversations,
    createConversation,
    endConversation,
    loadMessages,
  };
}
