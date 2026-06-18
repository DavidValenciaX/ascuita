import {
  GoogleGenAI,
  LiveClientToolResponse,
  LiveConnectConfig,
  Part,
  Session,
} from '@google/genai';
import { FastifyPluginAsync } from 'fastify';
import { getConfig, isAllowedOrigin } from '../config.js';

type ClientMessage =
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
        turnComplete?: boolean;
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
    }
  | {
      type: 'ping';
    }
  | {
      type?: string;
      payload?: unknown;
    };

type ConnectMessage = Extract<ClientMessage, { type: 'connect' }>;
type SendMessage = Extract<ClientMessage, { type: 'send' }>;
type RealtimeInputMessage = Extract<ClientMessage, { type: 'realtime_input' }>;
type ToolResponseMessage = Extract<ClientMessage, { type: 'tool_response' }>;
type CounterState = {
  count: number;
  resetAt: number;
};

const wsConnectAttempts = new Map<string, CounterState>();
const wsMessageCounts = new Map<string, CounterState>();
const wsActiveConnections = new Map<string, number>();

function safeJsonParse(raw: Buffer): ClientMessage {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return {};
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getClientKey(ip: string) {
  return ip || 'unknown';
}

function incrementCounter(
  map: Map<string, CounterState>,
  key: string,
  windowMs: number
) {
  const now = Date.now();
  const current = map.get(key);

  if (!current || current.resetAt <= now) {
    const nextState = {
      count: 1,
      resetAt: now + windowMs,
    };
    map.set(key, nextState);
    return nextState;
  }

  current.count += 1;
  return current;
}

function getPayloadSize(raw: unknown) {
  if (typeof raw === 'string') {
    return Buffer.byteLength(raw);
  }

  if (Buffer.isBuffer(raw)) {
    return raw.byteLength;
  }

  if (raw instanceof ArrayBuffer) {
    return raw.byteLength;
  }

  return Buffer.byteLength(String(raw));
}

function isConnectMessage(message: ClientMessage): message is ConnectMessage {
  return message.type === 'connect';
}

function isSendMessage(message: ClientMessage): message is SendMessage {
  return message.type === 'send';
}

function isRealtimeInputMessage(
  message: ClientMessage
): message is RealtimeInputMessage {
  return message.type === 'realtime_input';
}

function isToolResponseMessage(
  message: ClientMessage
): message is ToolResponseMessage {
  return message.type === 'tool_response';
}

function toBuffer(raw: unknown): Buffer {
  if (Buffer.isBuffer(raw)) {
    return raw;
  }

  if (typeof raw === 'string') {
    return Buffer.from(raw);
  }

  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw);
  }

  return Buffer.from(String(raw));
}

