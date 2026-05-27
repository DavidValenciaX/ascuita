/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useLiveAPIContext } from '@/contexts/LiveAPIContext';
import { DEBUG_MODE } from '@/lib/constants';
import { Agent, createNewAgent } from '@/lib/presets/agents';
import { useAgent, useUI } from '@/lib/state';
import { useTranslation } from '@/lib/i18n';
import c from 'classnames';
import { useEffect, useState } from 'react';

export default function Header() {
  const { setShowSettingsPanel } = useUI();
  const { current, setCurrent, availablePresets, availablePersonal, addAgent } =
    useAgent();
  const { client, disconnect } = useLiveAPIContext();
  const { t } = useTranslation();

  let [showRoomList, setShowRoomList] = useState(false);

  useEffect(() => {
    addEventListener('click', () => setShowRoomList(false));
    return () => removeEventListener('click', () => setShowRoomList(false));
  }, []);

  function changeAgent(agent: Agent | string) {
    disconnect();
    setCurrent(agent);
  }

  function addNewAgent() {
    disconnect();
    addAgent(createNewAgent());
    setShowSettingsPanel(true);
  }

  return (
    <header>
      <div className="roomInfo">
        <div className="roomName">
          <button type="button"
            onClick={e => {
              e.stopPropagation();
              setShowRoomList(!showRoomList);
            }}
          >
            <h1 className={c({ active: showRoomList })}>
              {current.name || t('defaultAgentName')}
              <span className="icon">arrow_drop_down</span>
            </h1>
          </button>


        </div>

        {DEBUG_MODE && (
          <p className="debugModel">Model: {client.model}</p>
        )}

        <div className={c('roomList', { active: showRoomList })}>
          <div>
            <h3>{t('presets')}</h3>
            <ul>
              {availablePresets
                .filter(agent => agent.id !== current.id)
                .map(agent => (
                  <li
                    key={agent.name}
                    className={c({ active: agent.id === current.id })}
                  >
                    <button type="button" onClick={() => changeAgent(agent)}>
                      {agent.name}
                    </button>
                  </li>
                ))}
            </ul>
          </div>

          <div>
            <h3>{t('yourAgents')}</h3>
            {
              <ul>
                {availablePersonal.length ? (
                  availablePersonal.map(({ id, name }) => (
                    <li key={name} className={c({ active: id === current.id })}>
                      <button type="button" onClick={() => changeAgent(id)}>{name}</button>
                    </li>
                  ))
                ) : (
                  <li>
                    <p>{t('noneYet')}</p>
                  </li>
                )}
              </ul>
            }
            <button type="button"
              className="newRoomButton"
              onClick={() => {
                addNewAgent();
              }}
            >
              <span className="icon">add</span>{t('newAgent')}
            </button>
          </div>
        </div>
      </div>

      <div className="headerActions">
        <button
          type="button"
          className="userSettingsButton"
          onClick={() => setShowSettingsPanel(true)}
          title={t('settings')}
        >
          <span className="icon">settings</span>
        </button>
      </div>
    </header>
  );
}
