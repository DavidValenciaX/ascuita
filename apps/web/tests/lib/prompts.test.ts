import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createSystemInstructions } from '@/lib/prompts';
import type { Agent } from '@/lib/presets/agents';
import type { User } from '@/lib/state';

const customAgent: Agent = {
  id: 'custom-1',
  name: 'TestBot',
  personality: 'A friendly test bot.',
  bodyColor: '#ea4335',
  voice: 'Charon',
};

const presetAgent: Agent = {
  id: 'default-agent',
  name: 'Ascuita',
  isPreset: true,
  personality: 'A warm companion.',
  bodyColor: '#4285f4',
  voice: 'Aoede',
};

describe('createSystemInstructions', () => {
  beforeAll(() => {
    vi.stubGlobal('navigator', { languages: ['en-US'] });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('uses Spanish phrases when language is "es"', () => {
    const result = createSystemInstructions(customAgent, {}, 'es');
    expect(result).toContain('Tu nombre es TestBot');
  });

  it('uses English phrases when language is "en"', () => {
    const result = createSystemInstructions(customAgent, {}, 'en');
    expect(result).toContain('Your name is TestBot');
  });

  it('includes tool instructions for custom agents', () => {
    const result = createSystemInstructions(customAgent, {}, 'en');
    expect(result).toContain('set_agent_name');
    expect(result).toContain('set_agent_personality');
    expect(result).toContain('set_agent_color');
  });

  it('excludes tool instructions for preset agents', () => {
    const result = createSystemInstructions(presetAgent, {}, 'en');
    expect(result).not.toContain('set_agent_name');
    expect(result).not.toContain('set_agent_personality');
    expect(result).not.toContain('set_agent_color');
  });

  it('includes the user name when provided', () => {
    const user: User = { name: 'Alice' };
    const result = createSystemInstructions(customAgent, user, 'en');
    expect(result).toContain('(Alice)');
  });

  it('includes the user info section when provided', () => {
    const user: User = { name: 'Alice', info: 'Loves cats.' };
    const result = createSystemInstructions(customAgent, user, 'en');
    expect(result).toContain('Here is some information about Alice');
    expect(result).toContain('Loves cats.');
  });

  it('excludes the user info section when not provided', () => {
    const result = createSystemInstructions(customAgent, {}, 'en');
    expect(result).not.toContain('Here is some information about');
  });

  it('includes the localized avatar color name', () => {
    const result = createSystemInstructions(customAgent, {}, 'es');
    expect(result).toContain('rojo');
  });

  it('instructs the model to converse in the selected language', () => {
    const esResult = createSystemInstructions(customAgent, {}, 'es');
    expect(esResult).toContain('converse in Spanish');
    const enResult = createSystemInstructions(customAgent, {}, 'en');
    expect(enResult).toContain('converse in English');
  });
});
