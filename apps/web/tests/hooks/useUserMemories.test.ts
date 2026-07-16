import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  collection: vi.fn((...parts: string[]) => parts.join('/')),
  deleteDoc: vi.fn(),
  doc: vi.fn((...parts: string[]) => parts.join('/')),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  setDoc: vi.fn(),
  writeBatch: vi.fn(),
}));

const firebaseMock = vi.hoisted(() => ({
  auth: {
    currentUser: null as { uid: string } | null,
  },
  db: {},
}));

vi.mock('firebase/firestore', () => firestoreMocks);
vi.mock('../../firebase', () => firebaseMock);

import {
  deleteUserMemory,
  saveUserMemory,
} from '@/hooks/useUserMemories';

describe('user memory persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseMock.auth.currentUser = null;
  });

  it('does not write for an unauthenticated user', async () => {
    const result = await saveUserMemory({
      content: 'Prefiere respuestas breves',
      category: 'preference',
    });

    expect(result).toMatchObject({
      success: false,
      code: 'AUTH_REQUIRED',
    });
    expect(firestoreMocks.setDoc).not.toHaveBeenCalled();
  });

  it('rejects invalid input before touching Firestore', async () => {
    firebaseMock.auth.currentUser = { uid: 'user-a' };

    const result = await saveUserMemory({
      content: 'My password is secret',
      category: 'context',
    });

    expect(result).toMatchObject({
      success: false,
      code: 'SENSITIVE_CONTENT',
    });
    expect(firestoreMocks.getDoc).not.toHaveBeenCalled();
    expect(firestoreMocks.setDoc).not.toHaveBeenCalled();
  });

  it('saves a validated memory for an authenticated user when enabled', async () => {
    firebaseMock.auth.currentUser = { uid: 'user-a' };
    firestoreMocks.getDoc
      .mockResolvedValueOnce({
        data: () => ({ memorySettings: { enabled: true } }),
      })
      .mockResolvedValueOnce({
        exists: () => false,
      });
    firestoreMocks.getDocs.mockResolvedValueOnce({ size: 0 });

    const result = await saveUserMemory({
      content: '  Prefiere respuestas   breves ',
      category: 'preference',
      sourceAgentId: 'companion',
    });

    expect(result).toMatchObject({
      success: true,
      updated: false,
    });
    expect(firestoreMocks.setDoc).toHaveBeenCalledWith(
      expect.stringContaining('users/user-a/memories/memory-'),
      expect.objectContaining({
        content: 'Prefiere respuestas breves',
        category: 'preference',
        sourceAgentId: 'companion',
      }),
      { merge: true }
    );
  });

  it('does not save when the user disabled automatic memories', async () => {
    firebaseMock.auth.currentUser = { uid: 'user-a' };
    firestoreMocks.getDoc.mockResolvedValueOnce({
      data: () => ({ memorySettings: { enabled: false } }),
    });

    const result = await saveUserMemory({
      content: 'Prefiere respuestas breves',
      category: 'preference',
    });

    expect(result).toMatchObject({
      success: false,
      code: 'MEMORY_DISABLED',
    });
    expect(firestoreMocks.setDoc).not.toHaveBeenCalled();
  });

  it('keeps automatic memories enabled when the setting is missing', async () => {
    firebaseMock.auth.currentUser = { uid: 'user-a' };
    firestoreMocks.getDoc
      .mockResolvedValueOnce({
        data: () => ({}),
      })
      .mockResolvedValueOnce({
        exists: () => false,
      });
    firestoreMocks.getDocs.mockResolvedValueOnce({ size: 0 });

    const result = await saveUserMemory({
      content: 'Prefiere respuestas breves',
      category: 'preference',
    });

    expect(result).toMatchObject({
      success: true,
      updated: false,
    });
    expect(firestoreMocks.setDoc).toHaveBeenCalled();
  });

  it('validates memory identifiers before deletion', async () => {
    firebaseMock.auth.currentUser = { uid: 'user-a' };

    const result = await deleteUserMemory('not-a-memory-id');

    expect(result).toMatchObject({
      success: false,
      code: 'INVALID_MEMORY_ID',
    });
    expect(firestoreMocks.deleteDoc).not.toHaveBeenCalled();
  });
});
