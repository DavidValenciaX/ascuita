/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useRef } from 'react';
import {
  Agent,
  AGENT_COLORS,
  INTERLOCUTOR_VOICE,
  INTERLOCUTOR_VOICES,
} from '@/lib/presets/agents';
import Modal from './Modal';
import c from 'classnames';
import { useAgent, useUI } from '@/lib/state';
import { useTranslation } from '@/lib/i18n';

export default function EditAgent() {
  const agent = useAgent(state => state.current);
  const updateAgent = useAgent(state => state.update);
  const nameInput = useRef(null);
  const { setShowAgentEdit } = useUI();
  const { t } = useTranslation();

  function onClose() {
    setShowAgentEdit(false);
  }

  function updateCurrentAgent(adjustments: Partial<Agent>) {
    updateAgent(agent.id, adjustments);
  }

  return (
    <Modal onClose={() => onClose()}>
      <div className="editAgent">
        <div>
          <form>
            <div>
              <input
                className="largeInput"
                type="text"
                placeholder={t('name')}
                value={agent.name}
                onChange={e => updateCurrentAgent({ name: e.target.value })}
                ref={nameInput}
              />
            </div>

            <div>
              <label>
                {t('personality')}
                <textarea
                  value={agent.personality}
                  onChange={e =>
                    updateCurrentAgent({ personality: e.target.value })
                  }
                  rows={7}
                  placeholder={t('personalityPlaceholder')}
                />
              </label>
            </div>
          </form>
        </div>

        <div>
          <div>
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
          </div>
          <div className="voicePicker">
            <label htmlFor="voice-select">{t('voice')}</label>
            <select
              id="voice-select"
              value={agent.voice}
              onChange={e => {
                updateCurrentAgent({
                  voice: e.target.value as INTERLOCUTOR_VOICE,
                });
              }}
            >
              {INTERLOCUTOR_VOICES.map(voice => (
                <option key={voice} value={voice}>
                  {voice}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button type="button" onClick={() => onClose()} className="button primary">
          {t('letsGo')}
        </button>
      </div>
    </Modal>
  );
}
