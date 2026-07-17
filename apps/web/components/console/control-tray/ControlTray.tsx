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

import cn from 'classnames';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

import { memo, ReactNode, useEffect, useRef, useState } from 'react';
import { AudioRecorder } from '../../../lib/audio-recorder';

import { useLiveAPIContext } from '../../../contexts/LiveAPIContext';
import { useAuthGate, useUI } from '@/lib/state';
import { useTranslation } from '@/lib/i18n';

export type ControlTrayProps = {
  readonly children?: ReactNode;
};

function ControlTray({ children }: ControlTrayProps) {
  const [audioRecorder] = useState(() => new AudioRecorder());
  const [muted, setMuted] = useState(false);
  const reconnectAttemptRef = useRef(0);

  const { showSettingsPanel } = useUI();
  const { authReady, trialExpired, isAuthenticated, introPlaying } =
    useAuthGate();
  const {
    client,
    connected,
    connecting,
    fatalError,
    displayError,
    audioReady,
    audioStreamer,
    connect,
  } =
    useLiveAPIContext();
  const { t } = useTranslation();

  useEffect(() => {
    if (connected) {
      reconnectAttemptRef.current = 0;
    }
  }, [connected]);

  useEffect(() => {
    if (
      showSettingsPanel ||
      !authReady ||
      connected ||
      connecting ||
      fatalError ||
      (trialExpired && !isAuthenticated)
    ) {
      return;
    }

    const retryDelay =
      reconnectAttemptRef.current === 0
        ? 1400
        : Math.min(10_000, reconnectAttemptRef.current * 2000);

    const timeoutId = window.setTimeout(() => {
      reconnectAttemptRef.current += 1;
      connect().catch(error => {
        console.error('Error auto-connecting live session:', error);
      });
    }, retryDelay);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    showSettingsPanel,
    authReady,
    connected,
    connecting,
    fatalError,
    trialExpired,
    isAuthenticated,
    connect,
  ]);

  useEffect(() => {
    const onData = (base64: string) => {
      client.sendRealtimeInput([
        {
          mimeType: 'audio/pcm;rate=16000',
          data: base64,
        },
      ]);
    };
    if (connected && !muted && !introPlaying && audioRecorder) {
      audioRecorder.on('data', onData).start();
    } else {
      audioRecorder.stop();
    }
    return () => {
      audioRecorder.off('data', onData);
    };
  }, [connected, client, muted, introPlaying, audioRecorder]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const listener = App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        audioRecorder.stop();
        client.disconnect();
        return;
      }

      void audioRecorder.audioContext?.resume();
      void audioStreamer?.context.resume();
    });

    return () => {
      void listener.then(handle => handle.remove());
    };
  }, [audioRecorder, audioStreamer, client]);

  return (
    <section className="control-tray">
      <nav className={cn('actions-nav', { disabled: !connected })}>
        <button
          type="button"
          className={cn('action-button mic-button', {
            muted,
            active: connected && !muted,
          })}
          onClick={() => setMuted(!muted)}
          aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
          aria-pressed={muted}
        >
          {!muted ? (
            <span className="material-symbols-outlined filled">mic</span>
          ) : (
            <span className="material-symbols-outlined filled">mic_off</span>
          )}
        </button>
        {children}
      </nav>

      <div className={cn('connection-container', { connected })}>
        <span
          className={cn('connection-status-dot', {
            connected,
            connecting,
            error: Boolean(fatalError) || displayError?.code === 'WS_BLOCKED',
          })}
        />
        <span className="text-indicator">
          {trialExpired && !isAuthenticated
            ? t('signInRequired')
            : displayError?.code === 'WS_BLOCKED'
              ? t('wsBlockedError')
            : fatalError
                ? t('connectionError')
                : introPlaying
                  ? t('preparingGreeting')
                  : connected
                    ? t('streaming')
                    : connecting
                      ? t('connecting')
                      : !audioReady
                        ? t('preparingAudio')
                        : t('ready')}
        </span>
      </div>
    </section>
  );
}

export default memo(ControlTray);
