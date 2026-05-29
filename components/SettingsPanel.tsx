/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState } from 'react';
import c from 'classnames';
import {
  SpeechAnimationConfig,
  useSpeechAnimation,
  useUI,
  useUser,
} from '@/lib/state';
import { useAgent } from '@/lib/state';
import { useTranslation } from '@/lib/i18n';
import {
  Agent,
  AGENT_COLORS,
  INTERLOCUTOR_VOICE,
  INTERLOCUTOR_VOICES,
  createNewAgent,
} from '@/lib/presets/agents';
import { useLiveAPIContext } from '@/contexts/LiveAPIContext';

type Tab = 'profile' | 'companion' | 'agents' | 'speech' | 'language';

// ── Speech animation slider config ─────────────────────────────────────────

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
  { key: 'silenceThreshold', label: 'Umbral de silencio', hint: 'Mas alto cierra la boca antes; mas bajo detecta voz suave.', min: 0, max: 0.08, step: 0.001 },
  { key: 'currentVisemeBoost', label: 'Inercia del viseme actual', hint: 'Mas alto reduce saltos entre bocas, pero puede sentirse mas lento.', min: 1, max: 1.5, step: 0.01 },
  { key: 'minHoldTime', label: 'Tiempo minimo antes de cambiar', hint: 'Mas alto hace la boca mas pausada; mas bajo responde mas rapido.', min: 0, max: 0.08, step: 0.001, unit: 's' },
  { key: 'minSwitchScore', label: 'Confianza minima para cambiar', hint: 'Mas alto evita flicker; mas bajo permite mas cambios pequenos.', min: 0, max: 0.6, step: 0.01 },
  { key: 'featureHistoryFrames', label: 'Ventana de promedio', hint: 'Mas frames suavizan la deteccion; menos frames reaccionan mas rapido.', min: 1, max: 20, step: 1, unit: 'frames' },
  { key: 'attackFactor', label: 'Ataque de apertura', hint: 'Controla que tan rapido abre/cambia la forma cuando sube la energia.', min: 0.05, max: 1, step: 0.01 },
  { key: 'decayFactor', label: 'Decaimiento de cierre', hint: 'Controla que tan rapido se relaja la boca cuando baja la energia.', min: 0.05, max: 1, step: 0.01 },
  { key: 'analyserSmoothing', label: 'Suavizado del analizador', hint: 'Mas alto estabiliza el FFT; mas bajo reduce latencia visual.', min: 0, max: 0.95, step: 0.01 },
  { key: 'fallbackVolumeMultiplier', label: 'Fallback: multiplicador de volumen', hint: 'Solo aplica si el fallback esta activo.', min: 0.5, max: 3, step: 0.1 },
  { key: 'fallbackScoreBase', label: 'Fallback: puntaje base', hint: 'Solo aplica si el fallback esta activo.', min: 0, max: 0.5, step: 0.01 },
  { key: 'fallbackScoreWeight', label: 'Fallback: peso del volumen', hint: 'Solo aplica si el fallback esta activo.', min: 0, max: 1, step: 0.01 },
  { key: 'fallbackCentroidThreshold', label: 'Fallback: umbral de centroide', hint: 'Frecuencia para decidir entre boca redonda y abierta.', min: 500, max: 3000, step: 50, unit: 'Hz' },
];

function formatValue(value: number, unit = '') {
  const precision = Number.isInteger(value) ? 0 : 3;
  return `${Number(value.toFixed(precision))}${unit ? ` ${unit}` : ''}`;
}

// ── Tab sub-components ──────────────────────────────────────────────────────

function ProfileTab() {
  const { name, info, setName, setInfo } = useUser();
  const { t } = useTranslation();

  return (
    <div className="settingsPanel__tab">
      <h2>{t('tabProfile')}</h2>
      <p className="settingsPanel__desc">{t('userSettingsTitle')}</p>
      <p className="settingsPanel__desc">{t('optionalInfo')}</p>
      <div className="settingsPanel__field">
        <p>{t('yourName')}</p>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('namePlaceholder')}
        />
      </div>
      <div className="settingsPanel__field">
        <p>{t('yourInfo')}</p>
        <textarea
          rows={4}
          value={info}
          onChange={e => setInfo(e.target.value)}
          placeholder={t('infoPlaceholder')}
        />
      </div>
    </div>
  );
}

