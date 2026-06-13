import { ChangeEvent, ReactNode, useMemo, useRef } from 'react';
import {
  cloneInnerFireConfig,
  defaultInnerFireConfig,
  DeepPartial,
  FIRE_PALETTES,
  FirePaletteId,
  InnerFireConfig,
} from '@/lib/fire/config';
import { useInnerFire } from '@/lib/state';
import FireSliderControl, { NumericSliderDef } from './FireSliderControl';
import FireSliderSection from './FireSliderSection';

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

function exportConfig(config: InnerFireConfig) {
  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'ascuita-fire-config.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

type FireSectionMeta = {
  title: string;
  content: ReactNode;
  contentClassName?: string | null;
};

type FireNumericSectionKey = 'transform' | 'particles' | 'color' | 'texture' | 'scale';

export default function FireSettingsTab() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { config, updateConfig, replaceConfig, resetConfig } = useInnerFire();

  const paletteEntries = useMemo(
    () => Object.entries(FIRE_PALETTES) as [FirePaletteId, (typeof FIRE_PALETTES)[FirePaletteId]][],
    []
  );

  function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = loadEvent => {
      try {
        const parsed = JSON.parse(String(loadEvent.target?.result ?? '')) as InnerFireConfig;
        replaceConfig(parsed);
      } catch (error) {
        console.error('No se pudo importar la configuracion del fuego.', error);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function createSectionUpdater<TSectionKey extends FireNumericSectionKey>(sectionKey: TSectionKey) {
    return <K extends keyof InnerFireConfig[TSectionKey]>(
      key: K,
      value: InnerFireConfig[TSectionKey][K]
    ) => {
      const nextSection: InnerFireConfig[TSectionKey] = {
        ...config[sectionKey],
      };
      nextSection[key] = value;

      const nextPatch: DeepPartial<InnerFireConfig> = {};
      nextPatch[sectionKey] = nextSection;

      updateConfig(nextPatch);
    };
  }

  function renderSliderControls<TSection extends Record<string, number>>(
    values: TSection,
    controls: NumericSliderDef<TSection>[],
    onChange: <K extends keyof TSection>(key: K, value: TSection[K]) => void
  ) {
    return controls.map(control => (
      <FireSliderControl
        key={control.key}
        label={control.label}
        value={values[control.key]}
        min={control.min}
        max={control.max}
        step={control.step}
        unit={control.unit}
        onChange={value => onChange(control.key, value as TSection[typeof control.key])}
      />
    ));
  }

  const updateTransformValue = createSectionUpdater('transform');
  const updateParticleValue = createSectionUpdater('particles');
  const updateColorValue = createSectionUpdater('color');
  const updateTextureValue = createSectionUpdater('texture');
  const updateScaleValue = createSectionUpdater('scale');

  const fireSections: FireSectionMeta[] = [
    {
      title: 'Posicion',
      contentClassName: 'settingsPanel__fireGrid settingsPanel__fireGrid--three',
      content: renderSliderControls(config.transform, positionControls, updateTransformValue),
    },
    {
      title: 'Paleta',
      contentClassName: null,
      content: (
        <label className="settingsPanel__fireControl">
          <span>
            <strong>Estilo de fuego</strong>
            <output>{FIRE_PALETTES[config.palette.selected].label}</output>
          </span>
          <select
            value={config.palette.selected}
            onChange={event =>
              updateConfig({
                palette: { selected: event.target.value as FirePaletteId },
              })
            }
          >
            {paletteEntries.map(([id, palette]) => (
              <option key={id} value={id}>
                {palette.label}
              </option>
            ))}
          </select>
          <small>{FIRE_PALETTES[config.palette.selected].description}</small>
        </label>
      ),
    },
    {
      title: 'Sistema de particulas',
      content: renderSliderControls(config.particles, particleControls, updateParticleValue),
    },
    {
      title: 'Umbrales de color',
      contentClassName: 'settingsPanel__fireGrid settingsPanel__fireGrid--three',
      content: renderSliderControls(config.color, colorControls, updateColorValue),
    },
    {
      title: 'Textura',
      contentClassName: 'settingsPanel__fireGrid settingsPanel__fireGrid--three',
      content: renderSliderControls(config.texture, textureControls, updateTextureValue),
    },
    {
      title: 'Respuesta al habla',
      contentClassName: 'settingsPanel__fireGrid settingsPanel__fireGrid--two',
      content: renderSliderControls(config.scale, scaleControls, updateScaleValue),
    },
  ];

  return (
    <div className="settingsPanel__tab">
      <div className="settingsPanel__tabHeader">
        <div>
          <h2>Fuego interno</h2>
          <p className="settingsPanel__desc">
            Controles adaptados del modulo de `fuego`, integrados al avatar de Ascuita.
          </p>
        </div>
        <button type="button" className="button" onClick={resetConfig}>
          Restaurar
        </button>
      </div>

      {fireSections.map(section => (
        <FireSliderSection
          key={section.title}
          title={section.title}
          contentClassName={section.contentClassName}
        >
          {section.content}
        </FireSliderSection>
      ))}

      <div className="settingsPanel__fireActions">
        <button
          type="button"
          className="button"
          onClick={() => exportConfig(config)}
        >
          <span className="icon">download</span>
          Exportar
        </button>
        <button
          type="button"
          className="button"
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="icon">upload</span>
          Importar
        </button>
        <button
          type="button"
          className="button"
          onClick={() => replaceConfig(cloneInnerFireConfig(defaultInnerFireConfig))}
        >
          <span className="icon">restart_alt</span>
          Valores base
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        hidden
        onChange={handleImport}
      />
    </div>
  );
}

