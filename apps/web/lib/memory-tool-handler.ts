import type { MemoryInput } from './memories';

type MemoryOperation = (
  input: MemoryInput
) => Promise<unknown>;

type ForgetOperation = (memoryId: string) => Promise<unknown>;

export type MemoryToolHandlerOptions = {
  isAuthenticated: boolean;
  memoryEnabled: boolean;
  sourceAgentId: string;
  saveMemory: MemoryOperation;
  deleteMemory: ForgetOperation;
};

export type MemoryToolResult = {
  name: 'save_user_memory' | 'forget_user_memory';
  result: unknown;
};

export async function executeMemoryToolCall(
  name: string | undefined,
  args: Record<string, unknown> | undefined,
  options: MemoryToolHandlerOptions
): Promise<MemoryToolResult | null> {
  if (name === 'save_user_memory') {
    const result =
      options.isAuthenticated && options.memoryEnabled
        ? await options.saveMemory({
            ...(args || {}),
            sourceAgentId: options.sourceAgentId,
          } as MemoryInput)
        : {
            success: false,
            error: 'Memory saving is not available for this session',
            code: 'MEMORY_UNAVAILABLE',
          };

    return { name, result };
  }

  if (name === 'forget_user_memory') {
    const memoryId =
      typeof args?.memoryId === 'string' ? args.memoryId : '';
    const result =
      options.isAuthenticated && options.memoryEnabled
        ? await options.deleteMemory(memoryId)
        : {
            success: false,
            error: 'Memory management is not available for this session',
            code: 'MEMORY_UNAVAILABLE',
          };

    return { name, result };
  }

  return null;
}
