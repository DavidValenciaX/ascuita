/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { RealtimeClient } from '../../lib/realtime-client';
import type { GroundingResult, RealtimeConfig, RealtimeSessionInfo } from '../../../../shared/realtime-protocol';
import { AudioStreamer } from '../../lib/audio-streamer';
import { AudioRecorder } from '../../lib/audio-recorder';
import { registeredWorklets } from '../../lib/audioworklet-registry';
import { audioContext } from '../../lib/utils';
import VolMeterWorket from '../../lib/worklets/vol-meter';
import { useAgent, useAuthGate, useConversationResume, useUser } from '../../lib/state';

export type UseLiveApiResults = {
  client: RealtimeClient;
  setConfig: (config: RealtimeConfig) => void;
  config: RealtimeConfig;

  connect: () => Promise<void>;
  disconnect: (preserveSession?: boolean) => void;
  connected: boolean;
  connecting: boolean;
  fatalError: string | null;
  displayError: { code: 'GENERIC' | 'RESOURCE_EXHAUSTED' | 'WS_BLOCKED'; message: string } | null;
  clearDisplayError: () => void;
  audioReady: boolean;
  audioStarting: boolean;
  audioError: string | null;
  startAudio: () => Promise<void>;
  reportAudioError: (error: unknown) => void;
  audioRecorder: AudioRecorder;

  volumeRef: RefObject<number>;
  audioStreamer: AudioStreamer | null;
  sessionInfo: RealtimeSessionInfo | null;
  sources: GroundingResult | null;
};