function CompanionTab() {
  const agent = useAgent(state => state.current);
  const updateAgent = useAgent(state => state.update);
  const { t } = useTranslation();

  function updateCurrentAgent(adjustments: Partial<Agent>) {
    updateAgent(agent.id, adjustments);
  }

  return (
    <div className="settingsPanel__tab">
      <h2>{t('tabAgent')}</h2>
      <div className="settingsPanel__field">
        <input
          className="largeInput"
          type="text"
          placeholder={t('name')}
          value={agent.name}
          onChange={e => updateCurrentAgent({ name: e.target.value })}
        />
      </div>
      <label className="settingsPanel__field">
        {t('personality')}
        <textarea
          value={agent.personality}
          onChange={e => updateCurrentAgent({ personality: e.target.value })}
          rows={7}
          placeholder={t('personalityPlaceholder')}
        />
      </label>
      <ul className="colorPicker">
        {AGENT_COLORS.map((color, i) => (
          <li
            key={i}
            className={c(`color-swatch-${i}`, { active: color === agent.bodyColor })}
          >
            <button
              type="button"
              aria-label={`${t('selectColor')} ${color}`}
              onClick={() => updateCurrentAgent({ bodyColor: color })}
            />
          </li>
        ))}
      </ul>
      <div className="voicePicker">
        <label htmlFor="settings-voice-select">{t('voice')}</label>
        <select
          id="settings-voice-select"
          value={agent.voice}
          onChange={e =>
            updateCurrentAgent({ voice: e.target.value as INTERLOCUTOR_VOICE })
          }
        >
          {INTERLOCUTOR_VOICES.map(voice => (
            <option key={voice} value={voice}>
              {voice}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function AgentsTab() {
  const { current, setCurrent, availablePresets, availablePersonal, addAgent } = useAgent();
  const updateAgent = useAgent(state => state.update);
  const { disconnect } = useLiveAPIContext();
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingAgent = editingId
    ? [...availablePresets, ...availablePersonal].find(a => a.id === editingId)
    : null;

  function updateEditingAgent(adjustments: Partial<Agent>) {
    if (editingId) updateAgent(editingId, adjustments);
  }

  function changeAgent(agent: Agent) {
    disconnect();
    setCurrent(agent);
  }

  function handleAddAgent() {
    disconnect();
    const newAgent = createNewAgent();
    addAgent(newAgent);
    setEditingId(newAgent.id);
  }

  if (editingAgent) {
    return (
      <div className="settingsPanel__tab">
        <div className="settingsPanel__tabHeader">
          <button
            type="button"
            className="button"
            onClick={() => setEditingId(null)}
          >
            <span className="icon">arrow_back</span>
            {t('yourAgents')}
          </button>
        </div>
        <div className="settingsPanel__field">
          <input
            className="largeInput"
            type="text"
            placeholder={t('name')}
            value={editingAgent.name}
            onChange={e => updateEditingAgent({ name: e.target.value })}
            autoFocus
          />
        </div>
        <label className="settingsPanel__field">
          {t('personality')}
          <textarea
            value={editingAgent.personality}
            onChange={e => updateEditingAgent({ personality: e.target.value })}
            rows={7}
            placeholder={t('personalityPlaceholder')}
          />
        </label>
        <ul className="colorPicker">
          {AGENT_COLORS.map((color, i) => (
            <li
              key={i}
              className={c(`color-swatch-${i}`, { active: color === editingAgent.bodyColor })}
            >
              <button
                type="button"
                aria-label={`${t('selectColor')} ${color}`}
                onClick={() => updateEditingAgent({ bodyColor: color })}
              />
            </li>
          ))}
        </ul>
        <div className="voicePicker">
          <label htmlFor="settings-new-agent-voice">{t('voice')}</label>
          <select
            id="settings-new-agent-voice"
            value={editingAgent.voice}
            onChange={e =>
              updateEditingAgent({ voice: e.target.value as INTERLOCUTOR_VOICE })
            }
          >
            {INTERLOCUTOR_VOICES.map(voice => (
              <option key={voice} value={voice}>
                {voice}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="button primary settingsPanel__saveAgentBtn"
          onClick={() => {
            changeAgent(editingAgent);
            setEditingId(null);
          }}
        >
          <span className="icon">check_circle</span>
          {t('saveAgent')}
        </button>
      </div>
    );
  }

  return (
    <div className="settingsPanel__tab">
      <h2>{t('tabAgents')}</h2>

      <section className="settingsPanel__agentSection">
        <h3>{t('presets')}</h3>
        <ul className="settingsPanel__agentList">
          {availablePresets.map(agent => (
            <li
              key={agent.id}
              className={c('settingsPanel__agentItem', { active: agent.id === current.id })}
            >
              <button
                type="button"
                className="settingsPanel__agentSelect"
                onClick={() => changeAgent(agent)}
              >
                <span
                  className="settingsPanel__agentDot"
                  style={{ background: agent.bodyColor }}
                />
                <span>{agent.name}</span>
                {agent.id === current.id && (
                  <span className="icon settingsPanel__agentCheck">check_circle</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="settingsPanel__agentSection">
        <h3>{t('yourAgents')}</h3>
        {availablePersonal.length > 0 ? (
          <ul className="settingsPanel__agentList">
            {availablePersonal.map(agent => (
              <li
                key={agent.id}
                className={c('settingsPanel__agentItem', { active: agent.id === current.id })}
              >
                <button
                  type="button"
                  className="settingsPanel__agentSelect"
                  onClick={() => changeAgent(agent)}
                >
                  <span
                    className="settingsPanel__agentDot"
                    style={{ background: agent.bodyColor }}
                  />
                  <span>{agent.name || t('newAgent')}</span>
                  {agent.id === current.id && (
                    <span className="icon settingsPanel__agentCheck">check_circle</span>
                  )}
                </button>
                <button
                  type="button"
                  className="settingsPanel__agentEdit"
                  onClick={() => setEditingId(agent.id)}
                  title={t('edit')}
                >
                  <span className="icon">edit</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="settingsPanel__desc">{t('noneYet')}</p>
        )}
        <button
          type="button"
          className="button settingsPanel__newAgentBtn"
          onClick={handleAddAgent}
        >
          <span className="icon">add</span>
          {t('newAgent')}
        </button>
      </section>
    </div>
  );
}

function SpeechTab() {
  const { config, updateConfig, resetConfig } = useSpeechAnimation();

  function updateNumber(key: keyof SpeechAnimationConfig, value: string) {
    updateConfig({ [key]: Number(value) });
  }

  return (
    <div className="settingsPanel__tab">
      <div className="settingsPanel__tabHeader">
        <div>
          <h2>Animacion de habla</h2>
          <p className="settingsPanel__desc">
            Ajusta la sincronizacion de la boca en vivo mientras pruebas la voz.
          </p>
        </div>
        <button type="button" className="button" onClick={resetConfig}>
          Restaurar
        </button>
      </div>

      <label className="speechAnimationSettings__toggle">
        <input
          type="checkbox"
          checked={config.enableVolumeFallback}
          onChange={e => updateConfig({ enableVolumeFallback: e.target.checked })}
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
          if (typeof value !== 'number') return null;
          const isFallback = slider.key.toString().startsWith('fallback');
          const isDisabled = isFallback && !config.enableVolumeFallback;

          return (
            <label className="speechAnimationSettings__control" key={slider.key}>
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
                onChange={e => updateNumber(slider.key, e.target.value)}
              />
              <small>{slider.hint}</small>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function LanguageTab() {
  const { language, setLanguage, t } = useTranslation();

  return (
    <div className="settingsPanel__tab">
      <h2>{t('tabLanguage')}</h2>
      <div className="settingsPanel__langOptions">
        <button
          type="button"
          className={c('button', { active: language === 'en' })}
          onClick={() => setLanguage('en')}
        >
          🇺🇸 English
        </button>
        <button
          type="button"
          className={c('button', { active: language === 'es' })}
          onClick={() => setLanguage('es')}
        >
          🇪🇸 Español
        </button>
      </div>
    </div>
  );
}

// ── Main SettingsPanel ──────────────────────────────────────────────────────

export default function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const { setShowSettingsPanel } = useUI();
  const { t } = useTranslation();

  const tabs: [Tab, string, string][] = [
    ['profile', 'person', t('tabProfile')],
    ['companion', 'smart_toy', t('tabAgent')],
    ['agents', 'group', t('tabAgents')],
    ['speech', 'graphic_eq', t('tabSpeech')],
    ['language', 'language', t('tabLanguage')],
  ];

  return (
    <div className="settingsPanel" role="dialog" aria-modal="true">
      <div className="settingsPanel__container">
        <button
          type="button"
          className="modalClose settingsPanel__close"
          onClick={() => setShowSettingsPanel(false)}
        >
          <span className="icon">close</span>
        </button>

        <nav className="settingsPanel__nav">
          {tabs.map(([id, icon, label]) => (
            <button
              key={id}
              type="button"
              className={c('settingsPanel__navBtn', { active: activeTab === id })}
              onClick={() => setActiveTab(id)}
            >
              <span className="icon">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="settingsPanel__content">
          {activeTab === 'profile' && <ProfileTab />}
          {activeTab === 'companion' && <CompanionTab />}
          {activeTab === 'agents' && <AgentsTab />}
          {activeTab === 'speech' && <SpeechTab />}
          {activeTab === 'language' && <LanguageTab />}
        </div>
      </div>
    </div>
  );
}
