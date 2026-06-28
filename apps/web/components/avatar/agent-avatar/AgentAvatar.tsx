/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useEffect, useRef } from 'react';
import { Modality, Type } from '@google/genai';
import { LiveServerToolCall } from '@google/genai';

import BasicFace from '../basic-face/BasicFace';
import { useLiveAPIContext } from '../../../contexts/LiveAPIContext';
import { createSystemInstructions } from '@/lib/prompts';
import { useAgent, useAuthGate, useConversationResume, useUI, useUser } from '@/lib/state';
import { useLanguage } from '@/lib/i18n';

function buildResumePrompt(
  language: 'es' | 'en',
  agentName: string,
  messages: Array<{ role: 'user' | 'assistant'; text: string }>
) {
  const transcript = messages
    .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text}`)
    .join('\n\n');

  if (language === 'es') {
    return [
      `Retoma esta conversacion previa como ${agentName}.`,
      'No te presentes de nuevo ni reinicies el tono.',
      'Usa el siguiente historial solo como contexto para continuar de forma natural desde donde se quedo la charla.',
      'Si el ultimo mensaje es del asistente, continua con una respuesta breve que avance la conversacion.',
      '',
      'Historial:',
      transcript,
    ].join('\n');
  }

  return [
    `Resume this earlier conversation as ${agentName}.`,
    'Do not introduce yourself again or restart the tone.',
    'Use the following transcript only as context so you can continue naturally from where the chat left off.',
    'If the last message is from the assistant, continue with a brief reply that moves the conversation forward.',
    '',
    'Transcript:',
    transcript,
  ].join('\n');
}

export default function AgentAvatar() {
  const { client, connected, setConfig } = useLiveAPIContext();
  const faceCanvasRef = useRef<HTMLCanvasElement>(null);
  const greetedRef = useRef(false);
  const pendingNameRef = useRef<string | null>(null);
  const pendingPersonalityRef = useRef<string | null>(null);
  const user = useUser();
  const { setIntroPlaying } = useAuthGate();
  const { current, update: updateAgent } = useAgent();
  const pendingResume = useConversationResume(state => state.pending);
  const clearPendingResume = useConversationResume(state => state.clearPending);
  const { sceneTheme } = useUI();
  const { language } = useLanguage();

  // Set the configuration for the Live API
  useEffect(() => {
    setConfig({
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: current.voice },
        },
      },
      systemInstruction: {
        parts: [
          {
            text: createSystemInstructions(current, user, language),
          },
        ],
      },
      tools: [
        { googleSearch: {} },
        {
          functionDeclarations: [
            {
              name: 'set_agent_name',
              description: 'Proposes a new name for the agent. The name is not saved until the user confirms and confirm_agent_name is called.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  name: {
                    type: Type.STRING,
                    description: 'The name the user wants the agent to go by',
                  },
                },
                required: ['name'],
              },
            },
            {
              name: 'confirm_agent_name',
              description: 'Confirms and permanently saves the proposed agent name after the user has verbally agreed to the change.',
              parameters: {
                type: Type.OBJECT,
                properties: {},
                required: [],
              },
            },
            {
              name: 'set_agent_personality',
              description: 'Proposes a new personality description for the agent. The personality is not saved until the user confirms and confirm_agent_personality is called.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  personality: {
                    type: Type.STRING,
                    description: 'The new personality description the user wants the agent to have',
                  },
                },
                required: ['personality'],
              },
            },
            {
              name: 'confirm_agent_personality',
              description: 'Confirms and permanently saves the proposed agent personality after the user has verbally agreed to the change.',
              parameters: {
                type: Type.OBJECT,
                properties: {},
                required: [],
              },
            },
          ],
        },
      ],
    });
  }, [setConfig, user, current, language]);

  // Handle function calls from the model (e.g. saving a name given by voice)
  useEffect(() => {
    const handleToolCall = async (toolCall: LiveServerToolCall) => {
      const responses = [];
      for (const fc of toolCall.functionCalls ?? []) {
        if (fc.name === 'set_agent_name') {
          const newName = (fc.args as { name: string }).name;
          pendingNameRef.current = newName;
          responses.push({
            id: fc.id as string,
            name: fc.name,
            response: { result: { pending_confirmation: true, proposedName: newName } },
          });
        } else if (fc.name === 'confirm_agent_name') {
          const newName = pendingNameRef.current;
          if (newName) {
            updateAgent(current.id, { name: newName });
            pendingNameRef.current = null;
            responses.push({
              id: fc.id as string,
              name: fc.name,
              response: { result: { success: true, name: newName } },
            });
          } else {
            responses.push({
              id: fc.id as string,
              name: fc.name,
              response: { result: { success: false, error: 'No pending name to confirm' } },
            });
          }
        } else if (fc.name === 'set_agent_personality') {
          const newPersonality = (fc.args as { personality: string }).personality;
          pendingPersonalityRef.current = newPersonality;
          responses.push({
            id: fc.id as string,
            name: fc.name,
            response: { result: { pending_confirmation: true, proposedPersonality: newPersonality } },
          });
        } else if (fc.name === 'confirm_agent_personality') {
          const newPersonality = pendingPersonalityRef.current;
          if (newPersonality) {
            updateAgent(current.id, { personality: newPersonality });
            pendingPersonalityRef.current = null;
            responses.push({
              id: fc.id as string,
              name: fc.name,
              response: { result: { success: true } },
            });
          } else {
            responses.push({
              id: fc.id as string,
              name: fc.name,
              response: { result: { success: false, error: 'No pending personality to confirm' } },
            });
          }
        }
      }
      if (responses.length > 0) {
        await client.sendToolResponse({ functionResponses: responses });
      }
    };
    client.on('toolcall', handleToolCall);
    return () => {
      client.off('toolcall', handleToolCall);
    };
  }, [client, current.id, updateAgent]);

  // Initiate the session when the Live API connection is established
  // Instruct the model to send an initial greeting message
  useEffect(() => {
    if (!connected) {
      greetedRef.current = false;
      setIntroPlaying(false);
      return;
    }

    if (greetedRef.current) {
      return;
    }

    const beginSession = window.setTimeout(() => {
      const agentName = current.name || 'Ascuita';
      greetedRef.current = true;
      setIntroPlaying(true);
      if (pendingResume && pendingResume.messages.length > 0) {
        void client.send(
          {
            text: buildResumePrompt(
              language,
              pendingResume.agentName || agentName,
              pendingResume.messages
            ),
          },
          true,
          false
        );
        clearPendingResume();
        return;
      }

      void client.send(
        {
          text: language === 'es'
            ? `Saluda al usuario de forma calida y natural. Presentate como ${agentName}, explica tu rol en una sola idea corta y termina con una pregunta sencilla para invitar a conversar.`
            : `Greet the user warmly and naturally. Introduce yourself as ${agentName}, explain your role in one short idea, and end with a simple question that invites conversation.`,
        },
        true,
        false
      );
    }, 1800);

    return () => {
      window.clearTimeout(beginSession);
    };
  }, [client, clearPendingResume, connected, current, language, pendingResume, setIntroPlaying]);

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
