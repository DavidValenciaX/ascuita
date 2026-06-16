/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  LiveClientToolResponse,
  LiveConnectConfig,
  LiveServerContent,
  LiveServerMessage,
  LiveServerToolCall,
  LiveServerToolCallCancellation,
  Part,
} from '@google/genai';
import EventEmitter from 'eventemitter3';
import { API_BASE_URL, DEFAULT_LIVE_API_MODEL } from './constants';
import { difference } from 'lodash';
import { base64ToArrayBuffer } from './utils';

/**
 * Represents a single log entry in the system.
 * Used for tracking and displaying system events, messages, and errors.
 */
export interface StreamingLog {
  // Optional count for repeated log entries
  count?: number;
  // Optional additional data associated with the log
  data?: unknown;
  // Timestamp of when the log was created
  date: Date;
  // The log message content
  message: string | object;
  // The type/category of the log entry
  type: string;
}

/**
 * Event types that can be emitted by the MultimodalLiveClient.
 * Each event corresponds to a specific message from GenAI or client state change.
 */
export interface LiveClientEventTypes {
  // Emitted when audio data is received
  audio: (data: ArrayBuffer) => void;
  // Emitted when the connection closes
  close: (event: CloseEvent) => void;
  // Emitted when content is received from the server
  content: (data: LiveServerContent) => void;
  // Emitted when an error occurs
  error: (e: ErrorEvent) => void;
  // Emitted when the server interrupts the current generation
  interrupted: () => void;
  // Emitted for logging events
  log: (log: StreamingLog) => void;
  // Emitted when the connection opens
  open: () => void;
  // Emitted when the initial setup is complete
  setupcomplete: () => void;
  // Emitted when a tool call is received
  toolcall: (toolCall: LiveServerToolCall) => void;
  // Emitted when a tool call is cancelled
  toolcallcancellation: (
    toolcallCancellation: LiveServerToolCallCancellation
  ) => void;
  // Emitted when the current turn is complete
  turncomplete: () => void;
}

type OutboundMessage =
  | {
      type: 'connect';
      payload: {
        config: LiveConnectConfig;
        model?: string;
      };
    }
  | {
      type: 'disconnect';
    }
  | {
      type: 'send';
      payload: {
        parts: Part | Part[];
        turnComplete: boolean;
      };
    }
  | {
      type: 'realtime_input';
      payload: {
        chunks: Array<{ mimeType: string; data: string }>;
      };
    }
  | {
      type: 'tool_response';
      payload: {
        toolResponse: LiveClientToolResponse;
      };
    };

type InboundMessage =
  | {
      type: 'open';
    }
  | {
      type: 'close';
      payload?: {
        reason?: string;
      };
    }
  | {
      type: 'error';
      payload?: {
        message?: string;
      };
    }
  | {
      type: 'pong';
    }
  | {
      type: 'server_message';
      payload: LiveServerMessage;
    };

function getWebSocketUrl() {
  const url = new URL('/live', API_BASE_URL);
  if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  } else if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  }
  return url.toString();
}

export class GenAILiveClient extends EventEmitter<LiveClientEventTypes> {
  public readonly model: string = DEFAULT_LIVE_API_MODEL;
  protected ws?: WebSocket;

  private _status: 'connected' | 'disconnected' | 'connecting' = 'disconnected';
  public get status() {
    return this._status;
  }

  /**
   * Creates a new GenAILiveClient instance.
   * @param model - Optional model name to override the default model
   */
  constructor(model?: string) {
    super();
    if (model) this.model = model;
  }

  public async connect(config: LiveConnectConfig): Promise<boolean> {
    if (this._status === 'connected' || this._status === 'connecting') {
      return false;
    }

    this.disconnect();
    this._status = 'connecting';

    return new Promise(resolve => {
      const ws = new WebSocket(getWebSocketUrl());
      this.ws = ws;

      ws.addEventListener(
        'open',
        () => {
          this.sendMessage({
            type: 'connect',
            payload: {
              config,
              model: this.model,
            },
          });
          resolve(true);
        },
        { once: true }
      );

      ws.addEventListener('message', event => {
        this.onSocketMessage(event);
      });

      ws.addEventListener(
        'error',
        () => {
          this.onError(
            new ErrorEvent('error', {
              message: 'Could not connect to Ascuita API WebSocket',
            })
          );
          resolve(false);
        },
        { once: true }
      );

      ws.addEventListener('close', event => {
        this.onClose(event);
      });
    });
  }

  public disconnect() {
    this.sendMessage({ type: 'disconnect' });
    this.ws?.close();
    this.ws = undefined;
    this._status = 'disconnected';

    this.log('client.close', `Disconnected`);
    return true;
  }

  public async send(parts: Part | Part[], turnComplete: boolean = true) {
    if (this._status !== 'connected' || !this.ws) {
      this.emit('error', new ErrorEvent('Client is not connected'));
      return;
    }

    this.sendMessage({
      type: 'send',
      payload: {
        parts,
        turnComplete,
      },
    });
    this.log(`client.send`, parts);
  }

