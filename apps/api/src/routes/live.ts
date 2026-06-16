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
