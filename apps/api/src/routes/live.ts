import {
  GoogleGenAI,
  LiveClientToolResponse,
  LiveConnectConfig,
  Part,
  Session,
} from '@google/genai';
import { FastifyPluginAsync } from 'fastify';
import { getConfig, isAllowedOrigin } from '../config.js';
import { appendAbuseLog } from '../lib/abuse-log.js';
import {
  isFirebaseAdminConfigured,
  verifyFirebaseIdToken,
  getAdminDb,
} from '../lib/firebase-admin.js';
import {
  RedisUnavailableError,
  securityState,
  type ConnectionLease,
} from '../lib/security-state.js';
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

const GUEST_TRIAL_RETENTION_MS = 60 * 60_000;
const SECURITY_COUNTER_FLUSH_MS = 1000;

export function safeJsonParse(raw: Buffer): ClientMessage {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return {};
  }
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function getErrorLogFields(error: unknown) {
  const fields: Record<string, unknown> = {
    errorMessage: getErrorMessage(error),
  };

  if (error instanceof Error) {
    fields.errorName = error.name;
    return fields;
  }

  if (error && typeof error === 'object') {
    const errorRecord = error as Record<string, unknown>;
    if (typeof errorRecord.message === 'string') {
      fields.errorMessage = errorRecord.message;
    }
    if (typeof errorRecord.name === 'string') {
      fields.errorName = errorRecord.name;
    }
    if (typeof errorRecord.code === 'string' || typeof errorRecord.code === 'number') {
      fields.errorCode = errorRecord.code;
    }
    if (
      typeof errorRecord.status === 'string' ||
      typeof errorRecord.status === 'number'
    ) {
      fields.errorStatus = errorRecord.status;
    }
  }

  return fields;
}

export function withLongLivedLiveConfig(config: LiveConnectConfig): LiveConnectConfig {
  const sessionResumption = { ...(config.sessionResumption ?? {}) };

  // The SDK type exposes `transparent`, but the Gemini API rejects it for
  // Live sessions. Strip it even when an older frontend still sends it.
  delete sessionResumption.transparent;

  return {
    ...config,
    contextWindowCompression: config.contextWindowCompression ?? {
      slidingWindow: {},
    },
    sessionResumption,
  };
}

