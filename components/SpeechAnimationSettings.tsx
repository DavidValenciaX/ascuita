/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  defaultSpeechAnimationConfig,
  SpeechAnimationConfig,
  useSpeechAnimation,
  useUI,
} from '@/lib/state';

type SliderConfig = {
  key: keyof SpeechAnimationConfig;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
};

const sliderConfigs: SliderConfig[] = [
  {
    key: 'silenceThreshold',
    label: 'Umbral de silencio',
    hint: 'Mas alto cierra la boca antes; mas bajo detecta voz suave.',
    min: 0,
    max: 0.08,
    step: 0.001,
  },
  {
    key: 'currentVisemeBoost',
    label: 'Inercia del viseme actual',
    hint: 'Mas alto reduce saltos entre bocas, pero puede sentirse mas lento.',
    min: 1,
    max: 1.5,
    step: 0.01,
  },
  {
    key: 'minHoldTime',
    label: 'Tiempo minimo antes de cambiar',
    hint: 'Mas alto hace la boca mas pausada; mas bajo responde mas rapido.',
    min: 0,
    max: 0.08,
    step: 0.001,
    unit: 's',
  },
  {
    key: 'minSwitchScore',
    label: 'Confianza minima para cambiar',
    hint: 'Mas alto evita flicker; mas bajo permite mas cambios pequenos.',
    min: 0,
    max: 0.6,
    step: 0.01,
  },
  {
    key: 'featureHistoryFrames',
    label: 'Ventana de promedio',
    hint: 'Mas frames suavizan la deteccion; menos frames reaccionan mas rapido.',
    min: 1,
    max: 20,
    step: 1,
    unit: 'frames',
  },
  {
    key: 'attackFactor',
    label: 'Ataque de apertura',
    hint: 'Controla que tan rapido abre/cambia la forma cuando sube la energia.',
    min: 0.05,
    max: 1,
    step: 0.01,
  },
  {
    key: 'decayFactor',
    label: 'Decaimiento de cierre',
    hint: 'Controla que tan rapido se relaja la boca cuando baja la energia.',
    min: 0.05,
    max: 1,
    step: 0.01,
  },
  {
    key: 'analyserSmoothing',
    label: 'Suavizado del analizador',
    hint: 'Mas alto estabiliza el FFT; mas bajo reduce latencia visual.',
    min: 0,
    max: 0.95,
    step: 0.01,
  },

  {
    key: 'fallbackVolumeMultiplier',
    label: 'Fallback: multiplicador de volumen',
    hint: 'Solo aplica si el fallback esta activo.',
    min: 0.5,
    max: 3,
    step: 0.1,
  },
  {
    key: 'fallbackScoreBase',
    label: 'Fallback: puntaje base',
    hint: 'Solo aplica si el fallback esta activo.',
    min: 0,
    max: 0.5,
    step: 0.01,
  },
  {
    key: 'fallbackScoreWeight',
    label: 'Fallback: peso del volumen',
    hint: 'Solo aplica si el fallback esta activo.',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'fallbackCentroidThreshold',
    label: 'Fallback: umbral de centroide',
    hint: 'Frecuencia para decidir entre boca redonda y abierta.',
    min: 500,
    max: 3000,
    step: 50,
    unit: 'Hz',
  },
];

function formatValue(value: number, unit = '') {
  const precision = Number.isInteger(value) ? 0 : 3;
  return `${Number(value.toFixed(precision))}${unit ? ` ${unit}` : ''}`;
}

export default function SpeechAnimationSettings() {
  const { setShowSpeechAnimationConfig } = useUI();
  const { config, updateConfig, resetConfig } = useSpeechAnimation();

  function updateNumber(key: keyof SpeechAnimationConfig, value: string) {
    updateConfig({ [key]: Number(value) });
  }

  return (
    <div className="speechAnimationSettingsShroud" role="dialog" aria-modal="false">
      <div className="speechAnimationSettings">
        <button
          type="button"
          className="modalClose speechAnimationSettings__close"
          onClick={() => setShowSpeechAnimationConfig(false)}
        >
          <span className="icon">close</span>
        </button>

        <div className="speechAnimationSettings__header">
          <div>
            <h2>Animacion de habla</h2>
            <p>Ajusta la sincronizacion de la boca en vivo mientras pruebas la voz.</p>
          </div>
          <button type="button" className="button" onClick={resetConfig}>
            Restaurar
          </button>
        </div>

        <label className="speechAnimationSettings__toggle">
          <input
            type="checkbox"
            checked={config.enableVolumeFallback}
            onChange={event =>
              updateConfig({ enableVolumeFallback: event.target.checked })
            }
          />
          <span>
            <strong>Fallback por volumen</strong>
            <small>
              Fuerza una vocal cuando ningun fonema gana. Puede mejorar respuesta,
              pero tambien hacer la boca mas inquieta.
            </small>
          </span>
        </label>

        <div className="speechAnimationSettings__grid">
          {sliderConfigs.map(slider => {
            const value = config[slider.key];
            const isNumber = typeof value === 'number';
            if (!isNumber) return null;

            const isFallbackControl = slider.key.toString().startsWith('fallback');
            const isDisabled = isFallbackControl && !config.enableVolumeFallback;

            return (
              <label
                className="speechAnimationSettings__control"
                key={slider.key}
              >
                <span>
                  <strong>{slider.label}</strong>
                  <output>{formatValue(value, slider.unit)}</output>
                </span>
                <input
                  type="range"
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={value}
                  disabled={isDisabled}
                  onChange={event => updateNumber(slider.key, event.target.value)}
                />
                <small>{slider.hint}</small>
              </label>
            );
          })}
        </div>

        <div className="speechAnimationSettings__presets">
          <button
            type="button"
            className="button"
            onClick={() =>
              updateConfig({
                minHoldTime: 0.02,
                minSwitchScore: 0.25,
                attackFactor: 0.45,
                decayFactor: 0.25,
                featureHistoryFrames: 10,
                enableVolumeFallback: false,
              })
            }
          >
            Natural
          </button>
          <button
            type="button"
            className="button"
            onClick={() =>
              updateConfig({
                minHoldTime: 0.04,
                minSwitchScore: 0.35,
                attackFactor: 0.3,
                decayFactor: 0.15,
                featureHistoryFrames: 10,
                enableVolumeFallback: false,
              })
            }
          >
            Pausado
          </button>
          <button
            type="button"
            className="button"
            onClick={() =>
              updateConfig({
                minHoldTime: 0.01,
                minSwitchScore: 0.15,
                attackFactor: 0.6,
                decayFactor: 0.35,
                featureHistoryFrames: 4,
                enableVolumeFallback: true,
              })
            }
          >
            Reactivo
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => setShowSpeechAnimationConfig(false)}
          >
            Listo
          </button>
        </div>

        <p className="speechAnimationSettings__defaults">
          Valores iniciales actuales: hold {defaultSpeechAnimationConfig.minHoldTime}s,
          score {defaultSpeechAnimationConfig.minSwitchScore}.
        </p>
      </div>
    </div>
  );
}