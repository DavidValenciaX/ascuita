import { useMemo, useRef } from 'react';
import {
  cloneInnerFireConfig,
  defaultInnerFireConfig,
  FIRE_PALETTES,
  FirePaletteId,
} from '@/lib/fire/config';
import { useInnerFire } from '@/lib/state';
import FireSelectControl from './FireSelectControl';
import FireSliderSection from './FireSliderSection';
import {
  createFireSectionUpdater,
  renderFireSliderControls,
} from './fire-settings-helpers';
import { exportFireConfig, importFireConfigFromInput } from './fire-settings-io';
import {
  FIRE_SETTINGS_SECTIONS,
  FireSettingsSectionSchema,
  FireSliderSectionSchema,
} from './fire-settings-schema';

export default function FireSettingsTab() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { config, updateConfig, replaceConfig, resetConfig } = useInnerFire();

  const paletteEntries = useMemo(
    () => Object.entries(FIRE_PALETTES) as [FirePaletteId, (typeof FIRE_PALETTES)[FirePaletteId]][],
    []
  );

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) =>
    importFireConfigFromInput(event, replaceConfig);

  function renderPaletteControls() {
    return (
      <FireSelectControl
        label="Estilo de fuego"
        value={config.palette.selected}
        valueLabel={FIRE_PALETTES[config.palette.selected].label}
        description={FIRE_PALETTES[config.palette.selected].description}
        options={paletteEntries.map(([id, palette]) => ({
          value: id,
          label: palette.label,
        }))}
        onChange={(value: FirePaletteId) =>
          updateConfig({
            palette: { selected: value },
          })
        }
      />
    );
  }

  const createSectionUpdater = createFireSectionUpdater(config, updateConfig);
  const updateTransformValue = createSectionUpdater('transform');
  const updateParticleValue = createSectionUpdater('particles');
  const updateColorValue = createSectionUpdater('color');
  const updateTextureValue = createSectionUpdater('texture');
  const updateScaleValue = createSectionUpdater('scale');

  function renderSliderSection(section: FireSliderSectionSchema) {
    switch (section.key) {
      case 'transform':
        return renderFireSliderControls(config.transform, section.controls, updateTransformValue);
      case 'particles':
        return renderFireSliderControls(config.particles, section.controls, updateParticleValue);
      case 'color':
        return renderFireSliderControls(config.color, section.controls, updateColorValue);
      case 'texture':
        return renderFireSliderControls(config.texture, section.controls, updateTextureValue);
      case 'scale':
        return renderFireSliderControls(config.scale, section.controls, updateScaleValue);
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
          onClick={() => exportFireConfig(config)}
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

