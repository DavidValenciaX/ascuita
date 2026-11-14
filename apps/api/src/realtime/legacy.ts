import type { RealtimeConfig, RealtimeToolResult, ToolSchema } from '../../../../shared/realtime-protocol.js';
import { isRecord } from './validation.js';

function schema(value: unknown): ToolSchema | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return;
  const type = value.type.toLowerCase() as ToolSchema['type'];
  return {
    ...(value as ToolSchema), type,
    ...(isRecord(value.properties) ? { properties: Object.fromEntries(Object.entries(value.properties).flatMap(([key, item]) => {
      const result = schema(item);
      return result ? [[key, result]] : [];
    })) } : {}),
    ...(value.items ? { items: schema(value.items) } : {}),
  };
}

export function legacyConfigToRealtime(value: Record<string, unknown>): RealtimeConfig {
  const instruction = value.systemInstruction;
  const parts = isRecord(instruction) && Array.isArray(instruction.parts) ? instruction.parts : [];
  const speech = isRecord(value.speechConfig) ? value.speechConfig : {};
  const voice = isRecord(speech.voiceConfig) ? speech.voiceConfig : {};
  const prebuilt = isRecord(voice.prebuiltVoiceConfig) ? voice.prebuiltVoiceConfig : {};
  const tools = Array.isArray(value.tools) ? value.tools.filter(isRecord) : [];
  return {
    instructions: typeof instruction === 'string' ? instruction : parts.filter(isRecord).map(part => part.text || '').join(''),
    voice: typeof prebuilt.voiceName === 'string' ? prebuilt.voiceName : 'Aoede',
    webSearch: tools.some(tool => 'googleSearch' in tool),
    tools: tools.flatMap(tool => Array.isArray(tool.functionDeclarations) ? tool.functionDeclarations.filter(isRecord).map(fn => ({
      name: String(fn.name || ''), description: typeof fn.description === 'string' ? fn.description : undefined,
      parameters: schema(fn.parameters ?? fn.parametersJsonSchema),
    })) : []),
  };
}

export function legacyToolResults(value: { functionResponses?: Array<{ id?: string; name?: string; response?: Record<string, unknown> }> }, preserveResponse = false): RealtimeToolResult[] {
  return (value.functionResponses ?? []).map(result => ({
    callId: result.id || '', name: result.name || '', result: preserveResponse ? result.response ?? {} : result.response?.result ?? result.response ?? {},
  }));
}
