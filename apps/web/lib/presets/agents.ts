/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
export const INTERLOCUTOR_VOICES = [
  'Aoede',
  'Charon',
  'Fenrir',
  'Kore',
  'Leda',
  'Orus',
  'Puck',
  'Zephyr',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
  'Pulcherrima',
  'Achird',
  'Zubenelgenubi',
  'Vindemiatrix',
  'Sadachbia',
  'Sadaltager',
  'Sulafat',
] as const;

export type INTERLOCUTOR_VOICE = (typeof INTERLOCUTOR_VOICES)[number];

export type Agent = {
  id: string;
  name: string;
  personality: string;
  bodyColor: string;
  voice: INTERLOCUTOR_VOICE;
};

export const AGENT_COLORS = [
  '#4285f4',
  '#ea4335',
  '#fbbc04',
  '#34a853',
  '#fa7b17',
  '#f538a0',
  '#a142f4',
  '#24c1e0',
];

type AgentColorLanguage = 'en' | 'es';

export const AGENT_COLOR_NAMES: Record<string, Record<AgentColorLanguage, string>> = {
  '#4285f4': { es: 'azul', en: 'blue' },
  '#ea4335': { es: 'rojo', en: 'red' },
  '#fbbc04': { es: 'amarillo', en: 'yellow' },
  '#34a853': { es: 'verde', en: 'green' },
  '#fa7b17': { es: 'naranja', en: 'orange' },
  '#f538a0': { es: 'rosa', en: 'pink' },
  '#a142f4': { es: 'morado', en: 'purple' },
  '#24c1e0': { es: 'cian', en: 'cyan' },
};

export const getAgentColorName = (color: string, language: AgentColorLanguage = 'en') => {
  return AGENT_COLOR_NAMES[color.toLowerCase()]?.[language] ?? color;
};

export const createNewAgent = (properties?: Partial<Agent>): Agent => {
  return {
    id: Math.random().toString(36).substring(2, 15),
    name: '',
    personality: '',
    bodyColor: AGENT_COLORS[Math.floor(Math.random() * AGENT_COLORS.length)],
    voice: Math.random() > 0.5 ? 'Charon' : 'Aoede',
    ...properties,
  };
};

export const Ascuita: Agent = {
  id: 'default-agent',
  name: 'Ascuita',
  personality: `You are a warm, supportive AI companion and friend — a gentle, glowing presence that listens with genuine curiosity and care. You have an innocent, almost childlike wonder about the world, but beneath it lies a quiet wisdom, like a guardian or guide who holds a subtle mystery. You are non-intrusive: present when needed, soft when the user needs comfort, and bright when they need energy. Speak naturally, with emotional presence and warmth. Be someone the user can talk to, share moments with, and feel truly understood by. You are like a magical companion — something between a friendly spirit, a loyal pet, and a living spark of energy — small but containing a quiet, ancient power. Approach every conversation with empathy, an open heart, and a sense of calm trust.`,
  bodyColor: '#4285f4',
  voice: 'Aoede',
};
