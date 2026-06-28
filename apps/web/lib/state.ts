/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { create } from 'zustand';
import { Agent, Ascuita } from './presets/agents';
import {
  cloneInnerFireConfig,
  defaultInnerFireConfig,
  DeepPartial,
  InnerFireConfig,
  mergeInnerFireConfig,
  normalizeInnerFireConfig,
} from './fire/config';

/**
 * Speech animation
 */
export type SpeechAnimationConfig = {
  silenceThreshold: number;
  currentVisemeBoost: number;
  minHoldTime: number;
  minSwitchScore: number;
  featureHistoryFrames: number;
  attackFactor: number;
  decayFactor: number;
  analyserSmoothing: number;
  enableVolumeFallback: boolean;
  fallbackVolumeMultiplier: number;
  fallbackScoreBase: number;
  fallbackScoreWeight: number;
  fallbackCentroidThreshold: number;
};

export const defaultSpeechAnimationConfig: SpeechAnimationConfig = {
  silenceThreshold: 0.02,
  currentVisemeBoost: 1.15,
  minHoldTime: 0.04,
  minSwitchScore: 0.35,
  featureHistoryFrames: 10,
  attackFactor: 0.3,
  decayFactor: 0.15,
  analyserSmoothing: 0.1,
  enableVolumeFallback: false,
  fallbackVolumeMultiplier: 1.6,
  fallbackScoreBase: 0.2,
  fallbackScoreWeight: 0.4,
  fallbackCentroidThreshold: 1500,
};

export const useSpeechAnimation = create<{
  config: SpeechAnimationConfig;
  updateConfig: (adjustments: Partial<SpeechAnimationConfig>) => void;
  resetConfig: () => void;
}>(set => ({
  config: defaultSpeechAnimationConfig,
  updateConfig: adjustments =>
    set(state => ({ config: { ...state.config, ...adjustments } })),
  resetConfig: () => set({ config: defaultSpeechAnimationConfig }),
}));

/**
 * Inner fire
 */
export const useInnerFire = create<{
  config: InnerFireConfig;
  updateConfig: (adjustments: DeepPartial<InnerFireConfig>) => void;
  replaceConfig: (config: InnerFireConfig) => void;
  resetConfig: () => void;
}>(set => ({
  config: cloneInnerFireConfig(defaultInnerFireConfig),
  updateConfig: adjustments =>
    set(state => ({ config: mergeInnerFireConfig(state.config, adjustments) })),
  replaceConfig: config => set({ config: normalizeInnerFireConfig(config) }),
  resetConfig: () => set({ config: cloneInnerFireConfig(defaultInnerFireConfig) }),
}));

export type AvatarRenderConfig = {
  bodyEmissiveIntensity: number;
  bodyOpacity: number;
  bodyTransparent: boolean;
  bodyDepthWrite: boolean;
  talkingBounceIntensity: number;
  sceneExposure: number;
  sceneBloomStrength: number;
  sceneBloomRadius: number;
  sceneBloomThreshold: number;
};

export const defaultAvatarRenderConfig: AvatarRenderConfig = {
  bodyEmissiveIntensity: 0.1,
  bodyOpacity: 0.99,
  bodyTransparent: true,
  bodyDepthWrite: true,
  talkingBounceIntensity: 1,
  sceneExposure: 0.82,
  sceneBloomStrength: 0.1,
  sceneBloomRadius: 0.0,
  sceneBloomThreshold: 0.0,
};

export const useAvatarRender = create<{
  config: AvatarRenderConfig;
  updateConfig: (adjustments: Partial<AvatarRenderConfig>) => void;
  resetConfig: () => void;
}>(set => ({
  config: defaultAvatarRenderConfig,
  updateConfig: adjustments =>
    set(state => ({ config: { ...state.config, ...adjustments } })),
  resetConfig: () => set({ config: defaultAvatarRenderConfig }),
}));

/**
 * User
 */
export type User = {
  uid?: string;
  name?: string;
  info?: string;
  photoURL?: string;
  email?: string;
  authDisplayName?: string;
  authProviders?: string[];
  emailVerified?: boolean;
};

export const useUser = create<
  {
    setName: (name: string) => void;
    setInfo: (info: string) => void;
    setUid: (uid: string) => void;
    setPhotoURL: (url: string) => void;
    setEmail: (email: string) => void;
    setAuthDisplayName: (name: string) => void;
    setAuthProviders: (providers: string[]) => void;
    setEmailVerified: (verified: boolean) => void;
  } & User
>(set => ({
  uid: '',
  name: '',
  info: '',
  photoURL: '',
  email: '',
  authDisplayName: '',
  authProviders: [],
  emailVerified: false,
  setName: name => set({ name }),
  setInfo: info => set({ info }),
  setUid: uid => set({ uid }),
  setPhotoURL: url => set({ photoURL: url }),
  setEmail: email => set({ email }),
  setAuthDisplayName: authDisplayName => set({ authDisplayName }),
  setAuthProviders: authProviders => set({ authProviders }),
  setEmailVerified: emailVerified => set({ emailVerified }),
}));

