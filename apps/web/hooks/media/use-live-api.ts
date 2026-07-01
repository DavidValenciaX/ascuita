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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GenAILiveClient } from '../../lib/genai-live-client';
import { LiveConnectConfig } from '@google/genai';
import { AudioStreamer } from '../../lib/audio-streamer';
import { audioContext } from '../../lib/utils';
import VolMeterWorket from '../../lib/worklets/vol-meter';
import { DEFAULT_LIVE_API_MODEL } from '../../lib/constants';
import { useAgent, useAuthGate, useConversationResume } from '../../lib/state';

export type UseLiveApiResults = {
  client: GenAILiveClient;
  setConfig: (config: LiveConnectConfig) => void;
  config: LiveConnectConfig;

  connect: () => Promise<void>;
  disconnect: () => void;
  connected: boolean;
  connecting: boolean;
  fatalError: string | null;
  displayError: { code: 'GENERIC' | 'RESOURCE_EXHAUSTED' | 'WS_BLOCKED'; message: string } | null;
  clearDisplayError: () => void;
  audioReady: boolean;

  volume: number;
  audioStreamer: AudioStreamer | null;
};

export function useLiveApi({
  model = DEFAULT_LIVE_API_MODEL,
  authToken,
}: {
  model?: string;
  authToken?: string | null;
}): UseLiveApiResults {
  const client = useMemo(
    () => new GenAILiveClient(model),
    [model]
  );

  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const pendingAudioChunksRef = useRef<ArrayBuffer[]>([]);
  const websocketFailureCountRef = useRef(0);

  const [volume, setVolume] = useState(0);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [displayError, setDisplayError] = useState<UseLiveApiResults['displayError']>(null);
  const [config, setConfig] = useState<LiveConnectConfig>({});
  const [audioStreamer, setAudioStreamer] = useState<AudioStreamer | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const setTrialExpired = useAuthGate(state => state.setTrialExpired);
  const currentAgent = useAgent(state => state.current);
  const pendingResume = useConversationResume(state => state.pending);

  // register audio for streaming server -> speakers
  useEffect(() => {
    if (!audioStreamerRef.current) {
      audioContext({ id: 'audio-out' }).then((audioCtx: AudioContext) => {
        audioStreamerRef.current = new AudioStreamer(audioCtx);
        audioStreamerRef.current
          .addWorklet<any>('vumeter-out', VolMeterWorket, (ev: any) => {
            setVolume(ev.data.volume);
          })
          .then(() => {
            // Successfully added worklet
          })
          .catch(err => {
            console.error('Error adding worklet:', err);
          });
        setAudioStreamer(audioStreamerRef.current);

        // Flush any audio chunks that arrived before the streamer was ready
        if (pendingAudioChunksRef.current.length > 0) {
          for (const chunk of pendingAudioChunksRef.current) {
            audioStreamerRef.current.addPCM16(new Uint8Array(chunk));
          }
          pendingAudioChunksRef.current = [];
        }
        setAudioReady(true);
      });
    }
  }, [audioStreamerRef]);

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
    client.on('setupcomplete', onSetupComplete);
    client.on('open', onOpen);
    client.on('close', onClose);
    client.on('error', onError);
    client.on('interrupted', stopAudioStreamer);
    client.on('audio', onAudio);

    return () => {
      // Clean up event listeners
      client.off('setupcomplete', onSetupComplete);
      client.off('open', onOpen);
      client.off('close', onClose);
      client.off('error', onError);
      client.off('interrupted', stopAudioStreamer);
      client.off('audio', onAudio);
    };
  }, [client, setTrialExpired]);

  const connect = useCallback(async () => {
    if (!config) {
      throw new Error('config has not been set');
    }
    client.disconnect();
    setFatalError(null);
    setDisplayError(null);
    setConnecting(true);
    await client.connect(
      config,
      authToken,
      {
        ...currentAgent,
        name: currentAgent.name || 'Ascuita',
      },
      pendingResume?.conversationId
    );
  }, [
    authToken,
    client,
    currentAgent.id,
    currentAgent.name,
    pendingResume?.conversationId,
    setConnected,
    config,
  ]);

  const disconnect = useCallback(async () => {
    client.disconnect();
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
    disconnect,
    volume,
    audioStreamer,
  };
}
