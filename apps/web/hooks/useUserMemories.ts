import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useAuthGate } from '@/lib/state';
import {
  createMemoryId,
  isMemoryId,
  MAX_MEMORIES_PER_USER,
  type MemoryInput,
  type UserMemory,
  validateMemoryInput,
} from '@/lib/memories';

type MemoryOperationResult =
  | {
      success: true;
      memoryId?: string;
      updated?: boolean;
      deleted?: boolean;
      count?: number;
    }
  | {
      success: false;
      error: string;
      code?: string;
    };

function getUserMemoriesCollection(uid: string) {
  return collection(db, 'users', uid, 'memories');
}

function getUserMemoryRef(uid: string, memoryId: string) {
  return doc(db, 'users', uid, 'memories', memoryId);
}

function mapMemory(
  memoryId: string,
  data: Record<string, unknown>
): UserMemory | null {
  const validation = validateMemoryInput(data);
  if (!validation.valid) return null;

  return {
    id: memoryId,
    content: validation.value.content,
    category: validation.value.category,
    createdAt:
      typeof data.createdAt === 'object' &&
      data.createdAt !== null &&
      'toMillis' in data.createdAt &&
      typeof data.createdAt.toMillis === 'function'
        ? data.createdAt.toMillis()
        : 0,
    updatedAt:
      typeof data.updatedAt === 'object' &&
      data.updatedAt !== null &&
      'toMillis' in data.updatedAt &&
      typeof data.updatedAt.toMillis === 'function'
        ? data.updatedAt.toMillis()
        : 0,
    ...(validation.value.sourceAgentId
      ? { sourceAgentId: validation.value.sourceAgentId }
      : {}),
  };
}

export async function saveUserMemory(
  input: MemoryInput
): Promise<MemoryOperationResult> {
  const validation = validateMemoryInput(input);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      code: validation.code,
    };
  }

  const user = auth.currentUser;
  if (!user) {
    return {
      success: false,
      error: 'Authentication is required to save memories',
      code: 'AUTH_REQUIRED',
    };
  }

  try {
    const userRef = doc(db, 'users', user.uid);
    const userSnapshot = await getDoc(userRef);
    const memoryEnabled =
      userSnapshot.data()?.memorySettings?.enabled === true;

    if (!memoryEnabled) {
      return {
        success: false,
        error: 'Automatic memory saving is disabled',
        code: 'MEMORY_DISABLED',
      };
    }

    const memoryId = createMemoryId(validation.value);
    const memoryRef = getUserMemoryRef(user.uid, memoryId);
    const existing = await getDoc(memoryRef);

    if (!existing.exists()) {
      const existingMemories = await getDocs(
        query(getUserMemoriesCollection(user.uid), limit(MAX_MEMORIES_PER_USER))
      );
      if (existingMemories.size >= MAX_MEMORIES_PER_USER) {
        return {
          success: false,
          error: 'The memory limit for this account has been reached',
          code: 'MEMORY_LIMIT_REACHED',
        };
      }
    }

    await setDoc(
      memoryRef,
      {
        content: validation.value.content,
        category: validation.value.category,
        updatedAt: serverTimestamp(),
        ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
        ...(validation.value.sourceAgentId
          ? { sourceAgentId: validation.value.sourceAgentId }
          : {}),
      },
      { merge: true }
    );

    return {
      success: true,
      memoryId,
      updated: existing.exists(),
    };
  } catch {
    return {
      success: false,
      error: 'The memory could not be saved',
      code: 'PERSISTENCE_ERROR',
    };
  }
}

export async function deleteUserMemory(
  memoryId: string
): Promise<MemoryOperationResult> {
  if (!isMemoryId(memoryId)) {
    return {
      success: false,
      error: 'The memory identifier is invalid',
      code: 'INVALID_MEMORY_ID',
    };
  }

  const user = auth.currentUser;
  if (!user) {
    return {
      success: false,
      error: 'Authentication is required to delete memories',
      code: 'AUTH_REQUIRED',
    };
  }

  try {
    await deleteDoc(getUserMemoryRef(user.uid, memoryId));
    return { success: true, memoryId, deleted: true };
  } catch {
    return {
      success: false,
      error: 'The memory could not be deleted',
      code: 'PERSISTENCE_ERROR',
    };
  }
}

