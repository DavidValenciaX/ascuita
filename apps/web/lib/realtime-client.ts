import EventEmitter from 'eventemitter3';
import type {
  ConversationTurn, GroundingResult, RealtimeClientMessage, RealtimeConfig,
  RealtimeServerMessage, RealtimeSessionInfo, RealtimeToolCall, RealtimeToolResult, ResumeState,
} from '../../../shared/realtime-protocol';
import { API_BASE_URL } from './constants';
import { waitForApiReady } from './api-readiness';
import { base64ToArrayBuffer } from './utils';

export const LIVE_HANDSHAKE_TIMEOUT_MS = 15_000;

export interface StreamingLog {
  count?: number;
  data?: unknown;
  date: Date;
  message: string | object;
  type: string;
}

type SessionReady = RealtimeSessionInfo & { resumed: boolean };
type Events = {
  audio: (data: ArrayBuffer) => void;
  ready: (info: SessionReady) => void;
  configuration: (info: RealtimeSessionInfo) => void;
  close: (event: CloseEvent) => void;
  open: () => void;
  error: (event: ErrorEvent) => void;
  interrupted: () => void;
  toolcall: (event: { calls: RealtimeToolCall[] }) => void;
  toolcallcancellation: (event: { callIds: string[] }) => void;
  turncomplete: () => void;
  sources: (result: GroundingResult) => void;
  log: (entry: StreamingLog) => void;
};

function validInfo(value: unknown): value is RealtimeSessionInfo {
  if (!value || typeof value !== 'object') return false;
  const info = value as RealtimeSessionInfo;
  return (info.provider === 'gemini' || info.provider === 'qwen') && typeof info.model === 'string'
    && Boolean(info.voice && info.audio && info.capabilities);
}

export class RealtimeClient extends EventEmitter<Events> {
  private ws?: WebSocket;
  private timer?: number;
  private generation = 0;
  private resolveConnection?: (connected: boolean) => void;
  private identity = '';
  private resume?: ResumeState;
  private history: ConversationTurn[] = [];
  private readonly seenTurns = new Set<string>();
  private _status: 'connected' | 'disconnected' | 'connecting' = 'disconnected';
  sessionInfo?: RealtimeSessionInfo;
  resumed = false;

  get status() { return this._status; }

  async loadConfiguration(signal?: AbortSignal): Promise<RealtimeSessionInfo> {
    const response = await fetch(new URL('/live/v2/config', API_BASE_URL), { signal });
    if (!response.ok) throw new Error('Realtime configuration unavailable');
    const info: unknown = await response.json();
    if (!validInfo(info)) throw new Error('Invalid realtime configuration');
    if (this._status === 'disconnected') this.configuration(info);
    return info;
  }

  private configuration(info: RealtimeSessionInfo) {
    this.sessionInfo = info;
    if (this.resume && (this.resume.provider !== info.provider || this.resume.model !== info.model)) this.resume = undefined;
    this.emit('configuration', info);
  }

  async connect(
    config: RealtimeConfig,
    authToken?: string | null,
    agent?: { id: string; name: string },
    conversationId?: string | null,
    history?: ConversationTurn[],
  ): Promise<boolean> {
    if (this._status !== 'disconnected') return false;
    const identity = JSON.stringify([agent?.id || 'default-agent', conversationId || '']);
    if (identity !== this.identity) {
      this.resume = undefined;
      this.history = [];
      this.seenTurns.clear();
    }
    this.identity = identity;
    if (history?.length) this.history = history.map(turn => ({ role: turn.role, text: turn.text }));
    this.trimHistory();
    this.resumed = false;
    this._status = 'connecting';
    const generation = ++this.generation;
    const ready = await waitForApiReady();
    if (generation !== this.generation || this._status !== 'connecting') return false;
    if (!ready) {
      this.fail('API_UNAVAILABLE', 'Ascuita API readiness check timed out', false);
      return false;
    }
    return new Promise(resolve => {
      this.resolveConnection = resolve;
      const url = new URL('/live/v2', API_BASE_URL);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      let socket: WebSocket;
      try { socket = new WebSocket(url.toString()); }
      catch { this.fail('WS_BLOCKED', 'Could not connect to Ascuita API WebSocket', false); return; }
      this.ws = socket;
      this.timer = window.setTimeout(() => {
        if (this.ws === socket) this.fail('SETUP_TIMEOUT', 'Realtime session setup timed out', false);
      }, LIVE_HANDSHAKE_TIMEOUT_MS);
      socket.addEventListener('open', () => {
        if (this.ws !== socket) return;
        this.emit('open');
        this.sendMessage({ type: 'connect', payload: {
          config, authToken, agentId: agent?.id, agentName: agent?.name,
          conversationId: conversationId || undefined, history: this.history, resume: this.resume,
        } });
      });
      socket.addEventListener('message', event => {
        if (this.ws !== socket) return;
        try { this.onMessage(JSON.parse(String(event.data)) as RealtimeServerMessage); }
        catch { this.fail('INVALID_RESPONSE', 'Invalid message from Ascuita API', true); }
      });
      socket.addEventListener('error', () => {
        if (this.ws === socket) this.fail('WS_BLOCKED', 'Could not connect to Ascuita API WebSocket', false);
      });
      socket.addEventListener('close', event => {
        if (this.ws !== socket) return;
        this.ws = undefined;
        this._status = 'disconnected';
        this.finishConnection(false);
        this.emit('close', event);
      });
    });
  }

