import { randomUUID } from 'node:crypto';
import { GoogleGenAI, Modality, type LiveConnectConfig, type LiveServerMessage, type Session } from '@google/genai';
import type { GroundingResult, RealtimeSessionInfo, RealtimeToolCall, RealtimeToolResult } from '../../../../shared/realtime-protocol.js';
import type { RealtimeSession, SessionCallbacks, SessionSettings } from './types.js';
import { boundedHistory, historyInstructions } from './types.js';
import { validArguments } from './validation.js';
import { getProviderError, RealtimeProviderError } from './errors.js';

export function withLongLivedLiveConfig(config: LiveConnectConfig): LiveConnectConfig {
  const sessionResumption = { ...(config.sessionResumption ?? {}) };
  delete sessionResumption.transparent;
  return {
    ...config,
    contextWindowCompression: config.contextWindowCompression ?? { slidingWindow: {} },
    sessionResumption,
  };
}

export function groundingResult(metadata: unknown, summary = ''): GroundingResult | undefined {
  if (!metadata || typeof metadata !== 'object') return;
  const value = metadata as { groundingChunks?: Array<{ web?: { title?: string; uri?: string } }>; searchEntryPoint?: { renderedContent?: string } };
  const sources = (value.groundingChunks ?? []).flatMap(chunk => {
    const url = chunk.web?.uri;
    return url && /^https?:\/\//i.test(url) ? [{ title: chunk.web?.title || url, url }] : [];
  });
  const renderedContent = value.searchEntryPoint?.renderedContent;
  if (!sources.length && !renderedContent) return;
  return { summary, sources, groundingMetadata: metadata as Record<string, unknown>,
    ...(renderedContent ? { searchEntryPoint: { renderedContent } } : {}) };
}

/** Google SDK types and envelopes stay behind this adapter. */
export class GeminiRealtimeAdapter implements RealtimeSession {
  readonly info: RealtimeSessionInfo;
  private session?: Session;
  private sessionPromise?: Promise<Session>;
  private closed = false;
  private settings?: SessionSettings;
  private readonly pendingCalls = new Map<string, RealtimeToolCall>();
  private readonly seenCalls = new Set<string>();
  private readonly prefix = randomUUID();
  private inputIndex = 0;
  private outputIndex = 0;
  private inputText = '';
  private outputText = '';
  private fallbackText = '';
  private usedTranscript = false;
  private assistantFinalized = false;
  private nativeResume = false;

  constructor(
    private readonly apiKey: string,
    info: RealtimeSessionInfo,
    private readonly callbacks: SessionCallbacks,
    private readonly legacyConfig?: unknown,
  ) { this.info = info; }

