import { FastifyPluginAsync } from 'fastify';
import { getConfig, isAllowedOrigin, realtimeConfigurationErrors, realtimeSessionInfo } from '../config.js';
import type { ConversationTurn, RealtimeConfig, RealtimeServerMessage, ResumeState } from '../../../../shared/realtime-protocol.js';
import type { RealtimeSession } from '../realtime/types.js';
import { createRealtimeSession } from '../realtime/factory.js';
import { getProviderError } from '../realtime/errors.js';
import { legacyConfigToRealtime, legacyToolResults } from '../realtime/legacy.js';
import { isRecord, parseClientMessage } from '../realtime/validation.js';
export { withLongLivedLiveConfig } from '../realtime/gemini.js';
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

// These shapes belong only to the /live compatibility boundary.
type LiveConnectConfig = Record<string, unknown>;
type Part = { text?: string; [key: string]: unknown };
type LiveClientToolResponse = { functionResponses?: Array<{ id?: string; name?: string; response?: Record<string, unknown> }> };

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
        history?: ConversationTurn[];
        resume?: ResumeState;
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
const SECURITY_COUNTER_FLUSH_MS = 5_000;

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

function toInternalMessage(value: unknown): ClientMessage {
  const message = parseClientMessage(value);
  if (message.type === 'connect') return message;
  if (message.type === 'audio') return { type: 'realtime_input', payload: { chunks: [{ mimeType: 'audio/pcm;rate=16000', data: message.payload.data }] } };
  if (message.type === 'text') return { type: 'send', payload: { parts: [{ text: message.payload.text }], persist: message.payload.persist, turnComplete: message.payload.turnComplete } };
  if (message.type === 'tool.results') return { type: 'tool_response', payload: { toolResponse: { functionResponses: message.payload.results.map(result => ({ id: result.callId, name: result.name, response: { result: result.result } })) } } };
  return message;
}

