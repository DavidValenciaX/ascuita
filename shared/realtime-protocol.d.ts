/** Public, provider-independent contract. This file contains no runtime code. */
export type RealtimeProvider = 'gemini' | 'qwen';

export type ToolSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  properties?: Record<string, ToolSchema>;
  required?: string[];
  enum?: string[];
  items?: ToolSchema;
  additionalProperties?: boolean;
  minLength?: number;
  maxLength?: number;
};

export type ToolDefinition = { name: string; description?: string; parameters?: ToolSchema };
export type ConversationTurn = { role: 'user' | 'assistant'; text: string };
export type ResumeState = {
  provider: RealtimeProvider;
  model: string;
  agentId: string;
  conversationId?: string;
  handle: string;
};

export type RealtimeConfig = {
  instructions: string;
  voice?: string;
  tools?: ToolDefinition[];
  webSearch?: boolean;
};

export type RealtimeSessionInfo = {
  provider: RealtimeProvider;
  model: string;
  voice: { mode: 'agent' | 'fixed'; name?: string };
  audio: { inputSampleRate: 16000; outputSampleRate: 24000; format: 'pcm_s16le'; channels: 1 };
  capabilities: { tools: boolean; webSearch: boolean; nativeResumption: boolean };
};

export type RealtimeToolCall = { callId: string; name: string; args: Record<string, unknown> };
export type RealtimeToolResult = { callId: string; name: string; result: unknown };
export type GroundingResult = {
  summary: string;
  sources: Array<{ title: string; url: string }>;
  searchEntryPoint?: { renderedContent: string };
  groundingMetadata?: Record<string, unknown>;
};

export type RealtimeClientMessage =
  | { type: 'connect'; payload: {
      config: RealtimeConfig;
      authToken?: string | null;
      agentId?: string;
      agentName?: string;
      conversationId?: string;
      history?: ConversationTurn[];
      resume?: ResumeState;
    } }
  | { type: 'audio'; payload: { data: string } }
  | { type: 'text'; payload: { text: string; turnComplete?: boolean; persist?: boolean } }
  | { type: 'tool.results'; payload: { results: RealtimeToolResult[] } }
  | { type: 'disconnect' }
  | { type: 'ping' };

export type RealtimeServerMessage =
  | { type: 'connection.ready'; payload: RealtimeSessionInfo }
  | { type: 'session.ready'; payload: RealtimeSessionInfo & { resumed: boolean } }
  | { type: 'audio'; payload: { data: string; responseId: string } }
  | { type: 'transcript.delta' | 'transcript.final'; payload: ConversationTurn & { turnId: string } }
  | { type: 'tool.call'; payload: { calls: RealtimeToolCall[] } }
  | { type: 'tool.cancelled'; payload: { callIds: string[] } }
  | { type: 'interrupted'; payload: { responseId?: string } }
  | { type: 'turn.complete'; payload: { responseId: string } }
  | { type: 'session.resumption'; payload: ResumeState }
  | { type: 'sources'; payload: GroundingResult }
  | { type: 'usage'; payload: Record<string, unknown> }
  | { type: 'error'; payload: { code: string; message: string; fatal: boolean } }
  | { type: 'close'; payload: { reason: string } }
  | { type: 'pong' };
