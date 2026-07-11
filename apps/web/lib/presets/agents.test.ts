import { describe, it, expect } from 'vitest';
import {
  getAgentColorName,
  createNewAgent,
  AGENT_COLORS,
  Ascuita,
} from './agents';

describe('getAgentColorName', () => {
  it('returns the English name for a known color', () => {
    expect(getAgentColorName('#4285f4', 'en')).toBe('blue');
  });

  it('returns the Spanish name for a known color', () => {
    expect(getAgentColorName('#4285f4', 'es')).toBe('azul');
  });

  it('is case-insensitive', () => {
    expect(getAgentColorName('#4285F4', 'en')).toBe('blue');
  });

  it('returns the raw hex for an unknown color', () => {
    expect(getAgentColorName('#abcdef', 'en')).toBe('#abcdef');
  });

  it('defaults to English when no language is specified', () => {
    expect(getAgentColorName('#ea4335')).toBe('red');
  });
});

describe('createNewAgent', () => {
  it('creates an agent with default random values', () => {
    const agent = createNewAgent();
    expect(agent.id).toBeTruthy();
    expect(agent.name).toBe('');
    expect(agent.personality).toBe('');
    expect(AGENT_COLORS).toContain(agent.bodyColor);
    expect(['Charon', 'Aoede']).toContain(agent.voice);
  });

  it('merges provided properties over the defaults', () => {
    const agent = createNewAgent({
      name: 'TestBot',
      personality: 'A test bot',
      bodyColor: '#ff0000',
    });
    expect(agent.name).toBe('TestBot');
    expect(agent.personality).toBe('A test bot');
    expect(agent.bodyColor).toBe('#ff0000');
    expect(agent.id).toBeTruthy();
  });

  it('allows overriding id and voice', () => {
    const agent = createNewAgent({ id: 'custom-id', voice: 'Kore' });
    expect(agent.id).toBe('custom-id');
    expect(agent.voice).toBe('Kore');
  });
});

describe('Ascuita preset', () => {
  it('has the expected default properties', () => {
    expect(Ascuita.id).toBe('default-agent');
    expect(Ascuita.name).toBe('Ascuita');
    expect(Ascuita.isPreset).toBe(true);
    expect(Ascuita.voice).toBe('Aoede');
    expect(Ascuita.bodyColor).toBe('#4285f4');
  });
});
