import { Type, type FunctionDeclaration } from '@google/genai';
import { MEMORY_CATEGORIES } from './memories';

export function createMemoryToolDeclarations(): FunctionDeclaration[] {
  return [
    {
      name: 'save_user_memory',
      description:
        'Saves a concise, durable, non-sensitive fact about the user for future conversations. Only call this when the user has clearly shared something useful to remember.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          content: {
            type: Type.STRING,
            description:
              'A concise statement of the durable fact or preference, without secrets or sensitive personal data.',
          },
          category: {
            type: Type.STRING,
            description: 'The type of memory being saved.',
            enum: [...MEMORY_CATEGORIES],
          },
        },
        required: ['content', 'category'],
      },
    },
    {
      name: 'forget_user_memory',
      description:
        'Deletes an existing user memory only after the user explicitly asks to forget or correct it.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          memoryId: {
            type: Type.STRING,
            description:
              'The internal memory identifier from the persistent memory context.',
          },
        },
        required: ['memoryId'],
      },
    },
  ];
}
