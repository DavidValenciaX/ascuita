import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeServerMessage, ToolDefinition } from '../../../../shared/realtime-protocol.js';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  generate: vi.fn(),
  sockets: [] as Array<{
    url: URL; options: { headers: Record<string, string> }; readyState: number;
    sent: Array<Record<string, unknown>>; receive: (event: object) => void;
    fail: (error: Error) => void;
    close: () => void; terminate: () => void;
  }>,
}));
vi.mock('@google/genai', () => ({
  Modality: { AUDIO: 'AUDIO' },
  GoogleGenAI: class {
    live = { connect: mocks.connect };
    models = { generateContent: mocks.generate };
  },
}));
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  return { default: class extends EventEmitter {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 1;
    sent: Array<Record<string, unknown>> = [];
    constructor(readonly url: URL, readonly options: { headers: Record<string, string> }) { super(); mocks.sockets.push(this); }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    receive(event: object) { this.emit('message', Buffer.from(JSON.stringify(event))); }
    fail(error: Error) { this.emit('error', error); }
    close() { this.readyState = 3; this.emit('close', 1000, Buffer.from('closed')); }
    terminate() { this.close(); }
  } };
});

import { getConfig, realtimeSessionInfo } from '../../src/config.js';
import { GeminiRealtimeAdapter } from '../../src/realtime/gemini.js';
import { QwenRealtimeAdapter } from '../../src/realtime/qwen.js';
import { createRealtimeSession } from '../../src/realtime/factory.js';
import type { RealtimeSession } from '../../src/realtime/types.js';

