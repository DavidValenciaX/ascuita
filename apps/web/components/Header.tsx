/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useLiveAPIContext } from '@/contexts/LiveAPIContext';
import { DEBUG_MODE } from '@/lib/constants';
import { useAgent, useUI } from '@/lib/state';
import { useTranslation } from '@/lib/i18n';

export default function Header() {
  const { setShowSettingsPanel, toggleSidebar } = useUI();
  const { current } = useAgent();
  const { client } = useLiveAPIContext();
  const { t } = useTranslation();

  return (
    <header>
      <div className="roomInfo">
        <div className="roomName">
          <button
            type="button"
            className="sidebarToggleButton"
            onClick={toggleSidebar}
            title={t('toggleSidebar')}
            aria-label={t('toggleSidebar')}
          >
            <span className="icon">menu</span>
          </button>
          <h1>{current.name || t('defaultAgentName')}</h1>
        </div>

        {DEBUG_MODE && (
          <p className="debugModel">Model: {client.model}</p>
        )}
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
