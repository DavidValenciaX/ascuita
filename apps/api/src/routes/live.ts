import {
  GoogleGenAI,
  LiveClientToolResponse,
  LiveConnectConfig,
  Part,
  Session,
} from '@google/genai';
import { FastifyPluginAsync } from 'fastify';
import path from 'node:path';
import { getConfig, isAllowedOrigin } from '../config.js';
import { appendAbuseLog } from '../lib/abuse-log.js';
import {
  isFirebaseAdminConfigured,
  verifyFirebaseIdToken,
  getAdminDb,
} from '../lib/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';

type ClientMessage =
  | {
      type: 'connect';
      payload: {
        config: LiveConnectConfig;
        model?: string;
        authToken?: string | null;
        agentId?: string;
        agentName?: string;
        agentSnapshot?: {
          id: string;
          name: string;
          personality: string;
          bodyColor: string;
          voice: string;
          isPreset?: boolean;
        };
        conversationId?: string;
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
        persist?: boolean;
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
const wsAudioByteCounts = new Map<string, CounterState>();
const blockedClients = new Map<string, { expiresAt: number; reason: string }>();
const guestTrialStarts = new Map<string, number>();
const GUEST_TRIAL_RETENTION_MS = 60 * 60_000;

function cleanupExpiredGuestTrials() {
  const now = Date.now();
  for (const [key, start] of guestTrialStarts) {
    if (now - start > GUEST_TRIAL_RETENTION_MS) {
      guestTrialStarts.delete(key);
    }
  }
}

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

function extractTextFromServerMessage(serverMessage: unknown): string {
  if (!serverMessage || typeof serverMessage !== 'object') return '';
  const msg = serverMessage as Record<string, unknown>;
  const serverContent = msg.serverContent as Record<string, unknown> | undefined;
  if (!serverContent) return '';
  const modelTurn = serverContent.modelTurn as Record<string, unknown> | undefined;
  const parts = modelTurn?.parts as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(parts)) return '';
  return parts
    .map(part => (typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('');
}

function extractTranscriptionFromServerMessage(
  serverMessage: unknown,
  key: 'inputTranscription' | 'outputTranscription'
): { text: string; finished: boolean } {
  if (!serverMessage || typeof serverMessage !== 'object') {
    return { text: '', finished: false };
  }
  const msg = serverMessage as Record<string, unknown>;
  const serverContent = msg.serverContent as Record<string, unknown> | undefined;
  const transcription = serverContent?.[key] as Record<string, unknown> | undefined;
  return {
    text: typeof transcription?.text === 'string' ? transcription.text : '',
    finished: transcription?.finished === true,
  };
}

function isServerTurnComplete(serverMessage: unknown): boolean {
  if (!serverMessage || typeof serverMessage !== 'object') return false;
  const msg = serverMessage as Record<string, unknown>;
  const serverContent = msg.serverContent as Record<string, unknown> | undefined;
  return serverContent?.turnComplete === true;
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

function getAudioPayloadBytes(message: RealtimeInputMessage) {
  return message.payload.chunks.reduce((total, chunk) => {
    if (!chunk.mimeType.includes('audio')) {
      return total;
    }

    return total + Buffer.from(chunk.data, 'base64').byteLength;
  }, 0);
}

function getSecurityLogDir() {
  return path.resolve(process.cwd(), getConfig().securityLogDir);
}

function logSecurityEvent(
  type: string,
  ip: string,
  reason: string,
  metadata?: Record<string, unknown>
) {
  const config = getConfig();
  appendAbuseLog(getSecurityLogDir(), config.securityLogRetentionDays, {
    type,
    ip,
    reason,
    metadata,
  });
}

function getActiveBlock(clientKey: string) {
  const block = blockedClients.get(clientKey);
  if (!block) {
    return null;
  }

  if (block.expiresAt <= Date.now()) {
    blockedClients.delete(clientKey);
    return null;
  }

  return block;
}

function blockClient(
  clientKey: string,
  reason: string,
  metadata?: Record<string, unknown>
) {
  const config = getConfig();
  const expiresAt = Date.now() + config.wsTemporaryBlockDurationMs;
  blockedClients.set(clientKey, { expiresAt, reason });
  logSecurityEvent('security.block', clientKey, reason, {
    ...metadata,
    expiresAt,
    blockDurationMs: config.wsTemporaryBlockDurationMs,
  });
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
      const activeBlock = getActiveBlock(clientKey);

      if (activeBlock) {
        request.log.warn(
          { ip: request.ip, reason: activeBlock.reason },
          'Rejected WebSocket connection from temporarily blocked IP'
        );
        logSecurityEvent('security.reject', clientKey, activeBlock.reason, {
          stage: 'connect',
          blockedUntil: activeBlock.expiresAt,
        });
        socket.close(1008, 'Temporarily blocked');
        return;
      }

      if (!isAllowedOrigin(config.corsOrigin, originHeader)) {
        request.log.warn(
          { origin: originHeader },
          'Rejected WebSocket connection from disallowed origin'
        );
        logSecurityEvent('security.reject', clientKey, 'origin_not_allowed', {
          origin: originHeader,
        });
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
        blockClient(clientKey, 'too_many_connection_attempts', {
          count: connectAttemptState.count,
        });
        socket.close(1008, 'Too many connection attempts');
        return;
      }

      const activeConnections = wsActiveConnections.get(clientKey) || 0;
      if (activeConnections >= config.wsMaxConcurrentConnectionsPerIp) {
        request.log.warn(
          { ip: request.ip },
          'Rejected WebSocket connection due to concurrent connection limit'
        );
        logSecurityEvent(
          'security.reject',
          clientKey,
          'too_many_concurrent_connections',
          {
            activeConnections,
          }
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
      let freeTrialTimer: ReturnType<typeof setTimeout> | undefined;
      let conversationUid: string | null = null;
      let conversationId: string | null = null;
      let pendingAssistantText = '';
      let pendingAssistantTranscriptText = '';
      let pendingUserTranscriptText = '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let firestoreDb: any = null;

      const send = (message: Record<string, unknown>) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      };

      const closeSession = () => {
        if (freeTrialTimer) {
          clearTimeout(freeTrialTimer);
          freeTrialTimer = undefined;
        }
        try {
          session?.close();
        } catch (error) {
          request.log.warn({ err: error }, 'Error while closing Gemini session');
        } finally {
          session = undefined;
          pendingAssistantText = '';
          pendingAssistantTranscriptText = '';
          pendingUserTranscriptText = '';
        }
      };

      const endConversation = async () => {
        if (!firestoreDb || !conversationUid || !conversationId) return;
        try {
          await firestoreDb
            .doc(`users/${conversationUid}/conversations/${conversationId}`)
            .set({ endedAt: FieldValue.serverTimestamp() }, { merge: true });
        } catch (error) {
          request.log.warn({ err: error }, 'Error ending conversation in Firestore');
        }
      };

      const saveMessage = async (role: 'user' | 'assistant', text: string) => {
        if (!firestoreDb || !conversationUid || !conversationId || !text.trim()) {
          return;
        }
        try {
          const messagesRef = firestoreDb.collection(
            `users/${conversationUid}/conversations/${conversationId}/messages`
          );
          await messagesRef.add({
            role,
            text,
            timestamp: FieldValue.serverTimestamp(),
          });
          await firestoreDb
            .doc(`users/${conversationUid}/conversations/${conversationId}`)
            .set({ messageCount: FieldValue.increment(1) }, { merge: true });
        } catch (error) {
          request.log.warn({ err: error }, 'Error saving message to Firestore');
        }
      };

      const flushPendingUserTranscript = () => {
        const completedUserTurn = pendingUserTranscriptText.trim();
        pendingUserTranscriptText = '';
        if (completedUserTurn) {
          void saveMessage('user', completedUserTurn);
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
          blockClient(clientKey, 'payload_too_large', {
            payloadBytes: getPayloadSize(raw),
          });
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
          blockClient(clientKey, 'too_many_messages', {
            count: messageRateState.count,
          });
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
          if (message.payload.authToken && !isFirebaseAdminConfigured()) {
            send({
              type: 'error',
              payload: {
                message:
                  'FIREBASE_AUTH_BACKEND_NOT_CONFIGURED: Firebase Admin credentials are missing on the backend',
              },
            });
            return;
          }

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
            const decodedToken = await verifyFirebaseIdToken(
              message.payload.authToken
            );

            if (!decodedToken) {
              cleanupExpiredGuestTrials();
              const now = Date.now();
              const trialStart = guestTrialStarts.get(clientKey);
              if (!trialStart) {
                guestTrialStarts.set(clientKey, now);
              }
              const elapsed = now - (trialStart ?? now);
              const remaining = config.freeTrialDurationMs - elapsed;
              if (remaining <= 0) {
                send({
                  type: 'error',
                  payload: {
                    message:
                      'TRIAL_EXPIRED: Free trial ended. Sign in with Google to continue.',
                  },
                });
                closeSession();
                socket.close(1008, 'Trial expired');
                return;
              }
              freeTrialTimer = setTimeout(() => {
                send({
                  type: 'error',
                  payload: {
                    message:
                      'TRIAL_EXPIRED: Free trial ended. Sign in with Google to continue.',
                  },
                });
                closeSession();
                socket.close(1008, 'Trial expired');
              }, remaining);
            } else {
              conversationUid = decodedToken.uid;
              firestoreDb = getAdminDb();
              if (firestoreDb) {
                try {
                  const requestedConversationId = message.payload.conversationId?.trim();
                  if (requestedConversationId) {
                    const existingConversationRef = firestoreDb.doc(
                      `users/${conversationUid}/conversations/${requestedConversationId}`
                    );
                    const existingConversation = await existingConversationRef.get();
                    if (existingConversation.exists) {
                      await existingConversationRef.set(
                        { endedAt: null },
                        { merge: true }
                      );
                      conversationId = requestedConversationId;
                    }
                  }

                  if (!conversationId) {
                    const agentSnapshot = message.payload.agentSnapshot;
                    const convRef = await firestoreDb
                      .collection(`users/${conversationUid}/conversations`)
                      .add({
                        agentId:
                          agentSnapshot?.id ||
                          message.payload.agentId ||
                          'default-agent',
                        agentName:
                          agentSnapshot?.name ||
                          message.payload.agentName ||
                          'Ascuita',
                        agentSnapshot: {
                          id:
                            agentSnapshot?.id ||
                            message.payload.agentId ||
                            'default-agent',
                          name:
                            agentSnapshot?.name ||
                            message.payload.agentName ||
                            'Ascuita',
                          personality: agentSnapshot?.personality || '',
                          bodyColor: agentSnapshot?.bodyColor || '#4285f4',
                          voice: agentSnapshot?.voice || 'Aoede',
                          isPreset: agentSnapshot?.isPreset === true,
                        },
                        startedAt: FieldValue.serverTimestamp(),
                        endedAt: null,
                        messageCount: 0,
                      });
                    conversationId = convRef.id;
                  }
                } catch (error) {
                  request.log.warn(
                    { err: error },
                    'Error creating conversation document in Firestore'
                  );
                }
              }
            }
          } catch (error) {
            request.log.warn(
              { err: error, ip: request.ip },
              'Invalid Firebase Auth token supplied to /live'
            );
            send({
              type: 'error',
              payload: {
                message: 'AUTH_INVALID: Firebase Auth token is invalid',
              },
            });
            return;
          }

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
                  const text = extractTextFromServerMessage(serverMessage);
                  const inputTranscription = extractTranscriptionFromServerMessage(
                    serverMessage,
                    'inputTranscription'
                  );
                  const outputTranscription = extractTranscriptionFromServerMessage(
                    serverMessage,
                    'outputTranscription'
                  );
                  if (inputTranscription.text) {
                    pendingUserTranscriptText += inputTranscription.text;
                  }
                  if (inputTranscription.finished) {
                    flushPendingUserTranscript();
                  }
                  if (
                    pendingUserTranscriptText.trim() &&
                    (outputTranscription.text || text || isServerTurnComplete(serverMessage))
                  ) {
                    flushPendingUserTranscript();
                  }
                  if (text) {
                    pendingAssistantText += text;
                  }
                  if (outputTranscription.text) {
                    pendingAssistantTranscriptText += outputTranscription.text;
                  }
                  if (outputTranscription.finished) {
                    const completedAssistantTurn =
                      pendingAssistantTranscriptText.trim();
                    pendingAssistantTranscriptText = '';
                    pendingAssistantText = '';
                    if (completedAssistantTurn) {
                      void saveMessage('assistant', completedAssistantTurn);
                    }
                  }
                  if (isServerTurnComplete(serverMessage)) {
                    const completedReply =
                      pendingAssistantTranscriptText.trim() || pendingAssistantText.trim();
                    pendingAssistantTranscriptText = '';
                    pendingAssistantText = '';
                    if (completedReply) {
                      void saveMessage('assistant', completedReply);
                    }
                  }
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
            const parts = Array.isArray(message.payload.parts)
              ? message.payload.parts
              : [message.payload.parts];
            const text = parts
              .map(p => ((p as Record<string, unknown>).text as string) || '')
              .filter(Boolean)
              .join('');
            if (text && message.payload.persist !== false) {
              void saveMessage('user', text);
            }
            return;
          }

          if (isRealtimeInputMessage(message)) {
            const audioBytes = getAudioPayloadBytes(message);
            if (audioBytes > 0) {
              const audioRateState = incrementCounter(
                wsAudioByteCounts,
                clientKey,
                config.wsAudioByteWindowMs
              );
              audioRateState.count += audioBytes - 1;

              if (audioRateState.count > config.wsMaxAudioBytesPerWindow) {
                request.log.warn(
                  { ip: request.ip, audioBytes: audioRateState.count },
                  'Closing WebSocket connection due to audio byte rate limit'
                );
                blockClient(clientKey, 'audio_rate_limit_exceeded', {
                  audioBytes: audioRateState.count,
                  windowMs: config.wsAudioByteWindowMs,
                });
                socket.close(1008, 'Audio rate limit exceeded');
                return;
              }
            }

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
        endConversation();
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
