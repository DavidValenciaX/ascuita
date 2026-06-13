import { ChangeEvent, useMemo, useRef } from 'react';
import {
  cloneInnerFireConfig,
  defaultInnerFireConfig,
  DeepPartial,
  FIRE_PALETTES,
  FirePaletteId,
  InnerFireConfig,
} from '@/lib/fire/config';
import { useInnerFire } from '@/lib/state';
import FireSliderControl from './FireSliderControl';
import FireSliderSection from './FireSliderSection';
import {
  FIRE_SETTINGS_SECTIONS,
  FireNumericSectionKey,
  FireSettingsSectionSchema,
  FireSliderSectionSchema,
  NumericSliderDef,
} from './fire-settings-schema';

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

  function renderPaletteControls() {
    return (
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
    );
  }

  const updateTransformValue = createSectionUpdater('transform');
  const updateParticleValue = createSectionUpdater('particles');
  const updateColorValue = createSectionUpdater('color');
  const updateTextureValue = createSectionUpdater('texture');
  const updateScaleValue = createSectionUpdater('scale');

  function renderSliderSection(section: FireSliderSectionSchema) {
    switch (section.key) {
      case 'transform':
        return renderSliderControls(config.transform, section.controls, updateTransformValue);
      case 'particles':
        return renderSliderControls(config.particles, section.controls, updateParticleValue);
      case 'color':
        return renderSliderControls(config.color, section.controls, updateColorValue);
      case 'texture':
        return renderSliderControls(config.texture, section.controls, updateTextureValue);
      case 'scale':
        return renderSliderControls(config.scale, section.controls, updateScaleValue);
    }
  }

  function renderSectionContent(section: FireSettingsSectionSchema) {
    if (section.kind === 'palette') {
      return renderPaletteControls();
    }

    return renderSliderSection(section);
  }

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

      {FIRE_SETTINGS_SECTIONS.map(section => (
        <FireSliderSection
          key={section.key}
          title={section.title}
          contentClassName={section.contentClassName}
        >
          {renderSectionContent(section)}
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

