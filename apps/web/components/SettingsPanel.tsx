/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useRef, useState } from 'react';
import c from 'classnames';
import FireSettingsTab from './FireSettingsTab';
import {
  AvatarRenderConfig,
  SpeechAnimationConfig,
  useAvatarRender,
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
import { useLanguage } from '@/lib/i18n';
import { createSystemInstructions } from '@/lib/prompts';
import { saveUserProfile } from '@/hooks/useUserProfile';
import { useUserAgents } from '@/hooks/useUserAgents';

type Tab = 'profile' | 'agents' | 'speech' | 'fire' | 'avatar' | 'appearance' | 'language';

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

type AvatarSliderConfig = {
  key: {
    [K in keyof AvatarRenderConfig]: AvatarRenderConfig[K] extends number ? K : never;
  }[keyof AvatarRenderConfig];
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
};

type AvatarToggleConfig = {
  key: {
    [K in keyof AvatarRenderConfig]: AvatarRenderConfig[K] extends boolean ? K : never;
  }[keyof AvatarRenderConfig];
  label: string;
  hint: string;
};

type AvatarSectionConfig = {
  title: string;
  controls: AvatarSliderConfig[];
  toggles?: AvatarToggleConfig[];
};

const avatarSectionConfigs: AvatarSectionConfig[] = [
  {
    title: 'Material del avatar',
    controls: [
      {
        key: 'bodyEmissiveIntensity',
        label: 'Emision del cuerpo',
        hint: 'Controla cuanto brilla el material base del avatar, aparte del fuego interno.',
        min: 0,
        max: 1.5,
        step: 0.01,
      },
      {
        key: 'bodyOpacity',
        label: 'Opacidad del cuerpo',
        hint: 'Controla cuanto cubre visualmente el cascaron del avatar a los objetos internos cuando el material es transparente.',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
    toggles: [
      {
        key: 'bodyTransparent',
        label: 'Material transparente',
        hint: 'Si se desactiva, el material del cuerpo se vuelve opaco y el slider de opacidad deja de influir visualmente.',
      },
      {
        key: 'bodyDepthWrite',
        label: 'Escribir profundidad',
        hint: 'Hace que el cuerpo bloquee mejor lo que queda detras o dentro al escribir en el buffer de profundidad.',
      },
    ],
  },
  {
    title: 'Movimiento al hablar',
    controls: [
      {
        key: 'talkingBounceIntensity',
        label: 'Intensidad del bounce',
        hint: 'Escala cuanto se deforma el cuerpo cuando el avatar esta hablando.',
        min: 0,
        max: 2,
        step: 0.01,
      },
    ],
  },
  {
    title: 'Postprocesado global',
    controls: [
      {
        key: 'sceneExposure',
        label: 'Exposicion de escena',
        hint: 'Ajusta la exposicion general del render del avatar y del entorno.',
        min: 0.3,
        max: 1.6,
        step: 0.01,
      },
      {
        key: 'sceneBloomStrength',
        label: 'Bloom global: fuerza',
        hint: 'Bloom adicional de escena, separado del bloom del fuego interno.',
        min: 0,
        max: 2,
        step: 0.01,
      },
      {
        key: 'sceneBloomRadius',
        label: 'Bloom global: radio',
        hint: 'Abre o concentra el halo del postprocesado global de escena.',
        min: 0,
        max: 3,
        step: 0.01,
      },
      {
        key: 'sceneBloomThreshold',
        label: 'Bloom global: umbral',
        hint: 'Define cuan brillante debe ser una zona para entrar al bloom global.',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
];

function formatValue(value: number, unit = '') {
  const precision = Number.isInteger(value) ? 0 : 3;
  return `${Number(value.toFixed(precision))}${unit ? ` ${unit}` : ''}`;
}

// ── Tab sub-components ──────────────────────────────────────────────────────

function ProfileTab() {
  const { name, info, setName, setInfo } = useUser();
  const { t } = useTranslation();
  const persistProfile = () => {
    void saveUserProfile({ name, info });
  };

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
          onBlur={persistProfile}
          placeholder={t('namePlaceholder')}
        />
      </div>
      <div className="settingsPanel__field">
        <p>{t('yourInfo')}</p>
        <textarea
          rows={4}
          value={info}
          onChange={e => setInfo(e.target.value)}
          onBlur={persistProfile}
          placeholder={t('infoPlaceholder')}
        />
      </div>
    </div>
  );
}

function AgentsTab() {
  const { current, setCurrent, availablePresets, availablePersonal, addAgent, removeAgent } = useAgent();
  const updateAgent = useAgent(state => state.update);
  const { disconnect, client, connected } = useLiveAPIContext();
  const { t } = useTranslation();
  const { language } = useLanguage();
  const user = useUser();
  const { saveAgent: persistAgent, removeAgent: deleteAgentFromDb } = useUserAgents();
  const [editingId, setEditingId] = useState<string | null>(null);
  const originalAgentRef = useRef<Agent | null>(null);

  const editingAgent = editingId
    ? [...availablePresets, ...availablePersonal].find(a => a.id === editingId)
    : null;

  function startEditing(agent: Agent) {
    originalAgentRef.current = { ...agent };
    setEditingId(agent.id);
  }

  function updateEditingAgent(adjustments: Partial<Agent>) {
    if (editingId) updateAgent(editingId, adjustments);
  }

  function changeAgent(agent: Agent) {
    disconnect();
    setCurrent(agent);
  }

  function saveAgent() {
    if (!editingAgent) return;

    const isSameAgent = editingAgent.id === current.id;
    const original = originalAgentRef.current;

    if (!isSameAgent) {
      changeAgent(editingAgent);
    } else if (original && connected) {
      const voiceChanged = original.voice !== editingAgent.voice;
      const namePersonalityOrColorChanged =
        original.name !== editingAgent.name ||
        original.personality !== editingAgent.personality ||
        original.bodyColor !== editingAgent.bodyColor;

      if (voiceChanged) {
        disconnect();
      } else if (namePersonalityOrColorChanged) {
        const updatePrompt =
          language === 'es'
            ? `Actualización de tu configuración: ${createSystemInstructions(editingAgent, user, language)}\n\nNo saludes ni te presentes de nuevo. Simplemente continúa la conversación naturalmente con esta nueva información.`
            : `Configuration update: ${createSystemInstructions(editingAgent, user, language)}\n\nDo not greet or introduce yourself again. Simply continue the conversation naturally with this new information.`;
        client.send({ text: updatePrompt }, true);
      }
    }

    void persistAgent(editingAgent);

    originalAgentRef.current = null;
    setEditingId(null);
  }

  function handleAddAgent() {
    disconnect();
    const newAgent = createNewAgent();
    addAgent(newAgent);
    originalAgentRef.current = { ...newAgent };
    setEditingId(newAgent.id);
  }

  if (editingAgent) {
    return (
      <div className="settingsPanel__tab">
        <div className="settingsPanel__tabHeader">
          <button
            type="button"
            className="button"
            onClick={() => {
              originalAgentRef.current = null;
              setEditingId(null);
            }}
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
                style={{ backgroundColor: color }}
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
          onClick={saveAgent}
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
                  onClick={() => startEditing(agent)}
                  title={t('edit')}
                >
                  <span className="icon">edit</span>
                </button>
                <button
                  type="button"
                  className="settingsPanel__agentEdit"
                  onClick={() => {
                    if (!window.confirm(t('deleteAgentConfirm'))) return;
                    removeAgent(agent.id);
                    void deleteAgentFromDb(agent.id);
                  }}
                  title={t('deleteAgent')}
                >
                  <span className="icon">delete</span>
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

function AppearanceTab() {
  const { sceneTheme, setSceneTheme } = useUI();
  const { t } = useTranslation();
  const isLight = sceneTheme === 'light';

  return (
    <div className="settingsPanel__tab">
      <h2>{t('tabAppearance')}</h2>
      <p className="settingsPanel__desc">{t('sceneThemeDesc')}</p>

      <label className="settingsPanel__themeToggle">
        <input
          type="checkbox"
          checked={isLight}
          onChange={e => setSceneTheme(e.target.checked ? 'light' : 'dark')}
        />
        <span className="settingsPanel__themeTrack" aria-hidden="true">
          <span className="settingsPanel__themeThumb">
            <span className="icon">{isLight ? 'light_mode' : 'dark_mode'}</span>
          </span>
        </span>
        <span className="settingsPanel__themeText">
          <strong>{t('sceneTheme')}</strong>
          <small>{isLight ? t('sceneThemeLight') : t('sceneThemeDark')}</small>
        </span>
      </label>
    </div>
  );
}

function AvatarTab() {
  const { config, updateConfig, resetConfig } = useAvatarRender();

  function updateNumber(
    key: AvatarSliderConfig['key'],
    value: string
  ) {
    updateConfig({ [key]: Number(value) });
  }

  function updateBoolean(
    key: AvatarToggleConfig['key'],
    value: boolean
  ) {
    updateConfig({ [key]: value });
  }

  return (
    <div className="settingsPanel__tab">
      <div className="settingsPanel__tabHeader">
        <div>
          <h2>Avatar</h2>
          <p className="settingsPanel__desc">
            Ajustes del cuerpo y del render del avatar, separados del fuego interno.
          </p>
        </div>
        <button type="button" className="button" onClick={resetConfig}>
          Restaurar
        </button>
      </div>

      <div className="settingsPanel__avatarSections">
        {avatarSectionConfigs.map(section => (
          <div className="settingsPanel__fireSection" key={section.title}>
            <div className="settingsPanel__fireSectionTitle">{section.title}</div>
            <div className="settingsPanel__fireGrid">
              {section.controls.map(slider => (
                <label className="settingsPanel__fireControl" key={slider.key}>
                  <span>
                    <strong>{slider.label}</strong>
                    <output>{formatValue(config[slider.key])}</output>
                  </span>
                  <input
                    type="range"
                    min={slider.min}
                    max={slider.max}
                    step={slider.step}
                    value={config[slider.key]}
                    onChange={e => updateNumber(slider.key, e.target.value)}
                  />
                  <small>{slider.hint}</small>
                </label>
              ))}
              {section.toggles?.map(toggle => (
                <label className="speechAnimationSettings__toggle" key={toggle.key}>
                  <input
                    type="checkbox"
                    checked={config[toggle.key]}
                    onChange={e => updateBoolean(toggle.key, e.target.checked)}
                  />
                  <span>
                    <strong>{toggle.label}</strong>
                    <small>{toggle.hint}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { setShowSettingsPanel } = useUI();
  const { t } = useTranslation();

  const basicTabs: [Tab, string, string][] = [
    ['profile', 'person', t('tabProfile')],
    ['agents', 'group', t('tabAgents')],
    ['appearance', 'palette', t('tabAppearance')],
    ['language', 'language', t('tabLanguage')],
  ];

  const advancedTabs: [Tab, string, string][] = [
    ['speech', 'graphic_eq', t('tabSpeech')],
    ['fire', 'local_fire_department', 'Fuego'],
    ['avatar', 'smart_toy', 'Avatar'],
  ];

  const isAdvancedActive = advancedTabs.some(([id]) => id === activeTab);

  function selectTab(id: Tab) {
    setActiveTab(id);
    if (advancedTabs.some(([advId]) => advId === id)) {
      setAdvancedOpen(true);
    }
  }

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
          {basicTabs.map(([id, icon, label]) => (
            <button
              key={id}
              type="button"
              className={c('settingsPanel__navBtn', { active: activeTab === id })}
              onClick={() => selectTab(id)}
            >
              <span className="icon">{icon}</span>
              <span>{label}</span>
            </button>
          ))}

          <button
            type="button"
            className={c('settingsPanel__navBtn settingsPanel__navAdvancedToggle', {
              active: isAdvancedActive,
            })}
            onClick={() => setAdvancedOpen(prev => !prev)}
            aria-expanded={advancedOpen}
          >
            <span className="icon settingsPanel__navArrow">
              {advancedOpen ? 'expand_more' : 'chevron_right'}
            </span>
            <span>Configuración avanzada</span>
          </button>

          {advancedOpen && (
            <div className="settingsPanel__navAdvanced">
              {advancedTabs.map(([id, icon, label]) => (
                <button
                  key={id}
                  type="button"
                  className={c('settingsPanel__navBtn settingsPanel__navBtnAdvanced', {
                    active: activeTab === id,
                  })}
                  onClick={() => selectTab(id)}
                >
                  <span className="icon">{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
        </nav>

        <div className="settingsPanel__content">
          {activeTab === 'profile' && <ProfileTab />}
          {activeTab === 'agents' && <AgentsTab />}
          {activeTab === 'speech' && <SpeechTab />}
          {activeTab === 'fire' && <FireSettingsTab />}
          {activeTab === 'avatar' && <AvatarTab />}
          {activeTab === 'appearance' && <AppearanceTab />}
          {activeTab === 'language' && <LanguageTab />}
        </div>
      </div>
    </div>
  );
}
