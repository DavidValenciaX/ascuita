import { describe, expect, it, vi } from 'vitest';
import { executeMemoryToolCall } from '@/lib/memory-tool-handler';

describe('executeMemoryToolCall', () => {
  it('does not persist memory for guests or disabled sessions', async () => {
    const saveMemory = vi.fn();
    const deleteMemory = vi.fn();

    const result = await executeMemoryToolCall(
      'save_user_memory',
      { content: 'Le gusta el café', category: 'preference' },
      {
        isAuthenticated: false,
        memoryEnabled: true,
        sourceAgentId: 'ascuita',
        saveMemory,
        deleteMemory,
      }
    );

    expect(result?.result).toMatchObject({
      success: false,
      code: 'MEMORY_UNAVAILABLE',
    });
    expect(saveMemory).not.toHaveBeenCalled();
    expect(deleteMemory).not.toHaveBeenCalled();
  });

  it('forwards authenticated save calls with the source agent', async () => {
    const saveMemory = vi.fn().mockResolvedValue({
      success: true,
      memoryId: 'memory-aaaaaaaa-bbbbbbbb',
    });
    const deleteMemory = vi.fn();

    const result = await executeMemoryToolCall(
      'save_user_memory',
      { content: 'Le gusta el café', category: 'preference' },
      {
        isAuthenticated: true,
        memoryEnabled: true,
        sourceAgentId: 'custom-agent',
        saveMemory,
        deleteMemory,
      }
    );

    expect(result).toMatchObject({ name: 'save_user_memory', result: { success: true } });
    expect(saveMemory).toHaveBeenCalledWith({
      content: 'Le gusta el café',
      category: 'preference',
      sourceAgentId: 'custom-agent',
    });
  });

  it('forwards forget calls with the requested memory id', async () => {
    const saveMemory = vi.fn();
    const deleteMemory = vi.fn().mockResolvedValue({
      success: true,
      deleted: true,
    });

    await executeMemoryToolCall(
      'forget_user_memory',
      { memoryId: 'memory-aaaaaaaa-bbbbbbbb' },
      {
        isAuthenticated: true,
        memoryEnabled: true,
        sourceAgentId: 'ascuita',
        saveMemory,
        deleteMemory,
      }
    );

    expect(deleteMemory).toHaveBeenCalledWith('memory-aaaaaaaa-bbbbbbbb');
  });
});