export function useLiveApi({
  authToken,
}: {
  authToken?: string | null;
}): UseLiveApiResults {
  const client = useMemo(
    () => new RealtimeClient(),
    []
  );

  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const [audioRecorder] = useState(() => new AudioRecorder());
  const audioStartingRef = useRef(false);
  const audioReadyRef = useRef(false);
  const mountedRef = useRef(true);
  const pendingAudioChunksRef = useRef<ArrayBuffer[]>([]);
  const websocketFailureCountRef = useRef(0);

  const volumeRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [displayError, setDisplayError] = useState<UseLiveApiResults['displayError']>(null);
  const [config, setConfig] = useState<RealtimeConfig>({ instructions: '' });
  const [audioStreamer, setAudioStreamer] = useState<AudioStreamer | null>(null);
  const [sessionInfo, setSessionInfo] = useState<RealtimeSessionInfo | null>(null);
  const [sources, setSources] = useState<GroundingResult | null>(null);
  const activeConversation = useRef<{ agentId: string; conversationId?: string }>({ agentId: '' });

  useEffect(() => {
    const controller = new AbortController();
    void client.loadConfiguration(controller.signal).then(info => {
      if (!controller.signal.aborted) setSessionInfo(info);
    }).catch(() => {});
    return () => controller.abort();
  }, [client]);
  const [audioReady, setAudioReady] = useState(false);
  const [audioStarting, setAudioStarting] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const setTrialExpired = useAuthGate(state => state.setTrialExpired);
  const currentAgent = useAgent(state => state.current);
  const pendingResume = useConversationResume(state => state.pending);
  const userId = useUser(state => state.uid);

  useEffect(() => {
    client.disconnect();
    activeConversation.current = { agentId: '' };
    setConnected(false);
    setConnecting(false);
    setSources(null);
    pendingAudioChunksRef.current = [];
    audioStreamerRef.current?.stop();
  }, [client, userId]);

  const reportAudioError = useCallback((error: unknown) => {
    const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
    if (name === 'AbortError') return;
    setAudioError(
      name === 'NotAllowedError' || name === 'SecurityError' ? 'audioPermissionDenied'
        : name === 'NotFoundError' || name === 'NotReadableError' ? 'audioMicrophoneUnavailable'
          : name === 'NotSupportedError' ? 'audioUnsupported' : 'audioStartError'
    );
    audioReadyRef.current = false;
    setAudioReady(false);
    audioRecorder.stop();
    client.disconnect(true);
    setConnected(false);
    setConnecting(false);
  }, [audioRecorder, client]);

  const startAudio = useCallback(async () => {
    if (audioStartingRef.current || audioReadyRef.current) return;
    audioStartingRef.current = true;
    setAudioStarting(true);
    setAudioError(null);
    try {
      // Invoke both before awaiting: the user's click must unlock both contexts.
      const outputReady = audioContext({ id: 'audio-out' }).then(context => {
        if (mountedRef.current) outputContextRef.current = context;
        else void context.close().catch(() => {});
        return context;
      });
      const inputReady = audioRecorder.prepare();
      const [context] = await Promise.all([outputReady, inputReady]);
      if (!mountedRef.current) {
        void context.close().catch(() => {});
        return;
      }
      let streamer = audioStreamerRef.current;
      if (!streamer) {
        streamer = new AudioStreamer(context);
        await streamer.addWorklet('vumeter-out', VolMeterWorket, (event: MessageEvent<{ volume: number }>) => {
          volumeRef.current = event.data.volume;
        });
      }
      if (!mountedRef.current) {
        registeredWorklets.delete(context);
        void context.close().catch(() => {});
        return;
      }
      audioStreamerRef.current = streamer;
      setAudioStreamer(streamer);
      pendingAudioChunksRef.current = [];
      audioReadyRef.current = true;
      setAudioReady(true);
    } catch (error) {
      if (mountedRef.current) reportAudioError(error);
    } finally {
      audioStartingRef.current = false;
      if (mountedRef.current) setAudioStarting(false);
    }
  }, [audioRecorder, reportAudioError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      audioRecorder.dispose();
      client.disconnect();
      const context = outputContextRef.current;
      if (context) {
        registeredWorklets.delete(context);
        if (context.state !== 'closed') void context.close().catch(() => {});
      }
    };
  }, [audioRecorder, client]);

  useEffect(() => {
    const onSetupComplete = () => {
      websocketFailureCountRef.current = 0;
      setTrialExpired(false);
      setFatalError(null);
      setDisplayError(null);
      setConnecting(false);
      setConnected(true);
    };

    const onClose = () => {
      setConnecting(false);
      setConnected(false);
      setSources(null);
      pendingAudioChunksRef.current = [];
      audioStreamerRef.current?.stop();
    };

    const onOpen = () => {
      setDisplayError(null);
      setConnecting(true);
    };

    const onError = (error: ErrorEvent) => {
      if (error.message?.includes('TRIAL_EXPIRED')) {
        setTrialExpired(true);
        setFatalError(null);
        setDisplayError(null);
        setConnecting(false);
        return;
      }

      if (error.message?.includes('RESOURCE_EXHAUSTED')) {
        setFatalError(error.message);
        setDisplayError({
          code: 'RESOURCE_EXHAUSTED',
          message: error.message,
        });
        setConnecting(false);
        return;
      }

      if (
        error.error?.fatal === true ||
        error.message?.includes('GEMINI_API_KEY is missing on the backend') ||
        error.message?.includes('AUTH_INVALID') ||
        error.message?.includes('FIREBASE_AUTH_BACKEND_NOT_CONFIGURED')
      ) {
        setFatalError(error.message);
        setDisplayError({
          code: 'GENERIC',
          message: error.message,
        });
        setConnecting(false);
        return;
      }

      if (error.message?.includes('Could not connect to Ascuita API WebSocket')) {
        websocketFailureCountRef.current += 1;
        if (websocketFailureCountRef.current >= 4) {
          setDisplayError({
            code: 'WS_BLOCKED',
            message: error.message,
          });
        }
        setConnecting(false);
        return;
      }

      setDisplayError({
        code: 'GENERIC',
        message: error.message || 'Unknown error from Ascuita API',
      });
      setConnecting(false);
    };

    const stopAudioStreamer = () => {
      pendingAudioChunksRef.current = [];
      if (audioStreamerRef.current) {
        audioStreamerRef.current.stop();
      }
    };

    const onAudio = (data: ArrayBuffer) => {
      if (audioStreamerRef.current) {
        audioStreamerRef.current.addPCM16(new Uint8Array(data));
      } else {
        pendingAudioChunksRef.current.push(data);
      }
    };

    // Bind event listeners
    client.on('ready', onSetupComplete);
    client.on('configuration', setSessionInfo);
    client.on('sources', setSources);
    client.on('open', onOpen);
    client.on('close', onClose);
    client.on('error', onError);
    client.on('interrupted', stopAudioStreamer);
    client.on('audio', onAudio);

    return () => {
      // Clean up event listeners
      client.off('ready', onSetupComplete);
      client.off('configuration', setSessionInfo);
      client.off('sources', setSources);
      client.off('open', onOpen);
      client.off('close', onClose);
      client.off('error', onError);
      client.off('interrupted', stopAudioStreamer);
      client.off('audio', onAudio);
    };
  }, [client, setTrialExpired]);

  const connect = useCallback(async () => {
    if (!audioReadyRef.current) return;
    if (!config) {
      throw new Error('config has not been set');
    }
    client.disconnect(true);
    setFatalError(null);
    setDisplayError(null);
    setConnecting(true);
    setSources(null);
    if (activeConversation.current.agentId !== currentAgent.id) activeConversation.current = { agentId: currentAgent.id };
    if (pendingResume) activeConversation.current.conversationId = pendingResume.conversationId;
    await client.connect(
      config,
      authToken,
      {
        ...currentAgent,
        name: currentAgent.name || 'Ascuita',
      },
      activeConversation.current.conversationId,
      pendingResume?.messages
    );
  }, [
    authToken,
    client,
    currentAgent.id,
    currentAgent.name,
    pendingResume,
    setConnected,
    config,
  ]);

  const disconnect = useCallback(async (preserveSession = false) => {
    client.disconnect(preserveSession);
    if (!preserveSession) activeConversation.current = { agentId: '' };
    pendingAudioChunksRef.current = [];
    audioStreamerRef.current?.stop();
    setSources(null);
    setConnecting(false);
    setConnected(false);
  }, [setConnected, client]);

  const clearDisplayError = useCallback(() => {
    setDisplayError(null);
  }, []);

  return {
    client,
    config,
    setConfig,
    connect,
    connected,
    connecting,
    fatalError,
    displayError,
    clearDisplayError,
    audioReady,
    audioStarting,
    audioError,
    startAudio,
    reportAudioError,
    audioRecorder,
    disconnect,
    volumeRef,
    audioStreamer,
    sessionInfo,
    sources,
  };
}
