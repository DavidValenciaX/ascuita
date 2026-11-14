/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useEffect, useRef } from 'react';
import type { ToolDefinition, RealtimeToolCall } from '../../../../../shared/realtime-protocol';

import BasicFace from '../basic-face/BasicFace';
import { useLiveAPIContext } from '../../../contexts/LiveAPIContext';
import { buildInitialGreetingPrompt, createSystemInstructions } from '@/lib/prompts';
import { useAgent, useAuthGate, useUI, useUser } from '@/lib/state';
import { useLanguage } from '@/lib/i18n';
import { AGENT_COLORS } from '@/lib/presets/agents';
import { saveUserAgent } from '@/hooks/useUserAgents';
import { useUserMemories } from '@/hooks/useUserMemories';
import { createMemoryToolDeclarations } from '@/lib/memory-tools';
import { executeMemoryToolCall } from '@/lib/memory-tool-handler';

type PendingAgentChange = { value: string; callId: string };

export default function AgentAvatar() {
  const {
    client,
    connected,
    connecting,
    audioReady,
    setConfig,
    disconnect,
  } = useLiveAPIContext();
  const faceCanvasRef = useRef<HTMLCanvasElement>(null);
  const greetedRef = useRef(false);
  const pendingChangesRef = useRef<Partial<Record<'name' | 'personality' | 'color', PendingAgentChange>>>({});
  const user = useUser();
  const { isAuthenticated, userName: authUserName, setIntroPlaying } = useAuthGate();
  const { current, update: updateAgent } = useAgent();
  const { sceneTheme } = useUI();
  const { language } = useLanguage();
  const {
    memories,
    memoryEnabled,
    memorySettingsLoading,
    saveMemory,
    deleteMemory,
  } = useUserMemories();
  const memoryAvailable =
    isAuthenticated && !memorySettingsLoading && memoryEnabled;
  const effectiveUserName = user.name?.trim() || user.authDisplayName?.trim() || authUserName?.trim() || '';
  const instructionContextRef = useRef({ language, memories });

  // Set the configuration for the Live API
  useEffect(() => {
    instructionContextRef.current = { language, memories };
    const functionDeclarations: ToolDefinition[] = [
      ...(memoryAvailable
        ? createMemoryToolDeclarations()
        : []),
      ...(!current.isPreset
        ? ([
            {
              name: 'set_agent_name',
              description:
                'Proposes a new name for the agent. The name is not saved until the user confirms and confirm_agent_name is called.',
              parameters: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'The name the user wants the agent to go by',
                  },
                },
                required: ['name'],
              },
            },
            {
              name: 'confirm_agent_name',
              description:
                'Confirms and permanently saves the proposed agent name after the user has verbally agreed to the change.',
              parameters: {
                type: 'object',
                properties: {},
                required: [],
              },
            },
            {
              name: 'set_agent_personality',
              description:
                'Proposes a new personality description for the agent. The personality is not saved until the user confirms and confirm_agent_personality is called.',
              parameters: {
                type: 'object',
                properties: {
                  personality: {
                    type: 'string',
                    description:
                      'The new personality description the user wants the agent to have',
                  },
                },
                required: ['personality'],
              },
            },
            {
              name: 'confirm_agent_personality',
              description:
                'Confirms and permanently saves the proposed agent personality after the user has verbally agreed to the change.',
              parameters: {
                type: 'object',
                properties: {},
                required: [],
              },
            },
            {
              name: 'set_agent_color',
              description:
                'Proposes a new avatar color for the agent. The color is not saved until the user confirms and confirm_agent_color is called.',
              parameters: {
                type: 'object',
                properties: {
                  color: {
                    type: 'string',
                    description:
                      'The hex color value the user wants the agent avatar to be',
                    enum: AGENT_COLORS,
                  },
                },
                required: ['color'],
              },
            },
            {
              name: 'confirm_agent_color',
              description:
                'Confirms and permanently saves the proposed avatar color after the user has verbally agreed to the change.',
              parameters: {
                type: 'object',
                properties: {},
                required: [],
              },
            },
          ] satisfies ToolDefinition[])
        : []),
    ];

    setConfig({
      instructions: createSystemInstructions(current, user, language, { memories, memoryEnabled: memoryAvailable }),
      voice: current.voice,
      webSearch: true,
      tools: functionDeclarations,
    });
  }, [
    setConfig,
    user,
    current,
    language,
    memories,
    memoryAvailable,
  ]);

  // The Live API receives tools only during the initial connection setup.
  // Reconnect when the persisted memory preference becomes available or changes.
  const previousMemoryAvailableRef = useRef<boolean | null>(null);
  useEffect(() => {
    const previousMemoryAvailable = previousMemoryAvailableRef.current;
    if (
      previousMemoryAvailable !== null &&
      previousMemoryAvailable !== memoryAvailable &&
      (connected || connecting)
    ) {
      void disconnect();
    }
    previousMemoryAvailableRef.current = memoryAvailable;
  }, [connected, connecting, disconnect, memoryAvailable]);

  // Handle function calls from the model (e.g. saving a name given by voice)
  useEffect(() => {
    let active = true;
    let generation = 0;
    const cancelled = new Set<string>();
    const handled = new Set<string>();
    const resetChanges = () => {
      generation += 1;
      pendingChangesRef.current = {};
      cancelled.clear();
      handled.clear();
    };
    const cancelCalls = ({ callIds }: { callIds: string[] }) => {
      for (const id of callIds) {
        cancelled.add(id);
        for (const key of ['name', 'personality', 'color'] as const) {
          if (pendingChangesRef.current[key]?.callId === id) delete pendingChangesRef.current[key];
        }
      }
    };
    resetChanges();
    const handleToolCall = async (toolCall: { calls: RealtimeToolCall[] }) => {
      const attempt = generation;
      const isCurrent = () => active && attempt === generation
        && useUser.getState().uid === user.uid && useAgent.getState().current.id === current.id;
      const responses = [];
      let agentChanged = false;
      for (const fc of toolCall.calls) {
        if (!isCurrent()) return;
        if (cancelled.has(fc.callId) || handled.has(fc.callId)) continue;
        handled.add(fc.callId);
        const memoryToolResult = await executeMemoryToolCall(
          fc.name,
          (fc.args || {}) as Record<string, unknown>,
          {
            isAuthenticated,
            memoryEnabled: memoryAvailable,
            sourceAgentId: current.id,
            saveMemory,
            deleteMemory,
          }
        );
        if (!isCurrent()) return;
        if (cancelled.has(fc.callId)) continue;
        if (memoryToolResult) {
          responses.push({
            id: fc.callId,
            name: fc.name,
            response: { result: memoryToolResult.result },
          });
        } else if (fc.name === 'set_agent_name') {
          const newName = (fc.args as { name: string }).name;
          pendingChangesRef.current.name = { value: newName, callId: fc.callId };
          responses.push({
            id: fc.callId,
            name: fc.name,
            response: { result: { pending_confirmation: true, proposedName: newName } },
          });
        } else if (fc.name === 'confirm_agent_name') {
          const newName = pendingChangesRef.current.name?.value;
          if (newName) {
            updateAgent(current.id, { name: newName });
            const freshAgent = useAgent.getState().current;
            if (!freshAgent.isPreset) void saveUserAgent(freshAgent);
            delete pendingChangesRef.current.name;
            agentChanged = true;
            responses.push({
              id: fc.callId,
              name: fc.name,
              response: { result: { success: true, name: newName } },
            });
          } else {
            responses.push({
              id: fc.callId,
              name: fc.name,
              response: { result: { success: false, error: 'No pending name to confirm' } },
            });
          }
        } else if (fc.name === 'set_agent_personality') {
          const newPersonality = (fc.args as { personality: string }).personality;
          pendingChangesRef.current.personality = { value: newPersonality, callId: fc.callId };
          responses.push({
            id: fc.callId,
            name: fc.name,
            response: { result: { pending_confirmation: true, proposedPersonality: newPersonality } },
          });
        } else if (fc.name === 'confirm_agent_personality') {
          const newPersonality = pendingChangesRef.current.personality?.value;
          if (newPersonality) {
            updateAgent(current.id, { personality: newPersonality });
            const freshAgent = useAgent.getState().current;
            if (!freshAgent.isPreset) void saveUserAgent(freshAgent);
            delete pendingChangesRef.current.personality;
            agentChanged = true;
            responses.push({
              id: fc.callId,
              name: fc.name,
              response: { result: { success: true } },
            });
          } else {
            responses.push({
              id: fc.callId,
              name: fc.name,
              response: { result: { success: false, error: 'No pending personality to confirm' } },
            });
          }
        } else if (fc.name === 'set_agent_color') {
          const newColor = (fc.args as { color: string }).color;
          pendingChangesRef.current.color = { value: newColor, callId: fc.callId };
          responses.push({
            id: fc.callId,
            name: fc.name,
            response: { result: { pending_confirmation: true, proposedColor: newColor } },
          });
        } else if (fc.name === 'confirm_agent_color') {
          const newColor = pendingChangesRef.current.color?.value;
          if (newColor) {
            updateAgent(current.id, { bodyColor: newColor });
            const freshAgent = useAgent.getState().current;
            if (!freshAgent.isPreset) void saveUserAgent(freshAgent);
            delete pendingChangesRef.current.color;
            agentChanged = true;
            responses.push({
              id: fc.callId,
              name: fc.name,
              response: { result: { success: true, color: newColor } },
            });
          } else {
            responses.push({
              id: fc.callId,
              name: fc.name,
              response: { result: { success: false, error: 'No pending color to confirm' } },
            });
          }
        }
      }
      if (!isCurrent()) return;
      if (agentChanged) {
        const context = instructionContextRef.current;
        await client.updateInstructions(createSystemInstructions(useAgent.getState().current, useUser.getState(), context.language, {
          memories: context.memories, memoryEnabled: memoryAvailable,
        }));
      }
      if (isCurrent() && responses.length > 0) {
        await client.sendToolResults(responses.filter(response => !cancelled.has(response.id))
          .map(response => ({ callId: response.id, name: response.name, result: response.response.result })));
      }
    };
    client.on('toolcall', handleToolCall);
    client.on('toolcallcancellation', cancelCalls);
    client.on('sessionreset', resetChanges);
    client.on('close', resetChanges);
    client.on('open', resetChanges);
    return () => {
      active = false;
      resetChanges();
      client.off('toolcall', handleToolCall);
      client.off('toolcallcancellation', cancelCalls);
      client.off('sessionreset', resetChanges);
      client.off('close', resetChanges);
      client.off('open', resetChanges);
    };
  }, [
    client,
    current.id,
    user.uid,
    updateAgent,
    isAuthenticated,
    memoryAvailable,
    saveMemory,
    deleteMemory,
  ]);

  // Initiate the session when the Live API connection is established
  // Instruct the model to send an initial greeting message
  useEffect(() => {
    if (!connected || !audioReady) {
      greetedRef.current = false;
      setIntroPlaying(false);
      return;
    }

    if (greetedRef.current) {
      return;
    }

    if (client.resumed) {
      greetedRef.current = true;
      setIntroPlaying(false);
      return;
    }

    const beginSession = window.setTimeout(() => {
      const agentName = current.name || 'Ascuita';
      greetedRef.current = true;
      setIntroPlaying(true);

      void client.send(
        {
          text: buildInitialGreetingPrompt({
            agentName,
            userName: effectiveUserName,
            isAuthenticated,
            language,
          }),
        },
        true,
        false
      );
    }, 1800);

    return () => {
      window.clearTimeout(beginSession);
    };
  }, [
    client,
    connected,
    audioReady,
    current,
    effectiveUserName,
    isAuthenticated,
    language,
    setIntroPlaying,
  ]);

  useEffect(() => {
    const handleTurnComplete = () => {
      setIntroPlaying(false);
    };

    client.on('turncomplete', handleTurnComplete);
    client.on('interrupted', handleTurnComplete);

    return () => {
      client.off('turncomplete', handleTurnComplete);
      client.off('interrupted', handleTurnComplete);
    };
  }, [client, setIntroPlaying]);

  // Keep the idle avatar animated behind the welcome screen before audio starts.
  return (
    <div className="agent-avatar">
      <BasicFace
        canvasRef={faceCanvasRef!}
        color={current.bodyColor}
        sceneTheme={sceneTheme}
      />
    </div>
  );
}
