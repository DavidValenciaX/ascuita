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

import ControlTray from '@/components/console/control-tray/ControlTray';
import AuthGateModal from '@/components/AuthGateModal';
import ErrorScreen from '@/components/avatar/ErrorScreen';
import AgentAvatar from '@/components/avatar/agent-avatar/AgentAvatar';
import Header from '@/components/Header';
import SettingsPanel from '@/components/SettingsPanel';
import { LiveAPIProvider } from '@/contexts/LiveAPIContext';
import { DEFAULT_LIVE_API_MODEL } from '@/lib/constants';
import { useAuthGate, useUI, useUser } from '@/lib/state';
import { useIdleCursor } from '@/hooks/useIdleCursor';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useEffect } from 'react';
import { auth, onAuthStateChanged } from './firebase';

/**
 * Main application component that provides a streaming interface for Live API.
 * Manages video streaming state and provides controls for webcam/screen capture.
 */
function App() {
  const { showSettingsPanel } = useUI();
  const authToken = useAuthGate(state => state.authToken);
  const setAuthState = useAuthGate(state => state.setAuthState);
  const setUid = useUser(state => state.setUid);
  const setPhotoURL = useUser(state => state.setPhotoURL);
  useIdleCursor();
  useUserProfile();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async user => {
      const token = user ? await user.getIdToken() : null;
      setAuthState({
        authReady: true,
        authToken: token,
        isAuthenticated: Boolean(user),
        userName: user?.displayName || '',
      });
      if (user) {
        setUid(user.uid);
        setPhotoURL(user.photoURL || '');
      } else {
        setUid('');
        setPhotoURL('');
      }
    });

    return () => {
      unsubscribe();
    };
  }, [setAuthState, setUid, setPhotoURL]);
  
  return (
    <div className="App">
      <LiveAPIProvider model={DEFAULT_LIVE_API_MODEL} authToken={authToken}>
        <ErrorScreen />
        <AuthGateModal />
        <Header />

        {showSettingsPanel && <SettingsPanel />}
        <div className="streaming-console">
          <main>
            <div className="main-app-area">
              <AgentAvatar />
            </div>

            <ControlTray></ControlTray>
          </main>
        </div>
      </LiveAPIProvider>
    </div>
  );
}

export default App;