  public async sendRealtimeInput(chunks: Array<{ mimeType: string; data: string }>) {
    if (this._status !== 'connected' || !this.ws) {
      // Don't emit error aggressively here as it might be a race condition during close
      return;
    }

    this.sendMessage({
      type: 'realtime_input',
      payload: {
        chunks,
      },
    });

    let hasAudio = false;
    let hasVideo = false;
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      if (ch.mimeType.includes('audio')) hasAudio = true;
      if (ch.mimeType.includes('image')) hasVideo = true;
      if (hasAudio && hasVideo) break;
    }

    let message = 'unknown';
    if (hasAudio && hasVideo) message = 'audio + video';
    else if (hasAudio) message = 'audio';
    else if (hasVideo) message = 'video';
    this.log(`client.realtimeInput`, message);
  }

  public async sendToolResponse(toolResponse: LiveClientToolResponse) {
    if (this._status !== 'connected' || !this.ws) {
      this.emit('error', new ErrorEvent('Client is not connected'));
      return;
    }
    if (
      toolResponse.functionResponses &&
      toolResponse.functionResponses.length
    ) {
      this.sendMessage({
        type: 'tool_response',
        payload: {
          toolResponse,
        },
      });
    }

    this.log(`client.toolResponse`, { toolResponse });
  }

  protected sendMessage(message: OutboundMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  protected onSocketMessage(event: MessageEvent<string>) {
    try {
      const message = JSON.parse(event.data) as InboundMessage;

      if (message.type === 'server_message') {
        this.onMessage(message.payload);
        return;
      }

      if (message.type === 'open') {
        this.onOpen();
        return;
      }

      if (message.type === 'close') {
        this.onProxyClose(message.payload?.reason);
        return;
      }

      if (message.type === 'error') {
        this.onError(
          new ErrorEvent('error', {
            message:
              message.payload?.message || 'Unknown error from Ascuita API',
          })
        );
      }
    } catch (error) {
      this.onError(
        new ErrorEvent('error', {
          message:
            error instanceof Error
              ? error.message
              : 'Invalid message from Ascuita API',
        })
      );
    }
  }

  protected onMessage(message: LiveServerMessage) {
    if (message.setupComplete) {
      this.emit('setupcomplete');
      return;
    }
    if (message.toolCall) {
      this.log('server.toolCall', message);
      this.emit('toolcall', message.toolCall);
      return;
    }
    if (message.toolCallCancellation) {
      this.log('receive.toolCallCancellation', message);
      this.emit('toolcallcancellation', message.toolCallCancellation);
      return;
    }

    if (message.serverContent) {
      const { serverContent } = message;
      if ('interrupted' in serverContent && serverContent.interrupted) {
        this.log('receive.serverContent', 'interrupted');
        this.emit('interrupted');
        return;
      }
      if ('turnComplete' in serverContent && serverContent.turnComplete) {
        this.log('server.send', 'turnComplete');
        this.emit('turncomplete');
      }

      if (serverContent.modelTurn) {
        let parts: Part[] = serverContent.modelTurn.parts || [];

        const audioParts = parts.filter(p =>
          p.inlineData?.mimeType?.startsWith('audio/pcm')
        );
        const base64s = audioParts.map(p => p.inlineData?.data);
        const otherParts = difference(parts, audioParts);

        base64s.forEach(b64 => {
          if (b64) {
            const data = base64ToArrayBuffer(b64);
            this.emit('audio', data);
            this.log(`server.audio`, `buffer (${data.byteLength})`);
          }
        });
        if (!otherParts.length) {
          return;
        }

        parts = otherParts;

        const content: LiveServerContent = { modelTurn: { parts } };
        this.emit('content', content);
        this.log(`server.content`, message);
      } else {
        // Handle other content types if necessary
        // console.log('received unmatched message', message);
      }
    }
  }

  protected onError(e: ErrorEvent) {
    this._status = 'disconnected';
    console.error('error:', e);

    const message = `Could not connect to Ascuita API: ${e.message}`;
    this.log(`server.${e.type}`, message);
    this.emit('error', e);
  }

  protected onOpen() {
    this._status = 'connected';
    this.emit('open');
  }

  protected onClose(e: CloseEvent) {
    this._status = 'disconnected';
    this.ws = undefined;
    let reason = e.reason || '';
    if (reason.toLowerCase().includes('error')) {
      const prelude = 'ERROR]';
      const preludeIndex = reason.indexOf(prelude);
      if (preludeIndex > 0) {
        reason = reason.slice(preludeIndex + prelude.length + 1, Infinity);
      }
    }

    this.log(
      `server.${e.type}`,
      `disconnected ${reason ? `with reason: ${reason}` : ``}`
    );
    this.emit('close', e);
  }

  protected onProxyClose(reason?: string) {
    this._status = 'disconnected';
    this.log(
      'server.proxyclose',
      `disconnected ${reason ? `with reason: ${reason}` : ''}`
    );
    this.emit(
      'close',
      new CloseEvent('close', {
        reason: reason || '',
      })
    );
  }

  /**
   * Internal method to emit a log event.
   * @param type - Log type
   * @param message - Log message
   */
  protected log(type: string, message: string | object) {
    this.emit('log', {
      type,
      message,
      date: new Date(),
    });
  }
}
