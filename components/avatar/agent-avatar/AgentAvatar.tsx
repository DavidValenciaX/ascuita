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
import { useAgent, useUser } from '@/lib/state';
import { useLanguage } from '@/lib/i18n';

export default function AgentAvatar() {
  const { client, connected, setConfig } = useLiveAPIContext();
  const faceCanvasRef = useRef<HTMLCanvasElement>(null);
  const user = useUser();
  const { current, update: updateAgent } = useAgent();
  const { language } = useLanguage();

  // Set the configuration for the Live API
  useEffect(() => {
    setConfig({
      responseModalities: [Modality.AUDIO],
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
        {
          functionDeclarations: [
            {
              name: 'set_agent_name',
              description: 'Saves the name the user gives to the assistant so it persists for the rest of the conversation.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  name: {
                    type: Type.STRING,
                    description: 'The name to assign to this assistant',
                  },
                },
                required: ['name'],
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
          updateAgent(current.id, { name: newName });
          responses.push({
            id: fc.id as string,
            name: fc.name,
            response: { result: { success: true, name: newName } },
          });
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
    const beginSession = async () => {
      if (!connected) return;
      client.send(
        {
          text: language === 'es'
            ? 'Saluda al usuario y preséntate, explicando tu rol.'
            : 'Greet the user and introduce yourself and your role.',
        },
        true
      );
    };
    beginSession();
  }, [client, connected, language]);

  return (
    <div className="agent-avatar">
      <BasicFace canvasRef={faceCanvasRef!} color={current.bodyColor} />
    </div>
  );
}
