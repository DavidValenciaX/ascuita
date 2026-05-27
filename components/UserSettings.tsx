/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import Modal from './Modal';
import { useUI, useUser } from '@/lib/state';
import { useTranslation } from '@/lib/i18n';

export default function UserSettings() {
  const { name, info, setName, setInfo } = useUser();
  const { setShowUserConfig } = useUI();
  const { t } = useTranslation();

  function updateClient() {
    setShowUserConfig(false);
  }

  return (
    <Modal onClose={() => setShowUserConfig(false)}>
      <div className="userSettings">
        <p>
          {t('userSettingsTitle')}
        </p>

        <form
          onSubmit={e => {
            e.preventDefault();
            setShowUserConfig(false);
            updateClient();
          }}
        >
          <p>{t('optionalInfo')}</p>

          <div>
            <p>{t('yourName')}</p>
            <input
              type="text"
              name="name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
            />
          </div>

          <div>
            <p>{t('yourInfo')}</p>
            <textarea
              rows={3}
              name="info"
              value={info}
              onChange={e => setInfo(e.target.value)}
              placeholder={t('infoPlaceholder')}
            />
          </div>

          <button type="button" className="button primary">{t('letsGo')}</button>
        </form>
      </div>
    </Modal>
  );
}