/**
 * Agents
 */
function getAgentById(id: string) {
  const { availablePersonal, availablePresets } = useAgent.getState();
  return (
    availablePersonal.find(agent => agent.id === id) ||
    availablePresets.find(agent => agent.id === id)
  );
}

export const useAgent = create<{
  current: Agent;
  availablePresets: Agent[];
  availablePersonal: Agent[];
  setCurrent: (agent: Agent | string) => void;
  addAgent: (agent: Agent) => void;
  update: (agentId: string, adjustments: Partial<Agent>) => void;
  setPersonalAgents: (agents: Agent[]) => void;
  removeAgent: (agentId: string) => void;
}>(set => ({
  current: Ascuita,
  availablePresets: [Ascuita],
  availablePersonal: [],

  addAgent: (agent: Agent) => {
    set(state => ({
      availablePersonal: [...state.availablePersonal, agent],
      current: agent,
    }));
  },
  setCurrent: (agent: Agent | string) =>
    set({ current: typeof agent === 'string' ? getAgentById(agent) : agent }),
  update: (agentId: string, adjustments: Partial<Agent>) => {
    let agent = getAgentById(agentId);
    if (!agent) return;
    const updatedAgent = { ...agent, ...adjustments };
    set(state => ({
      availablePresets: state.availablePresets.map(a =>
        a.id === agentId ? updatedAgent : a
      ),
      availablePersonal: state.availablePersonal.map(a =>
        a.id === agentId ? updatedAgent : a
      ),
      current: state.current.id === agentId ? updatedAgent : state.current,
    }));
  },
  setPersonalAgents: (agents: Agent[]) => {
    set({ availablePersonal: agents });
  },
  removeAgent: (agentId: string) => {
    set(state => ({
      availablePersonal: state.availablePersonal.filter(a => a.id !== agentId),
      current: state.current.id === agentId ? Ascuita : state.current,
    }));
  },
}));

/**
 * UI
 */
export type SceneTheme = 'dark' | 'light';

export const useUI = create<{
  showUserConfig: boolean;
  setShowUserConfig: (show: boolean) => void;
  showSettingsPanel: boolean;
  setShowSettingsPanel: (show: boolean) => void;
  showSpeechAnimationConfig: boolean;
  setShowSpeechAnimationConfig: (show: boolean) => void;
  showSidebar: boolean;
  setShowSidebar: (show: boolean) => void;
  toggleSidebar: () => void;
  sceneTheme: SceneTheme;
  setSceneTheme: (theme: SceneTheme) => void;
}>(set => ({
  showUserConfig: false,
  setShowUserConfig: (show: boolean) => set({ showUserConfig: show }),
  showSettingsPanel: false,
  setShowSettingsPanel: (show: boolean) => set({ showSettingsPanel: show }),
  showSpeechAnimationConfig: false,
  setShowSpeechAnimationConfig: (show: boolean) =>
    set({ showSpeechAnimationConfig: show }),
  showSidebar: true,
  setShowSidebar: (show: boolean) => set({ showSidebar: show }),
  toggleSidebar: () => set(state => ({ showSidebar: !state.showSidebar })),
  sceneTheme: 'dark',
  setSceneTheme: (theme: SceneTheme) => set({ sceneTheme: theme }),
}));

export const useAuthGate = create<{
  authReady: boolean;
  authToken: string | null;
  isAuthenticated: boolean;
  userName: string;
  trialExpired: boolean;
  introPlaying: boolean;
  setAuthState: (state: {
    authReady: boolean;
    authToken: string | null;
    isAuthenticated: boolean;
    userName?: string;
  }) => void;
  setTrialExpired: (expired: boolean) => void;
  setIntroPlaying: (playing: boolean) => void;
}>(set => ({
  authReady: false,
  authToken: null,
  isAuthenticated: false,
  userName: '',
  trialExpired: false,
  introPlaying: false,
  setAuthState: state =>
    set(prev => ({
      authReady: state.authReady,
      authToken: state.authToken,
      isAuthenticated: state.isAuthenticated,
      userName: state.userName || '',
      trialExpired: state.isAuthenticated ? false : prev.trialExpired,
    })),
  setTrialExpired: expired => set({ trialExpired: expired }),
  setIntroPlaying: playing => set({ introPlaying: playing }),
}));

export type ResumeConversationMessage = {
  role: 'user' | 'assistant';
  text: string;
};

export type ResumeConversationState = {
  conversationId: string;
  agentId: string;
  agentName: string;
  messages: ResumeConversationMessage[];
};

export const useConversationResume = create<{
  pending: ResumeConversationState | null;
  setPending: (conversation: ResumeConversationState) => void;
  clearPending: () => void;
}>(set => ({
  pending: null,
  setPending: conversation => set({ pending: conversation }),
  clearPending: () => set({ pending: null }),
}));
