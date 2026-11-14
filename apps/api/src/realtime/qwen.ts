import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { RealtimeSessionInfo, RealtimeToolCall, RealtimeToolResult } from '../../../../shared/realtime-protocol.js';
import type { RealtimeSession, SessionCallbacks, SessionSettings } from './types.js';
import { boundedHistory, historyInstructions } from './types.js';
import { isRecord, validArguments } from './validation.js';
import { getProviderError, RealtimeProviderError } from './errors.js';

type PendingCall = RealtimeToolCall & { responseId: string; sent: boolean };
type PendingResponse = { done: boolean; continued: boolean; callIds: Set<string> };
const MAX_QUEUED_TEXT_REQUESTS = 16;

export class QwenRealtimeAdapter implements RealtimeSession {
  private socket?: WebSocket;
  private closed = false;
  private ready = false;
  private handshakeTimer?: ReturnType<typeof setTimeout>;
  private resolveConnect?: () => void;
  private rejectConnect?: (error: Error) => void;
  private settings?: SessionSettings;
  private instructions = '';
  private activeResponse?: string;
  private lastResponse?: string;
  private responseRequested = false;
  private requestInterrupted = false;
  private awaitingVadResponse = false;
  private readonly queuedText: string[] = [];
  private readonly continuations = new Set<string>();
  private readonly responses = new Map<string, PendingResponse>();
  private readonly calls = new Map<string, PendingCall>();
  private readonly cancelled = new Set<string>();
  private readonly finalized = new Set<string>();
  private readonly outputTranscripts = new Map<string, string>();

  constructor(
    private readonly apiKey: string,
    private readonly workspace: string,
    readonly info: RealtimeSessionInfo,
    private readonly callbacks: SessionCallbacks,
  ) {}

