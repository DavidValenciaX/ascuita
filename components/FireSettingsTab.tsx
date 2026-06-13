import { ChangeEvent, useMemo, useRef } from 'react';
import {
  cloneInnerFireConfig,
  defaultInnerFireConfig,
  FIRE_PALETTES,
  FirePaletteId,
  InnerFireConfig,
} from '@/lib/fire/config';
import { useInnerFire } from '@/lib/state';

type SliderDef = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
};

const positionControls: SliderDef[] = [
  { key: 'x', label: 'Fuego X', min: -2, max: 2, step: 0.01 },
  { key: 'y', label: 'Fuego Y', min: -2, max: 2, step: 0.01 },
  { key: 'z', label: 'Fuego Z', min: -2, max: 2, step: 0.01 },
];

const particleControls: SliderDef[] = [
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

const colorControls: SliderDef[] = [
  { key: 'threshold1', label: 'Etapa 1 a 2', min: 0, max: 0.5, step: 0.01 },
  { key: 'threshold2', label: 'Etapa 2 a 3', min: 0.1, max: 0.8, step: 0.01 },
  { key: 'threshold3', label: 'Etapa 3 a 4', min: 0.4, max: 1, step: 0.01 },
];

const textureControls: SliderDef[] = [
  { key: 'size', label: 'Resolucion de textura', min: 16, max: 256, step: 16 },
  { key: 'coreOpacity', label: 'Opacidad del nucleo', min: 0.1, max: 1, step: 0.1 },
  { key: 'midOpacity', label: 'Opacidad media', min: 0, max: 1, step: 0.1 },
  { key: 'midStop', label: 'Posicion media', min: 0, max: 1, step: 0.01 },
  { key: 'edgeOpacity', label: 'Opacidad de borde', min: 0, max: 0.5, step: 0.05 },
];

const scaleControls: SliderDef[] = [
  { key: 'idleXZ', label: 'Escala reposo X/Z', min: 0.3, max: 2, step: 0.01 },
  { key: 'idleY', label: 'Escala reposo Y', min: 0.3, max: 2, step: 0.01 },
  { key: 'talkingXZ', label: 'Escala al hablar X/Z', min: 0.3, max: 2.5, step: 0.01 },
  { key: 'talkingY', label: 'Escala al hablar Y', min: 0.3, max: 2.5, step: 0.01 },
];

function formatValue(value: number, unit = '') {
  const precision = Number.isInteger(value) ? 0 : value < 0.01 ? 4 : 2;
  return `${Number(value.toFixed(precision))}${unit ? ` ${unit}` : ''}`;
}

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

      <div className="settingsPanel__fireSection">
        <div className="settingsPanel__fireSectionTitle">Posicion</div>
        <div className="settingsPanel__fireGrid settingsPanel__fireGrid--three">
          {positionControls.map(control => (
            <label key={control.key} className="settingsPanel__fireControl">
              <span>
                <strong>{control.label}</strong>
                <output>{formatValue(config.transform[control.key as keyof typeof config.transform], control.unit)}</output>
              </span>
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={config.transform[control.key as keyof typeof config.transform]}
                onChange={event =>
                  updateConfig({
                    transform: {
                      [control.key]: Number(event.target.value),
                    } as Partial<InnerFireConfig['transform']>,
                  })
                }
              />
            </label>
          ))}
        </div>
      </div>

      <div className="settingsPanel__fireSection">
        <div className="settingsPanel__fireSectionTitle">Paleta</div>
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
      </div>

      <div className="settingsPanel__fireSection">
        <div className="settingsPanel__fireSectionTitle">Sistema de particulas</div>
        <div className="settingsPanel__fireGrid">
          {particleControls.map(control => (
            <label key={control.key} className="settingsPanel__fireControl">
              <span>
                <strong>{control.label}</strong>
                <output>{formatValue(config.particles[control.key as keyof typeof config.particles], control.unit)}</output>
              </span>
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={config.particles[control.key as keyof typeof config.particles]}
                onChange={event =>
                  updateConfig({
                    particles: {
                      [control.key]: Number(event.target.value),
                    } as Partial<InnerFireConfig['particles']>,
                  })
                }
              />
            </label>
          ))}
        </div>
      </div>

      <div className="settingsPanel__fireSection">
        <div className="settingsPanel__fireSectionTitle">Umbrales de color</div>
        <div className="settingsPanel__fireGrid settingsPanel__fireGrid--three">
          {colorControls.map(control => (
            <label key={control.key} className="settingsPanel__fireControl">
              <span>
                <strong>{control.label}</strong>
                <output>{formatValue(config.color[control.key as keyof typeof config.color], control.unit)}</output>
              </span>
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={config.color[control.key as keyof typeof config.color]}
                onChange={event =>
                  updateConfig({
                    color: {
                      [control.key]: Number(event.target.value),
                    } as Partial<InnerFireConfig['color']>,
                  })
                }
              />
            </label>
          ))}
        </div>
      </div>

      <div className="settingsPanel__fireSection">
        <div className="settingsPanel__fireSectionTitle">Textura</div>
        <div className="settingsPanel__fireGrid settingsPanel__fireGrid--three">
          {textureControls.map(control => (
            <label key={control.key} className="settingsPanel__fireControl">
              <span>
                <strong>{control.label}</strong>
                <output>{formatValue(config.texture[control.key as keyof typeof config.texture], control.unit)}</output>
              </span>
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={config.texture[control.key as keyof typeof config.texture]}
                onChange={event =>
                  updateConfig({
                    texture: {
                      [control.key]: Number(event.target.value),
                    } as Partial<InnerFireConfig['texture']>,
                  })
                }
              />
            </label>
          ))}
        </div>
      </div>

      <div className="settingsPanel__fireSection">
        <div className="settingsPanel__fireSectionTitle">Respuesta al habla</div>
        <div className="settingsPanel__fireGrid settingsPanel__fireGrid--two">
          {scaleControls.map(control => (
            <label key={control.key} className="settingsPanel__fireControl">
              <span>
                <strong>{control.label}</strong>
                <output>{formatValue(config.scale[control.key as keyof typeof config.scale], control.unit)}</output>
              </span>
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={config.scale[control.key as keyof typeof config.scale]}
                onChange={event =>
                  updateConfig({
                    scale: {
                      [control.key]: Number(event.target.value),
                    } as Partial<InnerFireConfig['scale']>,
                  })
                }
              />
            </label>
          ))}
        </div>
      </div>

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