  async connect(settings: SessionSettings) {
    this.settings = settings;
    const resume = settings.resume;
    this.nativeResume = Boolean(resume && resume.provider === 'gemini' && resume.model === this.info.model
      && resume.agentId === settings.agentId && resume.conversationId === settings.conversationId);
    const history = boundedHistory(settings.history);
    const config = withLongLivedLiveConfig((this.legacyConfig as LiveConnectConfig | undefined) ?? {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      systemInstruction: settings.config.instructions + (this.nativeResume ? '' : historyInstructions(history)),
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.config.voice || 'Aoede' } } },
      tools: [
        ...(settings.config.webSearch ? [{ googleSearch: {} }] : []),
        ...(settings.config.tools?.length ? [{ functionDeclarations: settings.config.tools.map(tool => ({
          name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters,
        })) }] : []),
      ],
      ...(this.nativeResume ? { sessionResumption: { handle: resume!.handle } } : {}),
    });
    this.info.voice = { mode: 'agent', name: settings.config.voice || 'Aoede' };
    const client = new GoogleGenAI({ apiKey: this.apiKey });
    this.sessionPromise = client.live.connect({
      model: this.info.model,
      config,
      callbacks: {
        onopen: () => { if (!this.closed) this.callbacks.onLegacyOpen?.(); },
        onmessage: message => { if (!this.closed) this.onMessage(message, history.length > 0); },
        onerror: error => {
          if (this.closed) return;
          const failure = this.providerError(error);
          this.callbacks.onEvent({ type: 'error', payload: {
            code: failure.code, message: failure.message, fatal: failure.fatal,
          } });
          this.close();
        },
        onclose: event => {
          if (this.closed) return;
          this.closed = true;
          const message = event.reason || 'Gemini session closed';
          const failure = this.providerError({ message, status: event.code });
          if (failure.fatal || failure.code === 'RESUMPTION_REJECTED') {
            this.callbacks.onEvent({ type: 'error', payload: {
              code: failure.code, message, fatal: failure.fatal,
            } });
          }
          this.callbacks.onEvent({ type: 'close', payload: { reason: message } });
        },
      },
    });
    const session = await this.sessionPromise.catch(error => { throw this.providerError(error); });
    if (this.closed) { session.close(); return; }
    this.session = session;
  }

  private providerError(error: unknown): RealtimeProviderError {
    const failure = getProviderError(error);
    return this.nativeResume && /resum|handle|session.*(invalid|expired|not found)/i.test(failure.message)
      ? new RealtimeProviderError(failure.message, { code: 'RESUMPTION_REJECTED', fatal: false }) : failure;
  }

  private finish(role: 'user' | 'assistant') {
    if (role === 'assistant' && this.assistantFinalized) return;
    const text = role === 'user' ? this.inputText : (this.usedTranscript ? this.outputText : this.fallbackText);
    if (!text.trim()) return;
    const index = role === 'user' ? this.inputIndex++ : this.outputIndex;
    this.callbacks.onEvent({ type: 'transcript.final', payload: { role, text: text.trim(), turnId: `${this.prefix}:${role}:${index}` } });
    if (role === 'user') this.inputText = '';
    else { this.outputText = ''; this.fallbackText = ''; this.usedTranscript = false; this.assistantFinalized = true; }
  }

  private onMessage(message: LiveServerMessage, hasHistory: boolean) {
    this.callbacks.onLegacyMessage?.(message);
    if (message.setupComplete) {
      this.callbacks.onEvent({ type: 'session.ready', payload: { ...this.info, resumed: this.nativeResume || hasHistory } });
    }
    const update = message.sessionResumptionUpdate;
    if (update?.resumable && update.newHandle && this.settings) {
      this.callbacks.onEvent({ type: 'session.resumption', payload: {
        provider: 'gemini', model: this.info.model, agentId: this.settings.agentId,
        conversationId: this.settings.conversationId, handle: update.newHandle,
      } });
    }
    const calls = message.toolCall?.functionCalls ?? [];
    const normalized: RealtimeToolCall[] = [];
    for (const call of calls) {
      const callId = call.id || randomUUID();
      if (this.seenCalls.has(callId)) continue;
      this.seenCalls.add(callId);
      const tool = this.settings?.config.tools?.find(item => item.name === call.name);
      const value = { callId, name: call.name || '', args: call.args || {} };
      this.pendingCalls.set(callId, value);
      // Legacy clients keep their exact tool envelope and validation behavior.
      if (this.callbacks.onLegacyMessage || (tool && validArguments(value.args, tool.parameters))) normalized.push(value);
      else queueMicrotask(() => { void this.sendToolResults([{ callId, name: value.name, result: { success: false, error: 'Invalid tool call' } }]); });
    }
    if (normalized.length) this.callbacks.onEvent({ type: 'tool.call', payload: { calls: normalized } });
    if (message.toolCallCancellation?.ids?.length) {
      const callIds = message.toolCallCancellation.ids;
      callIds.forEach(id => this.pendingCalls.delete(id));
      this.callbacks.onEvent({ type: 'tool.cancelled', payload: { callIds } });
    }
    const content = message.serverContent;
    if (content) {
      const input = content.inputTranscription as { text?: string; finished?: boolean } | undefined;
      const output = content.outputTranscription as { text?: string; finished?: boolean } | undefined;
      if (input?.text) {
        this.inputText += input.text;
        this.callbacks.onEvent({ type: 'transcript.delta', payload: { role: 'user', text: input.text, turnId: `${this.prefix}:user:${this.inputIndex}` } });
      }
      // ASR and model output are independent streams; audio or a completed
      // assistant turn does not imply that the user's transcript has finished.
      if (input?.finished) this.finish('user');
      if (output?.text) {
        this.usedTranscript = true;
        this.outputText += output.text;
        this.callbacks.onEvent({ type: 'transcript.delta', payload: { role: 'assistant', text: output.text, turnId: `${this.prefix}:assistant:${this.outputIndex}` } });
      }
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.mimeType?.startsWith('audio/pcm') && part.inlineData.data) {
          this.callbacks.onEvent({ type: 'audio', payload: { data: part.inlineData.data, responseId: `${this.prefix}:assistant:${this.outputIndex}` } });
        }
        if (part.text && !part.thought) this.fallbackText += part.text;
      }
      const grounding = groundingResult(content.groundingMetadata, this.outputText || this.fallbackText);
      if (grounding) this.callbacks.onEvent({ type: 'sources', payload: grounding });
      if (output?.finished) this.finish('assistant');
      if (content.interrupted) {
        this.outputText = this.fallbackText = '';
        this.usedTranscript = false;
        this.callbacks.onEvent({ type: 'interrupted', payload: { responseId: `${this.prefix}:assistant:${this.outputIndex}` } });
        this.assistantFinalized = false;
        this.outputIndex += 1;
      }
      if (content.turnComplete) {
        this.finish('assistant');
        this.callbacks.onEvent({ type: 'turn.complete', payload: { responseId: `${this.prefix}:assistant:${this.outputIndex}` } });
        this.outputText = this.fallbackText = '';
        this.usedTranscript = false;
        this.assistantFinalized = false;
        this.outputIndex += 1;
      }
    }
    if (message.usageMetadata) this.callbacks.onEvent({ type: 'usage', payload: { ...message.usageMetadata } });
  }

  async sendAudio(data: string) {
    const session = await this.sessionPromise;
    if (this.closed || !session) return;
    await session.sendRealtimeInput({ audio: { mimeType: 'audio/pcm;rate=16000', data } });
  }

  async sendText(text: string, turnComplete = true) {
    const session = await this.sessionPromise;
    if (this.closed || !session) return;
    if (this.legacyConfig === undefined && (this.info.model === 'gemini-3.1-flash-live-preview' || this.info.model.startsWith('gemini-3.8-live'))) {
      await session.sendRealtimeInput({ text });
    } else await session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete });
  }

  async sendToolResults(results: RealtimeToolResult[]) {
    const session = await this.sessionPromise;
    if (this.closed || !session) return;
    const responses = results.flatMap(result => {
      const call = this.pendingCalls.get(result.callId);
      if (!call || call.name !== result.name) return [];
      this.pendingCalls.delete(result.callId);
      return [{ id: result.callId, name: result.name, response: this.legacyConfig === undefined
        ? { result: result.result } : result.result as Record<string, unknown> }];
    });
    if (responses.length) await session.sendToolResponse({ functionResponses: responses });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.pendingCalls.clear();
    this.session?.close();
  }
}