  connect(settings: SessionSettings): Promise<void> {
    this.settings = settings;
    const history = boundedHistory(settings.history);
    this.instructions = settings.config.instructions + historyInstructions(history);
    return new Promise((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
      const url = new URL(`wss://${this.workspace}.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime`);
      url.searchParams.set('model', this.info.model);
      this.socket = new WebSocket(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        handshakeTimeout: 10_000,
        maxPayload: 4 * 1024 * 1024,
      });
      this.handshakeTimer = setTimeout(() => this.fail('Qwen session setup timed out'), 12_000);
      this.socket.on('message', raw => {
        if (this.closed) return;
        try {
          const event: unknown = JSON.parse(raw.toString());
          if (!isRecord(event) || typeof event.type !== 'string') throw new Error('Invalid Qwen event');
          this.onMessage(event, history.length > 0);
        } catch { this.fail(new RealtimeProviderError('Invalid response from Qwen', { fatal: true })); }
      });
      this.socket.on('error', error => this.fail(error));
      this.socket.on('close', (code, reason) => {
        if (this.closed) return;
        const message = reason.toString() || 'Qwen session closed';
        const failure = getProviderError({ message, status: code });
        this.rejectConnect?.(failure);
        this.clearHandshake();
        this.closed = true;
        this.clearResponseQueue();
        if (failure.fatal) this.callbacks.onEvent({ type: 'error', payload: { code: failure.code, message, fatal: true } });
        this.callbacks.onEvent({ type: 'close', payload: { reason: message } });
      });
    });
  }

  private clearHandshake() {
    clearTimeout(this.handshakeTimer);
    this.handshakeTimer = undefined;
    this.resolveConnect = undefined;
    this.rejectConnect = undefined;
  }

  private fail(error: unknown) {
    if (this.closed) return;
    const failure = getProviderError(error);
    this.rejectConnect?.(failure);
    this.callbacks.onEvent({ type: 'error', payload: { code: failure.code, message: failure.message, fatal: failure.fatal } });
    this.close();
  }

  private send(value: Record<string, unknown>) {
    if (this.closed || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ event_id: randomUUID(), ...value }));
    return true;
  }

  private response(id: string): PendingResponse {
    let value = this.responses.get(id);
    if (!value) {
      value = { done: false, continued: false, callIds: new Set() };
      this.responses.set(id, value);
    }
    return value;
  }

  private finishTranscript(role: 'user' | 'assistant', id: string, text: string) {
    const turnId = `${role}:${id}`;
    if (this.finalized.has(turnId) || !text.trim()) return;
    this.finalized.add(turnId);
    this.callbacks.onEvent({ type: 'transcript.final', payload: { role, text, turnId } });
  }

  private interrupt(id?: string) {
    if (id) {
      this.cancelled.add(id);
      this.continuations.delete(id);
      this.outputTranscripts.delete(id);
      const callIds = [...this.calls.values()].filter(call => call.responseId === id && !call.sent).map(call => call.callId);
      if (callIds.length) this.callbacks.onEvent({ type: 'tool.cancelled', payload: { callIds } });
    }
    this.callbacks.onEvent({ type: 'interrupted', payload: { responseId: id } });
  }

  private onMessage(event: Record<string, unknown>, resumed: boolean) {
    const responseId = typeof event.response_id === 'string' ? event.response_id : this.activeResponse || '';
    if (event.type === 'session.created') {
      this.send({ type: 'session.update', session: {
        modalities: ['text', 'audio'],
        instructions: this.instructions,
        audio: {
          input: { format: { type: 'pcm', sample_rate: 16000, sample_format: 's16le', channels: 1, packing: 'interleaved', channel_layout: 'mono' } },
          output: { voice: this.info.voice.name, format: { type: 'pcm', sample_rate: 24000 } },
        },
        input_audio_transcription: { model: 'qwen3-asr-flash-realtime' },
        turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 800 },
        enable_search: false,
        tools: (this.settings?.config.tools ?? []).map(tool => ({ type: 'function', function: tool })),
      } });
    } else if (event.type === 'session.updated' && !this.ready) {
      const session = isRecord(event.session) ? event.session : {};
      const audio = isRecord(session.audio) ? session.audio : {};
      const output = isRecord(audio.output) ? audio.output : {};
      const voice = typeof output.voice === 'string' ? output.voice : session.voice;
      if (typeof voice === 'string') this.info.voice = { mode: 'fixed', name: voice };
      this.ready = true;
      this.resolveConnect?.();
      this.clearHandshake();
      this.callbacks.onEvent({ type: 'session.ready', payload: { ...this.info, resumed } });
    } else if (event.type === 'error') {
      const error = isRecord(event.error) ? event.error : {};
      this.fail({ ...error, message: typeof error.message === 'string' ? error.message : 'Qwen Realtime error' });
    } else if (event.type === 'response.created') {
      const response = isRecord(event.response) ? event.response : {};
      if (typeof response.id === 'string') {
        const interruptedRequest = this.requestInterrupted;
        this.responseRequested = false;
        this.requestInterrupted = false;
        if (!interruptedRequest) this.awaitingVadResponse = false;
        this.activeResponse = response.id;
        this.lastResponse = response.id;
        this.response(response.id);
        if (interruptedRequest) this.interrupt(response.id);
      }
    } else if (event.type === 'input_audio_buffer.speech_started') {
      if (this.responseRequested) this.requestInterrupted = true;
      this.awaitingVadResponse = true;
      this.interrupt(this.activeResponse || this.lastResponse);
    } else if (event.type === 'response.audio.delta') {
      if (!this.cancelled.has(responseId) && typeof event.delta === 'string') {
        this.callbacks.onEvent({ type: 'audio', payload: { data: event.delta, responseId } });
      }
    } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
      if (typeof event.item_id === 'string' && typeof event.transcript === 'string') this.finishTranscript('user', event.item_id, event.transcript);
    } else if (event.type === 'response.audio_transcript.delta' || event.type === 'response.text.delta') {
      if (!this.cancelled.has(responseId) && typeof event.delta === 'string') {
        this.outputTranscripts.set(responseId, (this.outputTranscripts.get(responseId) || '') + event.delta);
        this.callbacks.onEvent({ type: 'transcript.delta', payload: { role: 'assistant', text: event.delta, turnId: `assistant:${responseId}` } });
      }
    } else if (event.type === 'response.audio_transcript.done' || event.type === 'response.text.done') {
      if (!this.cancelled.has(responseId)) {
        const text = typeof event.transcript === 'string' ? event.transcript : typeof event.text === 'string' ? event.text : this.outputTranscripts.get(responseId) || '';
        this.finishTranscript('assistant', responseId, text);
      }
    } else if (event.type === 'response.function_call_arguments.done') {
      if (this.cancelled.has(responseId) || typeof event.call_id !== 'string' || this.calls.has(event.call_id)) return;
      const callId = event.call_id;
      const name = typeof event.name === 'string' ? event.name : '';
      let args: unknown;
      try { args = JSON.parse(String(event.arguments)); } catch { args = undefined; }
      const tool = this.settings?.config.tools?.find(item => item.name === name);
      const call: PendingCall = { callId, name, args: isRecord(args) ? args : {}, responseId, sent: false };
      this.calls.set(callId, call);
      this.response(responseId).callIds.add(callId);
      this.continuations.add(responseId);
      if (!tool || !isRecord(args) || !validArguments(args, tool.parameters)) {
        void this.sendToolResults([{ callId, name, result: { success: false, error: 'Invalid tool arguments or unknown tool' } }]);
      } else this.callbacks.onEvent({ type: 'tool.call', payload: { calls: [{ callId, name, args }] } });
    } else if (event.type === 'response.done') {
      const response = isRecord(event.response) ? event.response : {};
      const id = typeof response.id === 'string' ? response.id : responseId;
      const state = this.response(id);
      if (state.done) return;
      state.done = true;
      if (response.status === 'failed') {
        const details = isRecord(response.status_details) ? response.status_details : {};
        this.fail(isRecord(details.error) ? details.error : 'Qwen could not complete the response');
        return;
      }
      if (response.status === 'cancelled' && !this.cancelled.has(id)) this.interrupt(id);
      if (isRecord(response.usage)) this.callbacks.onEvent({ type: 'usage', payload: response.usage });
      if (!this.cancelled.has(id)) {
        this.finishTranscript('assistant', id, this.outputTranscripts.get(id) || '');
        // A tool-only response does not finish the spoken turn or initial greeting.
        if (!state.callIds.size) this.callbacks.onEvent({ type: 'turn.complete', payload: { responseId: id } });
      }
      this.outputTranscripts.delete(id);
      if (this.activeResponse === id) this.activeResponse = undefined;
      this.flushResponses();
    }
  }

  private flushResponses() {
    if (this.closed || !this.ready || this.responseRequested || this.activeResponse || this.awaitingVadResponse) return;
    // Finish tools and their spoken continuation before processing queued text.
    for (const id of this.continuations) {
      const state = this.responses.get(id);
      if (!state || state.continued || this.cancelled.has(id)) {
        this.continuations.delete(id);
        continue;
      }
      if (!state.done || ![...state.callIds].every(callId => this.calls.get(callId)?.sent)) return;
      if (this.requestResponse()) {
        state.continued = true;
        this.continuations.delete(id);
      }
      return;
    }
    const text = this.queuedText[0];
    if (text !== undefined && this.requestResponse({
      instructions: this.instructions + '\n\nRespond to the following request:\n' + text,
      modalities: ['text', 'audio'],
    })) this.queuedText.shift();
  }

  private requestResponse(response?: Record<string, unknown>) {
    // Reserve the slot before the asynchronous response.created acknowledgement.
    this.responseRequested = true;
    if (this.send({ type: 'response.create', ...(response ? { response } : {}) })) return true;
    this.responseRequested = false;
    return false;
  }

  private clearResponseQueue() {
    this.queuedText.length = 0;
    this.continuations.clear();
    this.responseRequested = false;
    this.requestInterrupted = false;
    this.awaitingVadResponse = false;
    this.activeResponse = undefined;
  }

  async sendAudio(data: string) {
    if (this.ready) this.send({ type: 'input_audio_buffer.append', audio: data });
  }

  async sendText(text: string) {
    if (!this.ready || this.closed) return;
    if (this.queuedText.length >= MAX_QUEUED_TEXT_REQUESTS) {
      this.fail(new RealtimeProviderError('Too many queued text requests', { code: 'PROVIDER_BUSY', fatal: false }));
      return;
    }
    this.queuedText.push(text);
    this.flushResponses();
  }

  async sendToolResults(results: RealtimeToolResult[]) {
    for (const result of results) {
      const call = this.calls.get(result.callId);
      if (!call || call.sent || call.name !== result.name || this.cancelled.has(call.responseId) || this.closed) continue;
      call.sent = this.send({ type: 'conversation.item.create', item: {
        type: 'function_call_output', call_id: call.callId, output: JSON.stringify(result.result),
      } });
    }
    this.flushResponses();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.clearResponseQueue();
    this.rejectConnect?.(new Error('Qwen connection cancelled'));
    this.clearHandshake();
    if (this.socket?.readyState === WebSocket.CONNECTING) this.socket.terminate();
    else this.socket?.close();
    this.calls.clear();
    this.responses.clear();
    this.outputTranscripts.clear();
  }
}