export function extractTextFromServerMessage(serverMessage: unknown): string {
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

export function extractTranscriptionFromServerMessage(
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

export function isServerTurnComplete(serverMessage: unknown): boolean {
  if (!serverMessage || typeof serverMessage !== 'object') return false;
  const msg = serverMessage as Record<string, unknown>;
  const serverContent = msg.serverContent as Record<string, unknown> | undefined;
  return serverContent?.turnComplete === true;
}

export function getClientKey(ip: string) {
  return ip || 'unknown';
}

export function incrementCounter(
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

export function getPayloadSize(raw: unknown) {
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

export function getAudioPayloadBytes(message: RealtimeInputMessage) {
  return message.payload.chunks.reduce((total, chunk) => {
    if (!chunk.mimeType.includes('audio')) {
      return total;
    }

    return total + Buffer.from(chunk.data, 'base64').byteLength;
  }, 0);
}

function logSecurityEvent(
  type: string,
  ip: string,
  reason: string,
  metadata?: Record<string, unknown>
) {
  appendAbuseLog({
    type,
    ip,
    reason,
    metadata,
  });
}

async function getActiveBlock(clientKey: string) {
  return securityState.getBlock(clientKey);
}

async function blockClient(
  clientKey: string,
  reason: string,
  metadata?: Record<string, unknown>
) {
  const config = getConfig();
  const block = await securityState.block(
    clientKey,
    reason,
    config.wsTemporaryBlockDurationMs
  );
  logSecurityEvent('security.block', clientKey, reason, {
    ...metadata,
    expiresAt: block.expiresAt,
    blockDurationMs: config.wsTemporaryBlockDurationMs,
  });
}

export function isConnectMessage(message: ClientMessage): message is ConnectMessage {
  return message.type === 'connect';
}

export function isSendMessage(message: ClientMessage): message is SendMessage {
  return message.type === 'send';
}

export function isRealtimeInputMessage(
  message: ClientMessage
): message is RealtimeInputMessage {
  return message.type === 'realtime_input';
}

export function isToolResponseMessage(
  message: ClientMessage
): message is ToolResponseMessage {
  return message.type === 'tool_response';
}

export function toBuffer(raw: unknown): Buffer {
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
    async (socket, request) => {
      const config = getConfig();
      const clientKey = getClientKey(request.ip);
      const connectionId = String(request.id);
      const connectionStartedAt = Date.now();
      const originHeader =
        typeof request.headers.origin === 'string'
          ? request.headers.origin
          : null;
      let lastLiveStage = 'websocket_connected';
      let geminiConnectStartedAt: number | null = null;
      let receivedMessageCount = 0;
      let receivedAudioChunkCount = 0;
      let receivedAudioBytes = 0;
      const failSecurityState = (error: unknown) => {
        if (!(error instanceof RedisUnavailableError)) {
          request.log.error(
            {
              event: 'live.security_state.error',
              connectionId,
              ...getErrorLogFields(error),
              err: error,
            },
            'Security state store failed'
          );
        }
        lastLiveStage = 'security_state_error';
        socket.close(1013, 'Security state store unavailable');
      };

      request.log.info(
        {
          event: 'live.websocket.connected',
          connectionId,
          origin: originHeader,
          model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-live-preview',
          geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
          firebaseAdminConfigured: isFirebaseAdminConfigured(),
        },
        'WebSocket client connected to /live'
      );

      let activeBlock;
      try {
        activeBlock = await getActiveBlock(clientKey);
      } catch (error) {
        failSecurityState(error);
        return;
      }

      if (activeBlock) {
        request.log.warn(
          {
            event: 'live.websocket.rejected',
            connectionId,
            ip: request.ip,
            reason: activeBlock.reason,
          },
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
          {
            event: 'live.websocket.rejected',
            connectionId,
            origin: originHeader,
            reason: 'origin_not_allowed',
          },
          'Rejected WebSocket connection from disallowed origin'
        );
        logSecurityEvent('security.reject', clientKey, 'origin_not_allowed', {
          origin: originHeader,
        });
        socket.close(1008, 'Origin not allowed');
        return;
      }

      let connectAttemptState;
      try {
        connectAttemptState = await securityState.incrementCounter(
          'ws-connect',
          clientKey,
          config.wsConnectWindowMs
        );
      } catch (error) {
        failSecurityState(error);
        return;
      }

      if (
        connectAttemptState.count > config.wsMaxConnectAttemptsPerIp
      ) {
        request.log.warn(
          {
            event: 'live.websocket.rejected',
            connectionId,
            ip: request.ip,
            reason: 'connect_rate_limit',
            count: connectAttemptState.count,
          },
          'Rejected WebSocket connection due to connect rate limit'
        );
        try {
          await blockClient(clientKey, 'too_many_connection_attempts', {
            count: connectAttemptState.count,
          });
        } catch (error) {
          failSecurityState(error);
          return;
        }
        socket.close(1008, 'Too many connection attempts');
        return;
      }

      let connectionLease: ConnectionLease | null;
      try {
        connectionLease = await securityState.acquireConnectionLease(
          clientKey,
          config.wsMaxConcurrentConnectionsPerIp,
          config.wsConnectionLeaseDurationMs
        );
      } catch (error) {
        failSecurityState(error);
        return;
      }

      if (!connectionLease) {
        request.log.warn(
          {
            event: 'live.websocket.rejected',
            connectionId,
            ip: request.ip,
            reason: 'concurrent_connection_limit',
          },
          'Rejected WebSocket connection due to concurrent connection limit'
        );
        logSecurityEvent(
          'security.reject',
          clientKey,
          'too_many_concurrent_connections',
          {
            maxConnections: config.wsMaxConcurrentConnectionsPerIp,
          }
        );
        socket.close(1008, 'Too many concurrent connections');
        return;
      }

      let leaseReleased = false;
      let leaseRefreshTimer: ReturnType<typeof setInterval> | undefined;
      let securityCounterFlushTimer: ReturnType<typeof setInterval> | undefined;
      let securityCounterFlushPromise: Promise<void> | null = null;
      let pendingMessageCount = 0;
      let pendingAudioBytes = 0;
      let securityCounterLimitTriggered = false;

      const stopSecurityCounterFlush = () => {
        if (securityCounterFlushTimer) {
          clearInterval(securityCounterFlushTimer);
          securityCounterFlushTimer = undefined;
        }
      };

      const flushSecurityCounters = () => {
        if (securityCounterFlushPromise) {
          return securityCounterFlushPromise;
        }

        if (
          securityCounterLimitTriggered ||
          (pendingMessageCount <= 0 && pendingAudioBytes <= 0)
        ) {
          return Promise.resolve();
        }

        const messageCount = pendingMessageCount;
        const audioBytes = pendingAudioBytes;
        pendingMessageCount = 0;
        pendingAudioBytes = 0;

        const operation = (async () => {
          try {
            const entries = [];
            if (messageCount > 0) {
              entries.push({
                scope: 'ws-message',
                clientKey,
                windowMs: config.wsMessageWindowMs,
                amount: messageCount,
              });
            }
            if (audioBytes > 0) {
              entries.push({
                scope: 'ws-audio',
                clientKey,
                windowMs: config.wsAudioByteWindowMs,
                amount: audioBytes,
              });
            }

            const states = await securityState.incrementCounterBatch(entries);
            let stateIndex = 0;
            const messageRateState = messageCount > 0 ? states[stateIndex++] : null;
            const audioRateState = audioBytes > 0 ? states[stateIndex] : null;

            if (
              messageRateState &&
              messageRateState.count > config.wsMaxMessagesPerWindow
            ) {
              securityCounterLimitTriggered = true;
              request.log.warn(
                {
                  event: 'live.websocket.rate_limited',
                  connectionId,
                  ip: request.ip,
                  reason: 'message_rate_limit',
                  count: messageRateState.count,
                },
                'Closing WebSocket connection due to message rate limit'
              );
              await blockClient(clientKey, 'too_many_messages', {
                count: messageRateState.count,
              });
              socket.close(1008, 'Too many messages');
              return;
            }

            if (
              audioRateState &&
              audioRateState.count > config.wsMaxAudioBytesPerWindow
            ) {
              securityCounterLimitTriggered = true;
              request.log.warn(
                {
                  event: 'live.websocket.rate_limited',
                  connectionId,
                  ip: request.ip,
                  reason: 'audio_rate_limit',
                  audioBytes: audioRateState.count,
                },
                'Closing WebSocket connection due to audio byte rate limit'
              );
              await blockClient(clientKey, 'audio_rate_limit_exceeded', {
                audioBytes: audioRateState.count,
                windowMs: config.wsAudioByteWindowMs,
              });
              socket.close(1008, 'Audio rate limit exceeded');
            }
          } catch (error) {
            pendingMessageCount += messageCount;
            pendingAudioBytes += audioBytes;
            failSecurityState(error);
          }
        })();

        securityCounterFlushPromise = operation.finally(() => {
          securityCounterFlushPromise = null;
        });
        return securityCounterFlushPromise;
      };

      const queueMessageCounter = async () => {
        pendingMessageCount += 1;
        if (pendingMessageCount >= config.wsMaxMessagesPerWindow) {
          await flushSecurityCounters();
        }
      };

      const queueAudioCounter = async (audioBytes: number) => {
        pendingAudioBytes += audioBytes;
        if (pendingAudioBytes >= config.wsMaxAudioBytesPerWindow) {
          await flushSecurityCounters();
        }
      };

      const releaseConnectionLease = async () => {
        if (leaseReleased) {
          return;
        }
        leaseReleased = true;
        if (leaseRefreshTimer) {
          clearInterval(leaseRefreshTimer);
          leaseRefreshTimer = undefined;
        }
        try {
          await securityState.releaseConnectionLease(connectionLease);
        } catch (error) {
          request.log.warn({ err: error }, 'Error releasing WebSocket lease');
        }
      };

      leaseRefreshTimer = setInterval(() => {
        void securityState
          .refreshConnectionLease(
            connectionLease,
            config.wsConnectionLeaseDurationMs
          )
          .catch(error => {
            request.log.warn({ err: error }, 'Error refreshing WebSocket lease');
            socket.close(1013, 'Security state store unavailable');
          });
      }, Math.max(1000, Math.floor(config.wsConnectionLeaseDurationMs / 3)));

      securityCounterFlushTimer = setInterval(() => {
        void flushSecurityCounters();
      }, SECURITY_COUNTER_FLUSH_MS);

      const apiKey = process.env.GEMINI_API_KEY;
      const defaultModel =
        process.env.GEMINI_MODEL || 'gemini-3.1-flash-live-preview';
      const genAI = apiKey ? new GoogleGenAI({ apiKey }) : null;
      let session: Session | undefined;
      let currentModel = defaultModel;
      let freeTrialTimer: ReturnType<typeof setTimeout> | undefined;
      let conversationUid: string | null = null;
      let conversationId: string | null = null;
      let conversationAgentId = 'default-agent';
      let conversationAgentName = 'Ascuita';
      let conversationCreationPromise: Promise<string | null> | null = null;
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
          const conversationRef = firestoreDb.doc(
            `users/${conversationUid}/conversations/${conversationId}`
          );
          const conversationDoc = await conversationRef.get();
          if (!conversationDoc.exists) {
            return;
          }
          await conversationRef.set(
            { endedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        } catch (error) {
          request.log.warn({ err: error }, 'Error ending conversation in Firestore');
        }
      };

      const ensureConversation = async () => {
        if (conversationId) {
          return conversationId;
        }
        if (!firestoreDb || !conversationUid) {
          return null;
        }
        if (conversationCreationPromise) {
          return conversationCreationPromise;
        }

        conversationCreationPromise = (async () => {
          try {
            const convRef = await firestoreDb
              .collection(`users/${conversationUid}/conversations`)
              .add({
                agentId: conversationAgentId,
                agentName: conversationAgentName,
                startedAt: FieldValue.serverTimestamp(),
                endedAt: null,
                messageCount: 0,
              });
            conversationId = convRef.id;
            return conversationId;
          } catch (error) {
            request.log.warn(
              { err: error },
              'Error creating conversation document in Firestore'
            );
            return null;
          } finally {
            conversationCreationPromise = null;
          }
        })();

        return conversationCreationPromise;
      };

      const saveMessage = async (role: 'user' | 'assistant', text: string) => {
        if (!firestoreDb || !conversationUid || !conversationId || !text.trim()) {
          return;
        }
        try {
          const conversationRef = firestoreDb.doc(
            `users/${conversationUid}/conversations/${conversationId}`
          );
          const conversationDoc = await conversationRef.get();
          if (!conversationDoc.exists) {
            return;
          }
          const messagesRef = firestoreDb.collection(
            `users/${conversationUid}/conversations/${conversationId}/messages`
          );
          await messagesRef.add({
            role,
            text,
            timestamp: FieldValue.serverTimestamp(),
          });
          await conversationRef.set(
            { messageCount: FieldValue.increment(1) },
            { merge: true }
          );
        } catch (error) {
          request.log.warn({ err: error }, 'Error saving message to Firestore');
        }
      };

      const flushPendingUserTranscript = async () => {
        const completedUserTurn = pendingUserTranscriptText.trim();
        pendingUserTranscriptText = '';
        if (completedUserTurn) {
          const ensuredConversationId = await ensureConversation();
          if (!ensuredConversationId) {
            return;
          }
          await saveMessage('user', completedUserTurn);
        }
      };

      send({
        type: 'connection.ready',
        payload: {
          model: currentModel,
          geminiConfigured: Boolean(apiKey),
        },
      });
      lastLiveStage = 'connection_ready_sent';
      request.log.info(
        {
          event: 'live.connection.ready_sent',
          connectionId,
          model: currentModel,
          geminiConfigured: Boolean(apiKey),
        },
        'Sent WebSocket connection.ready'
      );

      socket.on('message', async (raw: unknown) => {
        const payloadBytes = getPayloadSize(raw);
        if (payloadBytes > config.wsMaxPayloadBytes) {
          request.log.warn(
            { ip: request.ip },
            'Closing WebSocket connection due to oversized payload'
          );
          try {
            await blockClient(clientKey, 'payload_too_large', { payloadBytes });
          } catch (error) {
            failSecurityState(error);
            return;
          }
          socket.close(1009, 'Payload too large');
          return;
        }

        if (securityCounterLimitTriggered) {
          return;
        }

        await queueMessageCounter();
        if (securityCounterLimitTriggered) {
          return;
        }

        const message = safeJsonParse(toBuffer(raw));
        receivedMessageCount += 1;

        if (
          isRealtimeInputMessage(message) &&
          message.payload &&
          Array.isArray(message.payload.chunks) &&
          message.payload.chunks.length > 0
        ) {
          const audioChunkCount = message.payload.chunks.length;
          const audioBytes = getAudioPayloadBytes(message);
          receivedAudioChunkCount += audioChunkCount;
          receivedAudioBytes += audioBytes;
          if (receivedAudioChunkCount === audioChunkCount) {
            request.log.info(
              {
                event: 'live.client.audio_started',
                connectionId,
                payloadBytes,
                audioChunkCount,
                audioBytes,
              },
              'Received first realtime audio input from client'
            );
          }
        } else {
          request.log.info(
            {
              event: 'live.client.message',
              connectionId,
              messageType: message.type || 'unknown',
              payloadBytes,
            },
            'Received WebSocket client message'
          );
        }

        if (message.type === 'ping') {
          send({ type: 'pong' });
          return;
        }

        if (message.type === 'disconnect') {
          lastLiveStage = 'client_disconnect_requested';
          request.log.info(
            {
              event: 'live.client.disconnect_requested',
              connectionId,
            },
            'Client requested WebSocket disconnect'
          );
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
          const requestedModel = message.payload.model || defaultModel;
          const hasRequestedConversation = Boolean(
            message.payload.conversationId?.trim()
          );
          lastLiveStage = 'client_connect_received';
          request.log.info(
            {
              event: 'live.connect.received',
              connectionId,
              model: requestedModel,
              authMode: message.payload.authToken ? 'authenticated' : 'guest',
              hasRequestedConversation,
              configKeys: Object.keys(message.payload.config || {}).sort(),
            },
            'Received live session connect request'
          );

          if (message.payload.authToken && !isFirebaseAdminConfigured()) {
            lastLiveStage = 'firebase_auth_backend_not_configured';
            request.log.warn(
              {
                event: 'live.auth.backend_not_configured',
                connectionId,
              },
              'Rejected authenticated live session because Firebase Admin is not configured'
            );
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
            lastLiveStage = 'gemini_api_key_missing';
            request.log.error(
              {
                event: 'live.gemini.configuration_missing',
                connectionId,
                model: requestedModel,
              },
              'Cannot start live session because GEMINI_API_KEY is missing'
            );
            send({
              type: 'error',
              payload: {
                message: 'GEMINI_API_KEY is missing on the backend',
              },
            });
            return;
          }

          closeSession();
          currentModel = requestedModel;

          try {
            lastLiveStage = 'firebase_auth_verification_started';
            request.log.info(
              {
                event: 'live.auth.verification_started',
                connectionId,
                authMode: message.payload.authToken ? 'authenticated' : 'guest',
              },
              'Starting live session authentication check'
            );
            const decodedToken = await verifyFirebaseIdToken(
              message.payload.authToken
            );

            if (!decodedToken) {
              lastLiveStage = 'guest_trial_check_started';
              request.log.info(
                {
                  event: 'live.auth.guest_trial_check_started',
                  connectionId,
                },
                'Starting guest live trial check'
              );
              const now = Date.now();
              let trialStart;
              try {
                trialStart = await securityState.getOrStartGuestTrial(
                  clientKey,
                  GUEST_TRIAL_RETENTION_MS
                );
              } catch (error) {
                failSecurityState(error);
                return;
              }
              const elapsed = now - trialStart;
              const remaining = config.freeTrialDurationMs - elapsed;
              request.log.info(
                {
                  event: 'live.auth.guest_trial_checked',
                  connectionId,
                  trialElapsedMs: elapsed,
                  trialRemainingMs: Math.max(0, remaining),
                  trialExpired: remaining <= 0,
                },
                'Checked guest live trial'
              );
              if (remaining <= 0) {
                lastLiveStage = 'guest_trial_expired';
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
              lastLiveStage = 'firebase_auth_verified';
              conversationUid = decodedToken.uid;
              firestoreDb = getAdminDb();
              request.log.info(
                {
                  event: 'live.auth.verified',
                  connectionId,
                  firestoreConfigured: Boolean(firestoreDb),
                  hasRequestedConversation,
                },
                'Firebase Auth token verified for live session'
              );
              if (firestoreDb) {
                try {
                  conversationAgentId = message.payload.agentId || 'default-agent';
                  conversationAgentName = message.payload.agentName || 'Ascuita';
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
                } catch (error) {
                  request.log.warn(
                    { err: error },
                    'Error creating conversation document in Firestore'
                  );
                }
              }
            }
          } catch (error) {
            lastLiveStage = 'firebase_auth_error';
            request.log.warn(
              {
                event: 'live.auth.error',
                connectionId,
                ...getErrorLogFields(error),
                err: error,
                ip: request.ip,
              },
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
            const liveConfig = withLongLivedLiveConfig(message.payload.config);
            geminiConnectStartedAt = Date.now();
            lastLiveStage = 'gemini_connect_started';
            request.log.info(
              {
                event: 'live.gemini.connect_started',
                connectionId,
                model: currentModel,
                authMode: message.payload.authToken ? 'authenticated' : 'guest',
                configKeys: Object.keys(liveConfig).sort(),
              },
              'Starting Gemini Live connection'
            );
            session = await genAI.live.connect({
              model: currentModel,
              config: liveConfig,
              callbacks: {
                onopen: () => {
                  lastLiveStage = 'gemini_socket_open';
                  request.log.info(
                    {
                      event: 'live.gemini.socket_open',
                      connectionId,
                      model: currentModel,
                      elapsedMs: geminiConnectStartedAt
                        ? Date.now() - geminiConnectStartedAt
                        : undefined,
                    },
                    'Gemini Live socket opened'
                  );
                  send({ type: 'open' });
                },
                onmessage: async serverMessage => {
                  if (serverMessage.setupComplete) {
                    lastLiveStage = 'gemini_setup_complete';
                    request.log.info(
                      {
                        event: 'live.gemini.setup_complete',
                        connectionId,
                        model: currentModel,
                        elapsedMs: geminiConnectStartedAt
                          ? Date.now() - geminiConnectStartedAt
                          : undefined,
                      },
                      'Gemini Live setupComplete received'
                    );
                  }

                  if (serverMessage.sessionResumptionUpdate) {
                    request.log.info(
                      {
                        resumable:
                          serverMessage.sessionResumptionUpdate.resumable === true,
                        hasHandle: Boolean(
                          serverMessage.sessionResumptionUpdate.newHandle
                        ),
                        lastConsumedClientMessageIndex:
                          serverMessage.sessionResumptionUpdate
                            .lastConsumedClientMessageIndex,
                      },
                      'Gemini Live session resumption update'
                    );
                  }

                  if (serverMessage.goAway) {
                    request.log.warn(
                      { timeLeft: serverMessage.goAway.timeLeft },
                      'Gemini Live sent GoAway'
                    );
                  }

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
                    await flushPendingUserTranscript();
                  }
                  if (
                    pendingUserTranscriptText.trim() &&
                    (outputTranscription.text || text || isServerTurnComplete(serverMessage))
                  ) {
                    await flushPendingUserTranscript();
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
                  lastLiveStage = 'gemini_error';
                  request.log.error(
                    {
                      event: 'live.gemini.error',
                      connectionId,
                      model: currentModel,
                      elapsedMs: geminiConnectStartedAt
                        ? Date.now() - geminiConnectStartedAt
                        : undefined,
                      ...getErrorLogFields(error),
                      err: error,
                    },
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
                  lastLiveStage = 'gemini_closed';
                  request.log.warn(
                    {
                      event: 'live.gemini.closed',
                      connectionId,
                      model: currentModel,
                      code: event.code,
                      reason: event.reason || '',
                      wasClean: event.wasClean,
                      elapsedMs: geminiConnectStartedAt
                        ? Date.now() - geminiConnectStartedAt
                        : undefined,
                    },
                    'Gemini Live session closed'
                  );
                  send({
                    type: 'close',
                    payload: {
                      reason:
                        event.reason || `Gemini session closed (code ${event.code})`,
                    },
                  });
                  session = undefined;
                },
              },
            });
            lastLiveStage = 'gemini_connect_resolved';
            request.log.info(
              {
                event: 'live.gemini.connect_resolved',
                connectionId,
                model: currentModel,
                elapsedMs: geminiConnectStartedAt
                  ? Date.now() - geminiConnectStartedAt
                  : undefined,
                sessionCreated: Boolean(session),
              },
              'Gemini Live connection resolved'
            );
          } catch (error) {
            lastLiveStage = 'gemini_connect_failed';
            request.log.error(
              {
                event: 'live.gemini.connect_failed',
                connectionId,
                model: currentModel,
                elapsedMs: geminiConnectStartedAt
                  ? Date.now() - geminiConnectStartedAt
                  : undefined,
                ...getErrorLogFields(error),
                err: error,
              },
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
              const ensuredConversationId = await ensureConversation();
              if (!ensuredConversationId) {
                return;
              }
              await saveMessage('user', text);
            }
            return;
          }

          if (isRealtimeInputMessage(message)) {
            const audioBytes = getAudioPayloadBytes(message);
            if (audioBytes > 0) {
              await queueAudioCounter(audioBytes);
              if (securityCounterLimitTriggered) {
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
            {
              event: 'live.gemini.forward_error',
              connectionId,
              ...getErrorLogFields(error),
              err: error,
              messageType: message.type,
            },
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

      socket.on('close', (code: number, reason: Buffer) => {
        const geminiConnectPending =
          geminiConnectStartedAt !== null &&
          !session &&
          (lastLiveStage === 'gemini_connect_started' ||
            lastLiveStage === 'gemini_socket_open');
        stopSecurityCounterFlush();
        void flushSecurityCounters().finally(() => {
          void releaseConnectionLease();
        });
        closeSession();
        void endConversation();
        request.log.info(
          {
            event: 'live.websocket.closed',
            connectionId,
            code,
            reason: reason?.toString() || '',
            durationMs: Date.now() - connectionStartedAt,
            lastLiveStage,
            receivedMessageCount,
            receivedAudioChunkCount,
            receivedAudioBytes,
            geminiConnectPending,
          },
          'WebSocket client disconnected from /live'
        );
      });

      socket.on('error', (error: Error) => {
        lastLiveStage = 'websocket_error';
        request.log.error(
          {
            event: 'live.websocket.error',
            connectionId,
            ...getErrorLogFields(error),
            err: error,
            durationMs: Date.now() - connectionStartedAt,
            lastLiveStage,
          },
          'WebSocket error on /live'
        );
        stopSecurityCounterFlush();
        void flushSecurityCounters().finally(() => {
          void releaseConnectionLease();
        });
        closeSession();
      });
    }
  );
};

export default liveRoute;