const liveRoute: FastifyPluginAsync = async fastify => {
  fastify.get(
    '/live',
    { websocket: true },
    (socket, request) => {
      const config = getConfig();
      const clientKey = getClientKey(request.ip);
      const originHeader =
        typeof request.headers.origin === 'string'
          ? request.headers.origin
          : null;

      if (!isAllowedOrigin(config.corsOrigin, originHeader)) {
        request.log.warn(
          { origin: originHeader },
          'Rejected WebSocket connection from disallowed origin'
        );
        socket.close(1008, 'Origin not allowed');
        return;
      }

      const connectAttemptState = incrementCounter(
        wsConnectAttempts,
        clientKey,
        config.wsConnectWindowMs
      );

      if (
        connectAttemptState.count > config.wsMaxConnectAttemptsPerIp
      ) {
        request.log.warn(
          { ip: request.ip },
          'Rejected WebSocket connection due to connect rate limit'
        );
        socket.close(1008, 'Too many connection attempts');
        return;
      }

      const activeConnections = wsActiveConnections.get(clientKey) || 0;
      if (activeConnections >= config.wsMaxConcurrentConnectionsPerIp) {
        request.log.warn(
          { ip: request.ip },
          'Rejected WebSocket connection due to concurrent connection limit'
        );
        socket.close(1008, 'Too many concurrent connections');
        return;
      }

      wsActiveConnections.set(clientKey, activeConnections + 1);

      const apiKey = process.env.GEMINI_API_KEY;
      const defaultModel =
        process.env.GEMINI_MODEL || 'gemini-3.1-flash-live-preview';
      const genAI = apiKey ? new GoogleGenAI({ apiKey }) : null;
      let session: Session | undefined;
      let currentModel = defaultModel;

      const send = (message: Record<string, unknown>) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      };

      const closeSession = () => {
        try {
          session?.close();
        } catch (error) {
          request.log.warn({ err: error }, 'Error while closing Gemini session');
        } finally {
          session = undefined;
        }
      };

      request.log.info('WebSocket client connected to /live');

      send({
        type: 'connection.ready',
        payload: {
          model: currentModel,
          geminiConfigured: Boolean(apiKey),
        },
      });

      socket.on('message', async (raw: unknown) => {
        if (getPayloadSize(raw) > config.wsMaxPayloadBytes) {
          request.log.warn(
            { ip: request.ip },
            'Closing WebSocket connection due to oversized payload'
          );
          socket.close(1009, 'Payload too large');
          return;
        }

        const messageRateState = incrementCounter(
          wsMessageCounts,
          clientKey,
          config.wsMessageWindowMs
        );

        if (messageRateState.count > config.wsMaxMessagesPerWindow) {
          request.log.warn(
            { ip: request.ip },
            'Closing WebSocket connection due to message rate limit'
          );
          socket.close(1008, 'Too many messages');
          return;
        }

        const message = safeJsonParse(toBuffer(raw));

        if (message.type === 'ping') {
          send({ type: 'pong' });
          return;
        }

        if (message.type === 'disconnect') {
          closeSession();
          send({
            type: 'close',
            payload: {
              reason: 'Disconnected by client',
            },
          });
          return;
        }

        if (isConnectMessage(message)) {
          if (!genAI) {
            send({
              type: 'error',
              payload: {
                message: 'GEMINI_API_KEY is missing on the backend',
              },
            });
            return;
          }

          closeSession();
          currentModel = message.payload.model || defaultModel;

          try {
            session = await genAI.live.connect({
              model: currentModel,
              config: {
                ...message.payload.config,
              },
              callbacks: {
                onopen: () => {
                  send({ type: 'open' });
                },
                onmessage: serverMessage => {
                  send({
                    type: 'server_message',
                    payload: serverMessage,
                  });
                },
                onerror: error => {
                  request.log.error(
                    { err: error },
                    'Gemini Live returned an error'
                  );
                  send({
                    type: 'error',
                    payload: {
                      message: getErrorMessage(error),
                    },
                  });
                },
                onclose: event => {
                  send({
                    type: 'close',
                    payload: {
                      reason: event.reason || '',
                    },
                  });
                  session = undefined;
                },
              },
            });
          } catch (error) {
            request.log.error(
              { err: error },
              'Failed to connect backend session to Gemini Live'
            );
            session = undefined;
            send({
              type: 'error',
              payload: {
                message: getErrorMessage(error),
              },
            });
          }
          return;
        }

        if (!session) {
          send({
            type: 'error',
            payload: {
              message: 'Gemini session is not connected',
            },
          });
          return;
        }

        try {
          if (isSendMessage(message)) {
            await session.sendClientContent({
              turns: Array.isArray(message.payload.parts)
                ? message.payload.parts
                : [message.payload.parts],
              turnComplete: message.payload.turnComplete ?? true,
            });
            return;
          }

          if (isRealtimeInputMessage(message)) {
            for (const chunk of message.payload.chunks) {
              await session.sendRealtimeInput(
                currentModel === 'gemini-3.1-flash-live-preview'
                  ? { audio: chunk }
                  : { media: chunk }
              );
            }
            return;
          }

          if (isToolResponseMessage(message)) {
            if (message.payload.toolResponse.functionResponses) {
              await session.sendToolResponse({
                functionResponses: message.payload.toolResponse.functionResponses,
              });
            }
            return;
          }
        } catch (error) {
          request.log.error(
            { err: error, messageType: message.type },
            'Failed to forward client message to Gemini Live'
          );
          send({
            type: 'error',
            payload: {
              message: getErrorMessage(error),
            },
          });
        }
      });

      socket.on('close', () => {
        const remainingConnections = (wsActiveConnections.get(clientKey) || 1) - 1;
        if (remainingConnections > 0) {
          wsActiveConnections.set(clientKey, remainingConnections);
        } else {
          wsActiveConnections.delete(clientKey);
        }
        closeSession();
        request.log.info('WebSocket client disconnected from /live');
      });

      socket.on('error', (error: Error) => {
        request.log.error({ err: error }, 'WebSocket error on /live');
        closeSession();
      });
    }
  );
};

export default liveRoute;
