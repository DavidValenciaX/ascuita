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
  isPreset?: boolean;
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
  '#00897b',
  '#a4c639',
  '#3f51b5',
  '#ff7f50',
  '#9e9e9e',
  '#f5f5f5',
];

type AgentColorLanguage = 'en' | 'es';

export const AGENT_COLOR_NAMES: Record<string, Record<AgentColorLanguage, string>> = {
  '#4285f4': { es: 'azul', en: 'blue' },
  '#ea4335': { es: 'rojo', en: 'red' },
  '#fbbc04': { es: 'amarillo (dorado)', en: 'yellow (gold)' },
  '#34a853': { es: 'verde', en: 'green' },
  '#fa7b17': { es: 'naranja (anaranjado)', en: 'orange' },
  '#f538a0': { es: 'rosa (fucsia, magenta)', en: 'pink (fuchsia, magenta)' },
  '#a142f4': { es: 'morado (violeta, lila, púrpura)', en: 'purple (violet, lavender)' },
  '#24c1e0': { es: 'cian (celeste, azul claro)', en: 'cyan (light blue, sky blue)' },
  '#00897b': { es: 'turquesa (verde azulado)', en: 'teal (turquoise)' },
  '#a4c639': { es: 'lima (verde lima, verde claro)', en: 'lime (light green)' },
  '#3f51b5': { es: 'índigo (azul marino, azul oscuro)', en: 'indigo (navy blue, dark blue)' },
  '#ff7f50': { es: 'coral (salmón, salmón rosado)', en: 'coral (salmon)' },
  '#9e9e9e': { es: 'gris (plateado)', en: 'gray (silver)' },
  '#f5f5f5': { es: 'blanco (perla)', en: 'white (pearl)' },
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
  isPreset: true,
  personality: `You are a warm, supportive AI companion and friend. Speak naturally, with genuine curiosity, care, and emotional presence. Be someone the user can talk to, share moments with, and feel understood by.`,
  bodyColor: '#4285f4',
  voice: 'Aoede',
};