const sessions: RealtimeSession[] = [];
const events: RealtimeServerMessage[] = [];
const onEvent = (event: RealtimeServerMessage) => events.push(event);
const memoryTool: ToolDefinition = {
  name: 'save_user_memory', parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
};
const settings = { agentId: 'agent', config: { instructions: 'Habla en español.', voice: 'Aoede', tools: [memoryTool], webSearch: true } };
const native = { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('GEMINI_API_KEY', 'gemini-test');
  vi.stubEnv('QWEN_API_KEY', 'qwen-test');
  vi.stubEnv('QWEN_WORKSPACE_ID', 'workspace-test');
  vi.stubEnv('GEMINI_MODEL', 'gemini-3.1-flash-live-preview');
  vi.stubEnv('REALTIME_PROVIDER', 'gemini');
  mocks.connect.mockResolvedValue(native);
  mocks.sockets.length = events.length = 0;
});
afterEach(() => {
  sessions.forEach(session => session.close());
  sessions.length = 0;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function gemini(legacyConfig?: object) {
  const adapter = new GeminiRealtimeAdapter('gemini-test', realtimeSessionInfo(getConfig(), 'gemini'), { onEvent }, legacyConfig);
  sessions.push(adapter);
  return adapter;
}
function handlers() {
  return mocks.connect.mock.calls[0][0].callbacks as { onopen: () => void; onmessage: (message: object) => void; onclose: (event: object) => void; onerror: (event: object) => void };
}
async function qwen() {
  const adapter = new QwenRealtimeAdapter('qwen-test', 'workspace-test', realtimeSessionInfo(getConfig(), 'qwen'), { onEvent });
  sessions.push(adapter);
  const connected = adapter.connect(settings);
  const socket = mocks.sockets.at(-1)!;
  socket.receive({ type: 'session.created' });
  socket.receive({ type: 'session.updated' });
  await connected;
  return { adapter, socket };
}

describe('Gemini adapter', () => {
  it('keeps an input transcript in one turn when model output arrives before its final fragment', async () => {
    await gemini().connect(settings);
    handlers().onmessage({ serverContent: { inputTranscription: { text: 'Me llamo ' } } });
    handlers().onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAAAAA==' } }] } } });
    handlers().onmessage({ serverContent: { outputTranscription: { text: 'Hola', finished: true }, turnComplete: true } });
    expect(events.filter(event => event.type === 'transcript.final' && event.payload.role === 'user')).toEqual([]);
    handlers().onmessage({ serverContent: { inputTranscription: { text: 'David', finished: true } } });
    const finals = events.filter(event => event.type === 'transcript.final').filter(event => event.payload.role === 'user');
    expect(finals).toEqual([{ type: 'transcript.final', payload: expect.objectContaining({ text: 'Me llamo David' }) }]);
    const ids = events.filter(event => event.type === 'transcript.delta').filter(event => event.payload.role === 'user').map(event => event.payload.turnId);
    expect(new Set(ids).size).toBe(1);
    expect(finals[0].payload.turnId).toBe(ids[0]);
  });

  it.each([
    ['socket hang up', false],
    ['API key not valid. Please pass a valid API key.', true],
  ])('classifies Gemini errors: %s', async (message, fatal) => {
    await gemini().connect(settings);
    handlers().onerror({ message });
    expect(events).toContainEqual({ type: 'error', payload: { code: 'PROVIDER_ERROR', message, fatal } });
  });
  it('invalidates a rejected native handle even when Gemini only sends a close event', async () => {
    const adapter = gemini();
    await adapter.connect({ ...settings, resume: { provider: 'gemini', model: adapter.info.model, agentId: settings.agentId, handle: 'expired' } });
    handlers().onclose({ code: 1008, reason: 'Invalid session resumption handle' });
    expect(events).toContainEqual({ type: 'error', payload: {
      code: 'RESUMPTION_REJECTED', message: 'Invalid session resumption handle', fatal: false,
    } });
    expect(events.at(-1)?.type).toBe('close');
  });
  it('does not carry fallback text from an already finalized reply into the next turn', async () => {
    await gemini().connect(settings);
    handlers().onmessage({ serverContent: { outputTranscription: { text: 'First', finished: true } } });
    handlers().onmessage({ serverContent: { modelTurn: { parts: [{ text: 'First' }] }, turnComplete: true } });
    handlers().onmessage({ serverContent: { modelTurn: { parts: [{ text: 'Second' }] }, turnComplete: true } });
    expect(events.filter(event => event.type === 'transcript.final').map(event => event.payload.text)).toEqual(['First', 'Second']);
  });

  it('preserves the legacy open signal and exact function result envelope', async () => {
    const onLegacyOpen = vi.fn();
    const adapter = new GeminiRealtimeAdapter('key', realtimeSessionInfo(getConfig()), { onEvent, onLegacyOpen }, {});
    sessions.push(adapter);
    await adapter.connect(settings);
    handlers().onopen();
    expect(onLegacyOpen).toHaveBeenCalledOnce();
    handlers().onmessage({ toolCall: { functionCalls: [{ id: 'old-call', name: memoryTool.name, args: { content: 'Coffee' } }] } });
    await adapter.sendToolResults([{ callId: 'old-call', name: memoryTool.name, result: { success: true, memory: 'Coffee' } }]);
    expect(native.sendToolResponse).toHaveBeenCalledWith({ functionResponses: [{ id: 'old-call', name: memoryTool.name, response: { success: true, memory: 'Coffee' } }] });
    await adapter.sendText('Hola');
    expect(native.sendClientContent).toHaveBeenCalledWith({ turns: [{ role: 'user', parts: [{ text: 'Hola' }] }], turnComplete: true });
  });
  it('normalizes every part of a combined envelope without duplicating the final transcript', async () => {
    const adapter = gemini();
    await adapter.connect(settings);
    handlers().onmessage({ setupComplete: {}, toolCall: { functionCalls: [{ id: 'call', name: memoryTool.name, args: { content: 'Coffee' } }] }, serverContent: {
      inputTranscription: { text: 'Hola', finished: true },
      outputTranscription: { text: 'Buenos días', finished: true },
      modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAAAAA==' } }, { text: 'Buenos días' }] },
      turnComplete: true,
    } });
    expect(events.map(event => event.type)).toEqual(expect.arrayContaining(['session.ready', 'tool.call', 'audio', 'transcript.final', 'turn.complete']));
    expect(events.filter(event => event.type === 'transcript.final').map(event => event.payload)).toEqual([
      expect.objectContaining({ role: 'user', text: 'Hola' }), expect.objectContaining({ role: 'assistant', text: 'Buenos días' }),
    ]);
  });

  it('keeps native resume handles scoped and does not repeat function calls or results', async () => {
    const adapter = gemini();
    await adapter.connect({ ...settings, resume: { provider: 'gemini', model: adapter.info.model, agentId: 'other-agent', handle: 'wrong-handle' } });
    expect(mocks.connect.mock.calls[0][0].config.sessionResumption).not.toHaveProperty('handle');
    const message = { toolCall: { functionCalls: [{ id: 'call', name: memoryTool.name, args: { content: 'Coffee' } }] } };
    handlers().onmessage(message);
    handlers().onmessage(message);
    expect(events.filter(event => event.type === 'tool.call')).toHaveLength(1);
    const results = [{ callId: 'call', name: memoryTool.name, result: { success: true } }];
    await adapter.sendToolResults(results);
    await adapter.sendToolResults(results);
    expect(native.sendToolResponse).toHaveBeenCalledOnce();
  });

  it('closes a late native connection after the browser has already disconnected', async () => {
    let complete!: (value: typeof native) => void;
    mocks.connect.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const adapter = gemini();
    const pending = adapter.connect(settings);
    adapter.close();
    handlers().onmessage({ setupComplete: {} });
    complete(native);
    await pending;
    expect(native.close).toHaveBeenCalledOnce();
    expect(events).toEqual([]);
  });

  it('retains legacy settings and strips only unsupported resumption fields', async () => {
    const adapter = gemini({ responseModalities: ['AUDIO'], sessionResumption: { handle: 'old', transparent: true } });
    await adapter.connect(settings);
    expect(mocks.connect.mock.calls[0][0].config).toMatchObject({ responseModalities: ['AUDIO'], sessionResumption: { handle: 'old' }, contextWindowCompression: { slidingWindow: {} } });
    expect(mocks.connect.mock.calls[0][0].config.sessionResumption).not.toHaveProperty('transparent');
  });
});

describe('Qwen adapter', () => {
  it('queues text until the entire tool response has finished and continues each call set only once', async () => {
    const { adapter, socket } = await qwen();
    socket.receive({ type: 'response.created', response: { id: 'R1' } });
    socket.receive({ type: 'response.function_call_arguments.done', response_id: 'R1', call_id: 'call', name: memoryTool.name, arguments: '{"content":"Coffee"}' });
    socket.receive({ type: 'response.done', response: { id: 'R1' } });
    await adapter.sendText('Update agent');
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(0);

    await adapter.sendToolResults([{ callId: 'call', name: memoryTool.name, result: {} }]);
    expect(socket.sent.filter(event => event.type === 'response.create')).toEqual([expect.not.objectContaining({ response: expect.anything() })]);
    socket.receive({ type: 'response.created', response: { id: 'continuation' } });
    await adapter.sendText('Second update');
    await adapter.sendToolResults([{ callId: 'call', name: memoryTool.name, result: {} }]);
    socket.receive({ type: 'response.done', response: { id: 'R1' } });
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(1);

    socket.receive({ type: 'response.done', response: { id: 'continuation' } });
    const requests = socket.sent.filter(event => event.type === 'response.create');
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ response: { instructions: expect.stringContaining('Update agent') } });
    socket.receive({ type: 'response.created', response: { id: 'R2' } });
    socket.receive({ type: 'response.done', response: { id: 'R2' } });
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(3);
    expect(socket.sent.at(-1)).toMatchObject({ response: { instructions: expect.stringContaining('Second update') } });
    expect(socket.sent.filter(event => event.type === 'conversation.item.create')).toHaveLength(1);
  });

  it('reserves a response slot before response.created acknowledges a text request', async () => {
    const { adapter, socket } = await qwen();
    await adapter.sendText('First');
    await adapter.sendText('Second');
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(1);
    socket.receive({ type: 'response.created', response: { id: 'first' } });
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(1);
    socket.receive({ type: 'response.done', response: { id: 'first' } });
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(2);
  });

  it('does not send queued text after the session closes', async () => {
    const { adapter, socket } = await qwen();
    socket.receive({ type: 'response.created', response: { id: 'active' } });
    await adapter.sendText('Queued text');
    adapter.close();
    socket.receive({ type: 'response.done', response: { id: 'active' } });
    await adapter.sendText('Late text');
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(0);
  });

  it('keeps the VAD response slot when speech interrupts an unacknowledged text request', async () => {
    const { adapter, socket } = await qwen();
    await adapter.sendText('First');
    await adapter.sendText('Queued text');
    socket.receive({ type: 'input_audio_buffer.speech_started' });
    socket.receive({ type: 'response.created', response: { id: 'late-text' } });
    socket.receive({ type: 'response.audio.delta', response_id: 'late-text', delta: 'AAAAAA==' });
    socket.receive({ type: 'response.done', response: { id: 'late-text', status: 'cancelled' } });
    expect(events.filter(event => event.type === 'audio')).toHaveLength(0);
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(1);
    socket.receive({ type: 'response.created', response: { id: 'voice' } });
    socket.receive({ type: 'response.done', response: { id: 'voice' } });
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(2);
  });

  it('bounds queued text while a provider response stalls', async () => {
    const { adapter, socket } = await qwen();
    socket.receive({ type: 'response.created', response: { id: 'active' } });
    for (let i = 0; i < 17; i++) await adapter.sendText('Queued text');
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', payload: expect.objectContaining({ code: 'PROVIDER_BUSY', fatal: false }) }));
    expect(socket.readyState).toBe(3);
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(0);
  });

  it('defers a late tool continuation while another response is active', async () => {
    const { adapter, socket } = await qwen();
    socket.receive({ type: 'response.created', response: { id: 'old' } });
    socket.receive({ type: 'response.function_call_arguments.done', response_id: 'old', call_id: 'call', name: memoryTool.name, arguments: '{"content":"Coffee"}' });
    socket.receive({ type: 'response.done', response: { id: 'old' } });
    socket.receive({ type: 'response.created', response: { id: 'new' } });
    await adapter.sendToolResults([{ callId: 'call', name: memoryTool.name, result: {} }]);
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(0);
    socket.receive({ type: 'response.done', response: { id: 'new' } });
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(1);
  });

  it('holds queued text through a voice interruption and discards the interrupted tool continuation', async () => {
    const { adapter, socket } = await qwen();
    socket.receive({ type: 'response.created', response: { id: 'old' } });
    socket.receive({ type: 'response.function_call_arguments.done', response_id: 'old', call_id: 'call', name: memoryTool.name, arguments: '{"content":"Coffee"}' });
    await adapter.sendText('Queued update');
    socket.receive({ type: 'input_audio_buffer.speech_started' });
    socket.receive({ type: 'response.done', response: { id: 'old', status: 'cancelled' } });
    socket.receive({ type: 'input_audio_buffer.speech_stopped' });
    await adapter.sendToolResults([{ callId: 'call', name: memoryTool.name, result: {} }]);
    expect(socket.sent.filter(event => event.type === 'response.create' || event.type === 'conversation.item.create')).toHaveLength(0);
    socket.receive({ type: 'response.created', response: { id: 'voice' } });
    socket.receive({ type: 'response.done', response: { id: 'voice' } });
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(1);
    expect(socket.sent.at(-1)).toMatchObject({ response: { instructions: expect.stringContaining('Queued update') } });
  });

  it.each([
    ['server_error', 'upstream_unavailable', false],
    ['invalid_request_error', 'invalid_api_key', true],
  ])('classifies Qwen errors: %s', async (type, code, fatal) => {
    const { socket } = await qwen();
    socket.receive({ type: 'error', error: { type, code, message: 'Provider failure' } });
    expect(events).toContainEqual({ type: 'error', payload: { code: 'PROVIDER_ERROR', message: 'Provider failure', fatal } });
    expect(socket.readyState).toBe(3);
  });

  it('reports a transport failure during setup as recoverable', async () => {
    const adapter = new QwenRealtimeAdapter('key', 'workspace', realtimeSessionInfo(getConfig(), 'qwen'), { onEvent });
    sessions.push(adapter);
    const pending = adapter.connect(settings);
    const rejected = expect(pending).rejects.toMatchObject({ fatal: false });
    mocks.sockets.at(-1)!.fail(new Error('socket hang up'));
    await rejected;
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', payload: expect.objectContaining({ fatal: false }) }));
  });
  it('normalizes audio and final transcriptions and deduplicates the done events', async () => {
    const { adapter, socket } = await qwen();
    await adapter.sendAudio('AAAAAA==');
    expect(socket.sent.at(-1)).toMatchObject({ type: 'input_audio_buffer.append', audio: 'AAAAAA==' });
    socket.receive({ type: 'response.created', response: { id: 'spoken' } });
    socket.receive({ type: 'response.audio.delta', response_id: 'spoken', delta: 'AAAAAA==' });
    socket.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'input', transcript: 'Hola' });
    socket.receive({ type: 'response.audio_transcript.delta', response_id: 'spoken', delta: 'Buenos días' });
    socket.receive({ type: 'response.audio_transcript.done', response_id: 'spoken', transcript: 'Buenos días' });
    socket.receive({ type: 'response.done', response: { id: 'spoken' } });
    socket.receive({ type: 'response.done', response: { id: 'spoken' } });
    expect(events.filter(event => event.type === 'transcript.final').map(event => event.payload)).toEqual([
      { role: 'user', text: 'Hola', turnId: 'user:input' }, { role: 'assistant', text: 'Buenos días', turnId: 'assistant:spoken' },
    ]);
    expect(events.filter(event => event.type === 'audio')).toHaveLength(1);
    expect(events.filter(event => event.type === 'turn.complete')).toHaveLength(1);
  });

  it('reports failed responses and closes the provider without failing over', async () => {
    const { socket } = await qwen();
    socket.receive({ type: 'response.done', response: { id: 'failed', status: 'failed' } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', payload: expect.objectContaining({ code: 'PROVIDER_ERROR' }) }));
    expect(socket.readyState).toBe(3);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it('configures the Singapore workspace and waits until configuration is accepted', async () => {
    const adapter = new QwenRealtimeAdapter('secret', 'workspace-test', realtimeSessionInfo(getConfig(), 'qwen'), { onEvent });
    sessions.push(adapter);
    const promise = adapter.connect(settings);
    const socket = mocks.sockets.at(-1)!;
    expect(socket.url.hostname).toBe('workspace-test.ap-southeast-1.maas.aliyuncs.com');
    expect(socket.options.headers.Authorization).toBe('Bearer secret');
    socket.receive({ type: 'session.created' });
    expect(events).toEqual([]);
    expect(socket.sent[0]).toMatchObject({ type: 'session.update', session: {
      enable_search: false, modalities: ['text', 'audio'],
      audio: { input: { format: { sample_rate: 16000, channels: 1 } }, output: { voice: 'Tina', format: { sample_rate: 24000 } } },
      input_audio_transcription: { model: 'qwen3-asr-flash-realtime' }, tools: [{ type: 'function', function: memoryTool }],
    } });
    socket.receive({ type: 'session.updated' });
    await promise;
    expect(events[0]?.type).toBe('session.ready');
  });

  it('executes complete function arguments once and continues once after all results', async () => {
    const { adapter, socket } = await qwen();
    socket.receive({ type: 'response.created', response: { id: 'response' } });
    socket.receive({ type: 'response.function_call_arguments.delta', response_id: 'response', call_id: 'one', delta: '{' });
    expect(events.filter(event => event.type === 'tool.call')).toHaveLength(0);
    for (const id of ['one', 'two', 'one']) socket.receive({ type: 'response.function_call_arguments.done', response_id: 'response', call_id: id, name: memoryTool.name, arguments: '{"content":"Coffee"}' });
    expect(events.filter(event => event.type === 'tool.call')).toHaveLength(2);
    await adapter.sendToolResults([{ callId: 'one', name: memoryTool.name, result: {} }]);
    socket.receive({ type: 'response.done', response: { id: 'response' } });
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(0);
    await adapter.sendToolResults([{ callId: 'two', name: memoryTool.name, result: {} }]);
    await adapter.sendToolResults([{ callId: 'two', name: memoryTool.name, result: {} }]);
    socket.receive({ type: 'response.done', response: { id: 'response' } });
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(1);
    expect(socket.sent.filter(event => event.type === 'conversation.item.create')).toHaveLength(2);
    expect(events.filter(event => event.type === 'turn.complete')).toHaveLength(0);
  });

  it('rejects malformed tool arguments without executing them', async () => {
    const { socket } = await qwen();
    socket.receive({ type: 'response.function_call_arguments.done', response_id: 'response', call_id: 'bad', name: memoryTool.name, arguments: '{' });
    socket.receive({ type: 'response.done', response: { id: 'response' } });
    expect(events.filter(event => event.type === 'tool.call')).toHaveLength(0);
    expect(socket.sent).toContainEqual(expect.objectContaining({ type: 'conversation.item.create', item: expect.objectContaining({ call_id: 'bad', output: expect.stringContaining('Invalid tool arguments') }) }));
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(1);
  });

  it('drops late audio and tool results after an interruption', async () => {
    const { adapter, socket } = await qwen();
    socket.receive({ type: 'response.created', response: { id: 'response' } });
    socket.receive({ type: 'response.function_call_arguments.done', response_id: 'response', call_id: 'call', name: memoryTool.name, arguments: '{"content":"Coffee"}' });
    socket.receive({ type: 'input_audio_buffer.speech_started' });
    socket.receive({ type: 'response.audio.delta', response_id: 'response', delta: 'AAAAAA==' });
    await adapter.sendToolResults([{ callId: 'call', name: memoryTool.name, result: {} }]);
    socket.receive({ type: 'response.done', response: { id: 'response' } });
    expect(events.filter(event => event.type === 'audio')).toHaveLength(0);
    expect(events.map(event => event.type)).toContain('tool.cancelled');
    expect(socket.sent.filter(event => event.type === 'conversation.item.create' || event.type === 'response.create')).toHaveLength(0);
  });

  it('bounds reconnect history without replaying audio or tools', async () => {
    const adapter = new QwenRealtimeAdapter('key', 'workspace', realtimeSessionInfo(getConfig(), 'qwen'), { onEvent });
    sessions.push(adapter);
    const pending = adapter.connect({ ...settings, history: Array.from({ length: 40 }, () => ({ role: 'user' as const, text: 'x'.repeat(1000) })) });
    const socket = mocks.sockets.at(-1)!;
    socket.receive({ type: 'session.created' });
    const session = socket.sent[0].session as { instructions: string };
    expect(session.instructions.length).toBeLessThan(13_000);
    expect(socket.sent).toHaveLength(1);
    socket.receive({ type: 'session.updated' });
    await pending;
    expect(events).toContainEqual(expect.objectContaining({ type: 'session.ready', payload: expect.objectContaining({ resumed: true }) }));
  });

  it('bounds setup time and cleans up a connection cancelled before configuration', async () => {
    vi.useFakeTimers();
    const adapter = new QwenRealtimeAdapter('key', 'workspace', realtimeSessionInfo(getConfig(), 'qwen'), { onEvent });
    sessions.push(adapter);
    const pending = adapter.connect(settings);
    const rejected = expect(pending).rejects.toMatchObject({ message: 'Qwen session setup timed out', fatal: false });
    await vi.advanceTimersByTimeAsync(12_000);
    await rejected;
    expect(mocks.sockets[0].readyState).toBe(3);
    expect(events).toContainEqual(expect.objectContaining({ type: 'error' }));
  });
});

describe('Qwen server-side search tool', () => {
  async function beginSearch() {
    const config = getConfig();
    const adapter = createRealtimeSession(config, realtimeSessionInfo(config, 'qwen'), { onEvent });
    sessions.push(adapter);
    const connected = adapter.connect(settings);
    const socket = mocks.sockets.at(-1)!;
    socket.receive({ type: 'session.created' });
    socket.receive({ type: 'session.updated' });
    await connected;
    socket.receive({ type: 'response.created', response: { id: 'search-response' } });
    socket.receive({ type: 'response.function_call_arguments.done', response_id: 'search-response', call_id: 'search', name: 'web_search', arguments: '{"query":"today"}' });
    socket.receive({ type: 'response.done', response: { id: 'search-response' } });
    return { adapter, socket };
  }

  it('returns a tool error and continues on Qwen when the search fails', async () => {
    mocks.generate.mockRejectedValue(new Error('Unavailable'));
    const { socket } = await beginSearch();
    await vi.waitFor(() => expect(socket.sent.some(event => event.type === 'conversation.item.create')).toBe(true));
    expect(socket.sent).toContainEqual(expect.objectContaining({ item: expect.objectContaining({ output: expect.stringContaining('Web search unavailable') }) }));
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(1);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.generate).toHaveBeenCalledOnce();
  });

  it('aborts a search and ignores its late result after interruption', async () => {
    let finish!: (value: object) => void;
    mocks.generate.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { socket } = await beginSearch();
    socket.receive({ type: 'input_audio_buffer.speech_started' });
    expect(mocks.generate.mock.calls[0][0].config.abortSignal.aborted).toBe(true);
    finish({ text: 'Late result' });
    await Promise.resolve();
    await Promise.resolve();
    expect(events.filter(event => event.type === 'sources')).toHaveLength(0);
    expect(socket.sent.filter(event => event.type === 'conversation.item.create' || event.type === 'response.create')).toHaveLength(0);
  });
  it('keeps custom functions and search together without enabling native search', async () => {
    mocks.generate.mockResolvedValue({ text: 'Today', candidates: [{ groundingMetadata: { groundingChunks: [{ web: { title: 'Source', uri: 'https://example.com' } }], searchEntryPoint: { renderedContent: '<p>Search suggestions</p>' } } }] });
    const config = getConfig();
    const adapter = createRealtimeSession(config, realtimeSessionInfo(config, 'qwen'), { onEvent });
    sessions.push(adapter);
    const connected = adapter.connect(settings);
    const socket = mocks.sockets.at(-1)!;
    socket.receive({ type: 'session.created' });
    socket.receive({ type: 'session.updated' });
    await connected;
    const configured = socket.sent[0].session as { enable_search: boolean; tools: Array<{ function: ToolDefinition }> };
    expect(configured.enable_search).toBe(false);
    expect(configured.tools.map(tool => tool.function.name)).toEqual([memoryTool.name, 'web_search']);
    socket.receive({ type: 'response.function_call_arguments.done', response_id: 'search-response', call_id: 'search', name: 'web_search', arguments: '{"query":"today"}' });
    socket.receive({ type: 'response.done', response: { id: 'search-response' } });
    await vi.waitFor(() => expect(events.map(event => event.type)).toContain('sources'));
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ model: 'gemini-3.5-flash-lite', config: { maxOutputTokens: 1024, tools: [{ googleSearch: {} }] } });
    expect(socket.sent.filter(event => event.type === 'response.create')).toHaveLength(1);
    expect(events.filter(event => event.type === 'tool.call')).toHaveLength(0);
  });
});