export async function clearUserMemories(): Promise<MemoryOperationResult> {
  const user = auth.currentUser;
  if (!user) {
    return {
      success: false,
      error: 'Authentication is required to delete memories',
      code: 'AUTH_REQUIRED',
    };
  }

  try {
    const snapshot = await getDocs(getUserMemoriesCollection(user.uid));
    let deletedCount = 0;

    for (let start = 0; start < snapshot.docs.length; start += 450) {
      const batch = writeBatch(db);
      const docs = snapshot.docs.slice(start, start + 450);
      for (const memoryDocument of docs) {
        batch.delete(memoryDocument.ref);
      }
      await batch.commit();
      deletedCount += docs.length;
    }

    return { success: true, count: deletedCount };
  } catch {
    return {
      success: false,
      error: 'The memories could not be deleted',
      code: 'PERSISTENCE_ERROR',
    };
  }
}

export async function setUserMemoryEnabled(
  enabled: boolean
): Promise<MemoryOperationResult> {
  const user = auth.currentUser;
  if (!user) {
    return {
      success: false,
      error: 'Authentication is required to change memory settings',
      code: 'AUTH_REQUIRED',
    };
  }

  try {
    await setDoc(
      doc(db, 'users', user.uid),
      {
        memorySettings: { enabled },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return { success: true };
  } catch {
    return {
      success: false,
      error: 'The memory setting could not be changed',
      code: 'PERSISTENCE_ERROR',
    };
  }
}

export function useUserMemories() {
  const { isAuthenticated, authReady } = useAuthGate();
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const unsubscribeRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    for (const unsubscribe of unsubscribeRef.current) {
      unsubscribe();
    }
    unsubscribeRef.current = [];

    if (!authReady || !isAuthenticated || !auth.currentUser) {
      setMemories([]);
      setMemoryEnabled(false);
      setLoading(false);
      return;
    }

    const uid = auth.currentUser.uid;
    setLoading(true);

    const memoriesQuery = query(
      getUserMemoriesCollection(uid),
      orderBy('updatedAt', 'desc'),
      limit(MAX_MEMORIES_PER_USER)
    );
    const unsubscribeMemories = onSnapshot(
      memoriesQuery,
      snapshot => {
        const nextMemories = snapshot.docs
          .map(memoryDocument =>
            mapMemory(memoryDocument.id, memoryDocument.data())
          )
          .filter((memory): memory is UserMemory => memory !== null);
        setMemories(nextMemories);
        setLoading(false);
      },
      error => {
        console.error('Error loading user memories:', error);
        setMemories([]);
        setLoading(false);
      }
    );

    const unsubscribeUser = onSnapshot(
      doc(db, 'users', uid),
      snapshot => {
        setMemoryEnabled(snapshot.data()?.memorySettings?.enabled === true);
      },
      error => {
        console.error('Error loading memory settings:', error);
      }
    );

    unsubscribeRef.current = [unsubscribeMemories, unsubscribeUser];

    return () => {
      unsubscribeMemories();
      unsubscribeUser();
      unsubscribeRef.current = [];
    };
  }, [authReady, isAuthenticated]);

  const saveMemory = useCallback(
    (input: MemoryInput) => saveUserMemory(input),
    []
  );
  const deleteMemory = useCallback(
    (memoryId: string) => deleteUserMemory(memoryId),
    []
  );
  const clearMemories = useCallback(() => clearUserMemories(), []);
  const updateMemoryEnabled = useCallback(async (enabled: boolean) => {
    const result = await setUserMemoryEnabled(enabled);
    if (result.success) {
      setMemoryEnabled(enabled);
    }
    return result;
  }, []);

  return {
    memories,
    memoryEnabled,
    loading,
    saveMemory,
    deleteMemory,
    clearMemories,
    setMemoryEnabled: updateMemoryEnabled,
  };
}
