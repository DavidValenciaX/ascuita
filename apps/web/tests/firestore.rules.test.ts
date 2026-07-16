import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..', '..', '..');
const firestoreRules = readFileSync(
  path.join(repositoryRoot, 'firestore.rules'),
  'utf8'
);

let testEnvironment: RulesTestEnvironment;

function memoryReference(uid: string, memoryId = 'memory-aaaaaaaa-bbbbbbbb') {
  return doc(
    testEnvironment.authenticatedContext(uid).firestore(),
    'users',
    uid,
    'memories',
    memoryId
  );
}

function validMemory() {
  const timestamp = Timestamp.fromMillis(1_700_000_000_000);
  return {
    content: 'Prefiere respuestas breves',
    category: 'preference',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('Firestore memory rules', () => {
  beforeAll(async () => {
    testEnvironment = await initializeTestEnvironment({
      projectId: 'ascuita-rules-test',
      firestore: {
        host: '127.0.0.1',
        port: 8080,
        rules: firestoreRules,
      },
    });
  });

  afterEach(async () => {
    await testEnvironment.clearFirestore();
  });

  afterAll(async () => {
    await testEnvironment.cleanup();
  });

  it('allows an authenticated user to create, read, update, and delete own memories', async () => {
    const reference = memoryReference('user-a');
    await assertSucceeds(setDoc(reference, validMemory()));
    await assertSucceeds(getDoc(reference));

    await assertSucceeds(
      setDoc(reference, {
        ...validMemory(),
        content: 'Prefiere respuestas breves y directas',
        updatedAt: Timestamp.fromMillis(1_700_000_000_001),
      })
    );
    await assertSucceeds(deleteDoc(reference));
  });

  it('denies anonymous and cross-user access', async () => {
    const ownReference = memoryReference('user-a');
    await assertSucceeds(setDoc(ownReference, validMemory()));

    const otherReference = doc(
      testEnvironment.authenticatedContext('user-b').firestore(),
      'users',
      'user-a',
      'memories',
      'memory-aaaaaaaa-bbbbbbbb'
    );
    await assertFails(getDoc(otherReference));
    await assertFails(deleteDoc(otherReference));

    const anonymousReference = doc(
      testEnvironment.unauthenticatedContext().firestore(),
      'users',
      'user-a',
      'memories',
      'memory-aaaaaaaa-bbbbbbbb'
    );
    await assertFails(getDoc(anonymousReference));
  });

  it('rejects invalid memory documents', async () => {
    const reference = memoryReference('user-a');
    const valid = validMemory();

    await assertFails(
      setDoc(memoryReference('user-a', 'invalid-id'), valid)
    );
    await assertFails(
      setDoc(reference, {
        ...valid,
        category: 'health',
      })
    );
    await assertFails(
      setDoc(reference, {
        ...valid,
        extraField: true,
      })
    );
    await assertFails(
      setDoc(reference, {
        ...valid,
        content: 'a'.repeat(501),
      })
    );
  });

  it('does not allow changing the original creation timestamp', async () => {
    const reference = memoryReference('user-a');
    await assertSucceeds(setDoc(reference, validMemory()));

    await assertFails(
      setDoc(reference, {
        ...validMemory(),
        createdAt: Timestamp.fromMillis(1_700_000_000_002),
        updatedAt: Timestamp.fromMillis(1_700_000_000_003),
      })
    );
  });

  it('allows an optional source agent identifier within its limit', async () => {
    await assertSucceeds(
      setDoc(memoryReference('user-a'), {
        ...validMemory(),
        sourceAgentId: 'custom-agent',
      })
    );
    await assertFails(
      setDoc(memoryReference('user-a', 'memory-cccccccc-dddddddd'), {
        ...validMemory(),
        sourceAgentId: 'a'.repeat(129),
      })
    );
  });
});