  private finishConnection(value: boolean) {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    this.resolveConnection?.(value);
    this.resolveConnection = undefined;
  }

  disconnect(preserveSession = false) {
    this.generation += 1;
    const socket = this.ws;
    this.ws = undefined;
    this._status = 'disconnected';
    this.finishConnection(false);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'disconnect' }));
    socket?.close();
    if (!preserveSession) {
      this.resume = undefined;
      this.history = [];
      this.seenTurns.clear();
    }
    return true;
  }

  private trimHistory() {
    this.history = this.history.slice(-20);
    let remaining = 12_000;
    this.history = this.history.reverse().flatMap(turn => {
      const text = turn.text.slice(-remaining);
      if (!remaining) return [];
      remaining -= text.length;
      return [{ role: turn.role, text }];
    }).reverse();
  }

  private onMessage(message: RealtimeServerMessage) {
    switch (message.type) {
      case 'connection.ready':
        if (!validInfo(message.payload)) throw new Error('Invalid session metadata');
        this.configuration(message.payload);
        break;
      case 'session.ready':
        if (!validInfo(message.payload) || this._status !== 'connecting') return;
        this.configuration(message.payload);
        this.resumed = message.payload.resumed;
        this._status = 'connected';
        this.finishConnection(true);
        this.emit('ready', message.payload);
        break;
      case 'audio':
        if (this._status === 'connected') this.emit('audio', base64ToArrayBuffer(message.payload.data));
        break;
      case 'transcript.final':
        if (!this.seenTurns.has(message.payload.turnId)) {
          this.seenTurns.add(message.payload.turnId);
          this.history.push({ role: message.payload.role, text: message.payload.text });
          this.trimHistory();
        }
        break;
      case 'session.resumption':
        this.resume = message.payload;
        break;
      case 'tool.call': this.emit('toolcall', message.payload); break;
      case 'tool.cancelled': this.emit('toolcallcancellation', message.payload); break;
      case 'interrupted': this.emit('interrupted'); break;
      case 'turn.complete': this.emit('turncomplete'); break;
      case 'sources': this.emit('sources', message.payload); break;
      case 'error':
        if (message.payload.code === 'RESUMPTION_REJECTED') this.resume = undefined;
        this.fail(message.payload.code, message.payload.message, message.payload.fatal);
        break;
      case 'close': {
        const reason = message.payload.reason;
        this.disconnect(true);
        this.emit('close', new CloseEvent('close', { reason }));
        break;
      }
    }
  }

  private fail(code: string, message: string, fatal: boolean) {
    this.disconnect(true);
    this.emit('error', new ErrorEvent('error', { message: `${code}: ${message}`, error: { code, fatal } }));
    this.emit('close', new CloseEvent('close', { reason: message.slice(0, 120) }));
  }

  private sendMessage(message: RealtimeClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  async send(parts: { text: string } | Array<{ text: string }>, turnComplete = true, persist = true) {
    if (this._status !== 'connected') return;
    const text = (Array.isArray(parts) ? parts : [parts]).map(part => part.text).join('');
    this.sendMessage({ type: 'text', payload: { text, turnComplete, persist } });
    if (persist) { this.history.push({ role: 'user', text }); this.trimHistory(); }
  }

  async sendRealtimeInput(chunks: Array<{ mimeType: string; data: string }>) {
    if (this._status !== 'connected') return;
    for (const chunk of chunks) if (chunk.mimeType.startsWith('audio/pcm')) this.sendMessage({ type: 'audio', payload: { data: chunk.data } });
  }

  async sendToolResults(results: RealtimeToolResult[]) {
    if (this._status === 'connected' && results.length) this.sendMessage({ type: 'tool.results', payload: { results } });
  }
}
