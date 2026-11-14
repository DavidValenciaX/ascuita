import type { RealtimeClientMessage, RealtimeConfig, ToolSchema } from '../../../../shared/realtime-protocol.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSchema(value: unknown, depth = 0): value is ToolSchema {
  if (depth > 8 || !isRecord(value) || !['object', 'array', 'string', 'number', 'integer', 'boolean'].includes(String(value.type))) return false;
  if (value.properties !== undefined && (!isRecord(value.properties) || !Object.values(value.properties).every(item => isSchema(item, depth + 1)))) return false;
  if (value.items !== undefined && !isSchema(value.items, depth + 1)) return false;
  if (value.required !== undefined && (!Array.isArray(value.required) || !value.required.every(item => typeof item === 'string'))) return false;
  if (value.enum !== undefined && (!Array.isArray(value.enum) || !value.enum.every(item => typeof item === 'string'))) return false;
  if (value.additionalProperties !== undefined && typeof value.additionalProperties !== 'boolean') return false;
  for (const key of ['minLength', 'maxLength']) {
    if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isInteger(value[key]) || Number(value[key]) < 0)) return false;
  }
  return true;
}

export function isRealtimeConfig(value: unknown): value is RealtimeConfig {
  if (!isRecord(value) || typeof value.instructions !== 'string') return false;
  if (value.voice !== undefined && typeof value.voice !== 'string') return false;
  if (value.webSearch !== undefined && typeof value.webSearch !== 'boolean') return false;
  return value.tools === undefined || (Array.isArray(value.tools) && value.tools.length <= 64 && value.tools.every(tool =>
    isRecord(tool) && typeof tool.name === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(tool.name)
    && (tool.description === undefined || typeof tool.description === 'string')
    && (tool.parameters === undefined || isSchema(tool.parameters))));
}

export function parseClientMessage(value: unknown): RealtimeClientMessage {
  if (!isRecord(value)) throw new Error('Invalid realtime message');
  if (value.type === 'disconnect' || value.type === 'ping') return { type: value.type };
  const payload = value.payload;
  if (!isRecord(payload)) throw new Error('Invalid realtime payload');
  if (value.type === 'connect') {
    if (!isRealtimeConfig(payload.config) || 'provider' in payload || 'model' in payload) throw new Error('Invalid realtime configuration');
    for (const key of ['agentId', 'agentName', 'conversationId']) {
      if (payload[key] !== undefined && typeof payload[key] !== 'string') throw new Error('Invalid session identity');
    }
    if (payload.authToken !== undefined && payload.authToken !== null && typeof payload.authToken !== 'string') throw new Error('Invalid auth token');
    if (payload.history !== undefined && (!Array.isArray(payload.history) || !payload.history.every(turn => isRecord(turn)
      && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string'))) throw new Error('Invalid conversation history');
    if (payload.resume !== undefined && (!isRecord(payload.resume) || payload.resume.provider !== 'gemini'
      || !['model', 'agentId', 'handle'].every(key => typeof (payload.resume as Record<string, unknown>)[key] === 'string')
      || (payload.resume.conversationId !== undefined && typeof payload.resume.conversationId !== 'string'))) throw new Error('Invalid resume state');
  } else if (value.type === 'audio') {
    if (typeof payload.data !== 'string' || !payload.data.length || payload.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.data)) throw new Error('Invalid PCM audio');
    const bytes = Buffer.from(payload.data, 'base64');
    if (!bytes.length || bytes.length % 2 || bytes.toString('base64') !== payload.data) throw new Error('Invalid PCM audio');
  } else if (value.type === 'text') {
    if (typeof payload.text !== 'string' || !['persist', 'turnComplete'].every(key => payload[key] === undefined || typeof payload[key] === 'boolean')) throw new Error('Invalid text input');
  } else if (value.type === 'tool.results') {
    if (!Array.isArray(payload.results) || !payload.results.every(result => isRecord(result)
      && typeof result.callId === 'string' && typeof result.name === 'string' && 'result' in result)) throw new Error('Invalid tool results');
  } else throw new Error('Unknown realtime message');
  return value as RealtimeClientMessage;
}

export function validArguments(value: unknown, schema?: ToolSchema): boolean {
  if (!schema) return isRecord(value);
  if (schema.type === 'object') {
    if (!isRecord(value) || schema.required?.some(key => !(key in value))) return false;
    return Object.entries(value).every(([key, item]) => {
      const property = schema.properties?.[key];
      return property ? validArguments(item, property) : schema.additionalProperties !== false;
    });
  }
  if (schema.type === 'array') return Array.isArray(value) && (!schema.items || value.every(item => validArguments(item, schema.items)));
  if (schema.type === 'string') return typeof value === 'string' && (!schema.enum || schema.enum.includes(value))
    && (schema.minLength === undefined || value.length >= schema.minLength) && (schema.maxLength === undefined || value.length <= schema.maxLength);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isInteger(value));
}
