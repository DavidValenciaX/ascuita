/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { create } from 'zustand';
import { Agent, Companion } from './presets/agents';

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
 * User
 */
export type User = {
  name?: string;
  info?: string;
};

export const useUser = create<
  {
    setName: (name: string) => void;
    setInfo: (info: string) => void;
  } & User
>(set => ({
  name: '',
  info: '',
  setName: name => set({ name }),
  setInfo: info => set({ info }),
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
}>(set => ({
  current: Companion,
  availablePresets: [Companion],
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
}));

/**
 * UI
 */
export const useUI = create<{
  showUserConfig: boolean;
  setShowUserConfig: (show: boolean) => void;
  showSettingsPanel: boolean;
  setShowSettingsPanel: (show: boolean) => void;
}>(set => ({
  showUserConfig: false,
  setShowUserConfig: (show: boolean) => set({ showUserConfig: show }),
  showSettingsPanel: false,
  setShowSettingsPanel: (show: boolean) => set({ showSettingsPanel: show }),
}));
