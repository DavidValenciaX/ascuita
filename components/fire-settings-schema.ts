import { InnerFireConfig } from '@/lib/fire/config';

export type FireNumericSectionKey = 'transform' | 'particles' | 'color' | 'texture' | 'scale';

export type NumericSliderDef<TSection extends Record<string, number>> = {
  key: keyof TSection & string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
};

export type FireSliderSectionSchema = {
  [TSectionKey in FireNumericSectionKey]: {
    kind: 'sliders';
    key: TSectionKey;
    title: string;
    contentClassName?: string;
    controls: NumericSliderDef<InnerFireConfig[TSectionKey]>[];
  };
}[FireNumericSectionKey];

export type FirePaletteSectionSchema = {
  kind: 'palette';
  key: 'palette';
  title: string;
  contentClassName: null;
};

export type FireSettingsSectionSchema = FireSliderSectionSchema | FirePaletteSectionSchema;

const positionControls: NumericSliderDef<InnerFireConfig['transform']>[] = [
  { key: 'x', label: 'Fuego X', min: -2, max: 2, step: 0.01 },
  { key: 'y', label: 'Fuego Y', min: -2, max: 2, step: 0.01 },
  { key: 'z', label: 'Fuego Z', min: -2, max: 2, step: 0.01 },
];

const particleControls: NumericSliderDef<InnerFireConfig['particles']>[] = [
  { key: 'count', label: 'Cantidad de particulas', min: 200, max: 4000, step: 100 },
  { key: 'spawnRadius', label: 'Radio de emision', min: 0.05, max: 0.8, step: 0.01 },
  { key: 'spawnHeight', label: 'Altura de emision', min: 0.2, max: 2.5, step: 0.01 },
  { key: 'velXZ', label: 'Velocidad X/Z', min: 0, max: 0.05, step: 0.001 },
  { key: 'velYBase', label: 'Velocidad Y base', min: 0, max: 0.08, step: 0.001 },
  { key: 'velYRand', label: 'Velocidad Y aleatoria', min: 0, max: 0.1, step: 0.001 },
  { key: 'lifetimeSpeed', label: 'Velocidad de ciclo', min: 0.002, max: 0.05, step: 0.001 },
  { key: 'sway', label: 'Balanceo', min: 0, max: 0.02, step: 0.0005 },
  { key: 'swaySpeed', label: 'Velocidad de balanceo', min: 0, max: 20, step: 0.5 },
  { key: 'taper', label: 'Factor de cierre', min: 0.9, max: 1, step: 0.001 },
  { key: 'size', label: 'Tamano de particula', min: 0.05, max: 0.8, step: 0.01 },
  { key: 'opacity', label: 'Opacidad', min: 0.1, max: 1, step: 0.01 },
];

const colorControls: NumericSliderDef<InnerFireConfig['color']>[] = [
  { key: 'threshold1', label: 'Etapa 1 a 2', min: 0, max: 0.5, step: 0.01 },
  { key: 'threshold2', label: 'Etapa 2 a 3', min: 0.1, max: 0.8, step: 0.01 },
  { key: 'threshold3', label: 'Etapa 3 a 4', min: 0.4, max: 1, step: 0.01 },
];

const textureControls: NumericSliderDef<InnerFireConfig['texture']>[] = [
  { key: 'size', label: 'Resolucion de textura', min: 16, max: 256, step: 16 },
  { key: 'coreOpacity', label: 'Opacidad del nucleo', min: 0.1, max: 1, step: 0.1 },
  { key: 'midOpacity', label: 'Opacidad media', min: 0, max: 1, step: 0.1 },
  { key: 'midStop', label: 'Posicion media', min: 0, max: 1, step: 0.01 },
  { key: 'edgeOpacity', label: 'Opacidad de borde', min: 0, max: 0.5, step: 0.05 },
];

const scaleControls: NumericSliderDef<InnerFireConfig['scale']>[] = [
  { key: 'idleXZ', label: 'Escala reposo X/Z', min: 0.3, max: 2, step: 0.01 },
  { key: 'idleY', label: 'Escala reposo Y', min: 0.3, max: 2, step: 0.01 },
  { key: 'talkingXZ', label: 'Escala al hablar X/Z', min: 0.3, max: 2.5, step: 0.01 },
  { key: 'talkingY', label: 'Escala al hablar Y', min: 0.3, max: 2.5, step: 0.01 },
];

export const FIRE_SETTINGS_SECTIONS: FireSettingsSectionSchema[] = [
  {
    kind: 'sliders',
    key: 'transform',
    title: 'Posicion',
    contentClassName: 'settingsPanel__fireGrid settingsPanel__fireGrid--three',
    controls: positionControls,
  },
  {
    kind: 'palette',
    key: 'palette',
    title: 'Paleta',
    contentClassName: null,
  },
  {
    kind: 'sliders',
    key: 'particles',
    title: 'Sistema de particulas',
    controls: particleControls,
  },
  {
    kind: 'sliders',
    key: 'color',
    title: 'Umbrales de color',
    contentClassName: 'settingsPanel__fireGrid settingsPanel__fireGrid--three',
    controls: colorControls,
  },
  {
    kind: 'sliders',
    key: 'texture',
    title: 'Textura',
    contentClassName: 'settingsPanel__fireGrid settingsPanel__fireGrid--three',
    controls: textureControls,
  },
  {
    kind: 'sliders',
    key: 'scale',
    title: 'Respuesta al habla',
    contentClassName: 'settingsPanel__fireGrid settingsPanel__fireGrid--two',
    controls: scaleControls,
  },
];
