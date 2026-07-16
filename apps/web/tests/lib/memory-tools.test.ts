import { describe, expect, it } from 'vitest';
import { createMemoryToolDeclarations } from '@/lib/memory-tools';
import { MEMORY_CATEGORIES } from '@/lib/memories';

describe('createMemoryToolDeclarations', () => {
  it('exposes save and forget tools with constrained arguments', () => {
    const declarations = createMemoryToolDeclarations();
    const saveTool = declarations.find(tool => tool.name === 'save_user_memory');
    const forgetTool = declarations.find(
      tool => tool.name === 'forget_user_memory'
    );

    expect(saveTool).toBeDefined();
    expect(forgetTool).toBeDefined();

    if (!saveTool || !forgetTool) {
      throw new Error('Expected memory tool declarations');
    }

    const saveParameters = saveTool.parameters;
    const forgetParameters = forgetTool.parameters;
    if (!saveParameters || !forgetParameters) {
      throw new Error('Expected memory tool parameters');
    }

    expect(saveParameters.required).toEqual(['content', 'category']);

    const categoryProperty = saveParameters.properties?.category;
    if (!categoryProperty) {
      throw new Error('Expected a category property on the save tool');
    }

    expect(categoryProperty.enum).toEqual(MEMORY_CATEGORIES);
    expect(forgetParameters.required).toEqual(['memoryId']);
  });
});