const liveRoute: FastifyPluginAsync = async fastify => {
  fastify.get('/live/v2/config', async () => realtimeSessionInfo(getConfig()));
  for (const protocol of ['legacy', 'v2'] as const) {
  fastify.get(
    protocol === 'legacy' ? '/live' : '/live/v2',
    { websocket: true },
    (socket, request) => {
      const config = getConfig();
      const provider = protocol === 'legacy' ? 'gemini' : config.realtimeProvider;
      const info = realtimeSessionInfo(config, provider);
      const clientKey = getClientKey(request.ip);
      const connectionId = String(request.id);
      const connectionStartedAt = Date.now();
      const originHeader =
        typeof request.headers.origin === 'string'
          ? request.headers.origin
          : null;
      let lastLiveStage = 'websocket_connected';
      let providerConnectStartedAt: number | null = null;
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
          model: info.model,
          provider,
          protocol,
          providerConfigured: realtimeConfigurationErrors(config, provider).length === 0,
          firebaseAdminConfigured: isFirebaseAdminConfigured(),
        },
        'WebSocket client connected to /live'
      );

      let connectionLease: ConnectionLease | null = null;

      // Start security checks without delaying registration of socket listeners.
      // Browsers can send `connect` as soon as the WebSocket upgrade completes.
      const initializeSecurity = async () => {
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

        return connectionLease;
      };

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
        if (leaseReleased || !connectionLease) {
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

      const defaultModel = info.model;
      let session: RealtimeSession | undefined;
      let sessionReady = false;
      let generation = 0;
      let currentModel = defaultModel;
      let firstAudio = false;
      let persistence = Promise.resolve();
      const persistedTurns = new Set<string>();
      let freeTrialTimer: ReturnType<typeof setTimeout> | undefined;
      let conversationUid: string | null = null;
      let conversationId: string | null = null;
      let conversationAgentId = 'default-agent';
      let conversationAgentName = 'Ascuita';
      let conversationCreationPromise: Promise<string | null> | null = null;
      // Firebase Admin references are created only after token verification.
      let firestoreDb: ReturnType<typeof getAdminDb> = null;

      const send = (message: Record<string, unknown>) => {
        if (socket.readyState !== socket.OPEN) return;
        if (protocol === 'legacy' && message.type === 'error') {
          const payload = isRecord(message.payload) ? message.payload : {};
          message = { type: 'error', payload: { message: payload.message || 'Realtime connection failed' } };
        }
        if (protocol === 'v2' && message.type === 'error') {
          const payload = isRecord(message.payload) ? message.payload : {};
          const text = typeof payload.message === 'string' ? payload.message : 'Realtime connection failed';
          const code = typeof payload.code === 'string' ? payload.code : text.includes(':') ? text.split(':')[0] : 'SESSION_ERROR';
          message = { type: 'error', payload: { code, message: text, fatal: payload.fatal ?? /AUTH_INVALID|NOT_CONFIGURED|_KEY|WORKSPACE/.test(text) } };
        }
        socket.send(JSON.stringify(message));
      };

      const closeSession = () => {
        generation += 1;
        sessionReady = false;
        if (freeTrialTimer) { clearTimeout(freeTrialTimer); freeTrialTimer = undefined; }
        try { session?.close(); }
        catch (error) { request.log.warn({ err: error }, 'Error while closing realtime session'); }
        finally { session = undefined; }
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

      const persistText = (role: 'user' | 'assistant', text: string) => {
        persistence = persistence.then(async () => {
          if (text.trim() && await ensureConversation()) await saveMessage(role, text);
        }).catch(error => request.log.warn({ err: error }, 'Error persisting realtime transcript'));
      };

      const handleProviderEvent = (event: RealtimeServerMessage) => {
        if (event.type === 'session.ready') {
          sessionReady = true;
          lastLiveStage = 'provider_session_ready';
          request.log.info({ event: 'live.provider.ready', connectionId, provider, model: currentModel,
            elapsedMs: providerConnectStartedAt ? Date.now() - providerConnectStartedAt : undefined }, 'Realtime session ready');
        }
        if (event.type === 'audio' && !firstAudio) {
          firstAudio = true;
          request.log.info({ event: 'live.provider.first_audio', connectionId, provider, model: currentModel,
            elapsedMs: providerConnectStartedAt ? Date.now() - providerConnectStartedAt : undefined }, 'First realtime audio received');
        }
        if (event.type === 'transcript.final' && !persistedTurns.has(event.payload.turnId)) {
          persistedTurns.add(event.payload.turnId);
          persistText(event.payload.role, event.payload.text);
        }
        if (event.type === 'usage') request.log.info({ event: 'live.provider.usage', connectionId, provider, model: currentModel, usage: event.payload }, 'Realtime usage');
        if (event.type === 'error') request.log.warn({ event: 'live.provider.error', connectionId, provider, model: currentModel, code: event.payload.code }, 'Realtime provider error');
        if (protocol === 'v2' || event.type === 'error' || event.type === 'close') send(event);
        if (event.type === 'close') closeSession();
      };

      let startupComplete = false;
      let startupBytes = 0;
      const initialization = initializeSecurity().then(async lease => {
        if (!lease) {
          return false;
        }
        if (socket.readyState !== socket.OPEN) {
          await releaseConnectionLease();
          return false;
        }

        leaseRefreshTimer = setInterval(() => {
          void securityState
            .refreshConnectionLease(lease, config.wsConnectionLeaseDurationMs)
            .catch(error => {
              request.log.warn({ err: error }, 'Error refreshing WebSocket lease');
              socket.close(1013, 'Security state store unavailable');
            });
        }, Math.max(1000, Math.floor(config.wsConnectionLeaseDurationMs / 3)));

        securityCounterFlushTimer = setInterval(() => {
          void flushSecurityCounters();
        }, SECURITY_COUNTER_FLUSH_MS);

        send({
          type: 'connection.ready',
          payload: protocol === 'v2' ? info : { model: currentModel, geminiConfigured: Boolean(config.geminiApiKey) },
        });
        lastLiveStage = 'connection_ready_sent';
        request.log.info(
          {
            event: 'live.connection.ready_sent',
            connectionId,
            model: currentModel,
            provider,
            providerConfigured: realtimeConfigurationErrors(config, provider).length === 0,
          },
          'Sent WebSocket connection.ready'
        );
        return true;
      }).catch(error => {
        failSecurityState(error);
        return false;
      }).finally(() => {
        startupComplete = true;
      });

      socket.on('message', async (raw: unknown) => {
        if (socket.readyState !== socket.OPEN) {
          return;
        }
        // Bound messages retained while Redis is pending, including many small frames.
        if (!startupComplete) {
          startupBytes += Math.max(1, getPayloadSize(raw));
          if (startupBytes > config.wsMaxPayloadBytes) {
            socket.close(1009, 'Startup payload too large');
            return;
          }
        }
        // Keep early messages, but never process them before security succeeds.
        if (!(await initialization) || socket.readyState !== socket.OPEN) {
          return;
        }
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

        let message: ClientMessage;
        try {
          const parsed: unknown = JSON.parse(toBuffer(raw).toString());
          message = protocol === 'v2' ? toInternalMessage(parsed) : safeJsonParse(toBuffer(raw));
        } catch {
          send({ type: 'error', payload: { code: 'INVALID_MESSAGE', message: 'Invalid realtime message', fatal: false } });
          return;
        }
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
          const requestedModel = protocol === 'legacy' ? message.payload.model || defaultModel : defaultModel;
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

          const configurationErrors = realtimeConfigurationErrors(config, provider);
          if (configurationErrors.length) {
            send({ type: 'error', payload: { code: 'PROVIDER_NOT_CONFIGURED', message: configurationErrors.join('; '), fatal: true } });
            return;
          }

          closeSession();
          const attempt = generation;
          firstAudio = false;
          currentModel = requestedModel;
          await persistence;
          if (attempt !== generation || socket.readyState !== socket.OPEN) return;
          await endConversation();
          if (attempt !== generation || socket.readyState !== socket.OPEN) return;
          conversationUid = null;
          conversationId = null;
          firestoreDb = null;
          conversationCreationPromise = null;
          persistedTurns.clear();

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

            if (attempt !== generation || socket.readyState !== socket.OPEN) return;
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
              if (attempt !== generation || socket.readyState !== socket.OPEN) return;
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
                    if (attempt !== generation || socket.readyState !== socket.OPEN) return;
                    if (existingConversation.exists) {
                      await existingConversationRef.set(
                        { endedAt: null },
                        { merge: true }
                      );
                      if (attempt !== generation || socket.readyState !== socket.OPEN) return;
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

          if (attempt !== generation || socket.readyState !== socket.OPEN) return;
          try {
            const connectInfo = { ...info, model: currentModel };
            providerConnectStartedAt = Date.now();
            lastLiveStage = 'provider_connect_started';
            const instance = createRealtimeSession(config, connectInfo, {
              onEvent: event => { if (attempt === generation) handleProviderEvent(event); },
              ...(protocol === 'legacy' ? { onLegacyMessage: (message: unknown) => {
                if (attempt === generation) send({ type: 'server_message', payload: message });
              }, onLegacyOpen: () => {
                if (attempt === generation) send({ type: 'open' });
              } } : {}),
            }, protocol === 'legacy' ? message.payload.config : undefined);
            session = instance;
            await instance.connect({
              config: protocol === 'legacy' ? legacyConfigToRealtime(message.payload.config) : message.payload.config as RealtimeConfig,
              agentId: message.payload.agentId || 'default-agent',
              conversationId: message.payload.conversationId,
              history: message.payload.history,
              resume: message.payload.resume,
            });
            if (attempt !== generation || socket.readyState !== socket.OPEN) instance.close();
          } catch (error) {
            if (attempt !== generation || socket.readyState !== socket.OPEN) return;
            closeSession();
            request.log.error({ event: 'live.provider.connect_failed', connectionId, provider, model: currentModel,
              ...getErrorLogFields(error) }, 'Realtime connection failed');
            const failure = getProviderError(error, 'PROVIDER_CONNECT_FAILED');
            send({ type: 'error', payload: { code: failure.code, message: failure.message, fatal: failure.fatal } });
          }
          return;
        }

        if (!session || !sessionReady) {
          send({
            type: 'error',
            payload: {
              message: 'Realtime session is not ready',
            },
          });
          return;
        }

        try {
          if (isSendMessage(message)) {
            const parts = Array.isArray(message.payload.parts) ? message.payload.parts : [message.payload.parts];
            const text = parts.map(part => part.text || '').filter(Boolean).join('');
            if (text && message.payload.persist !== false) {
              persistText('user', text);
            }
            await session.sendText(text, message.payload.turnComplete ?? true);
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
              if (chunk.mimeType.startsWith('audio/pcm')) await session.sendAudio(chunk.data);
            }
            return;
          }

          if (isToolResponseMessage(message)) {
            if (message.payload.toolResponse.functionResponses) {
              await session.sendToolResults(legacyToolResults(message.payload.toolResponse, protocol === 'legacy'));
            }
            return;
          }
        } catch (error) {
          request.log.error(
            {
              event: 'live.provider.forward_error',
              connectionId,
              provider,
              ...getErrorLogFields(error),
              err: error,
              messageType: message.type,
            },
            'Failed to forward client message to realtime provider'
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
        const providerConnectPending =
          providerConnectStartedAt !== null &&
          !sessionReady &&
          lastLiveStage === 'provider_connect_started';
        stopSecurityCounterFlush();
        void flushSecurityCounters().finally(() => {
          void releaseConnectionLease();
        });
        closeSession();
        void persistence.finally(endConversation);
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
            providerConnectPending,
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
  }
};

export default liveRoute;
