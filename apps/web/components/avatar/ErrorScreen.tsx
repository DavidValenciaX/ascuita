/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useLiveAPIContext } from '@/contexts/LiveAPIContext';
import { useTranslation } from '@/lib/i18n';

export interface ExtendedErrorType {
  code?: number;
  message?: string;
  status?: string;
}

export default function ErrorScreen() {
  const { connected, displayError, clearDisplayError } = useLiveAPIContext();
  const { t } = useTranslation();

  const quotaErrorMessage = t('errorQuota');

  let errorMessage = t('errorGeneric');
  let rawMessage: string | null = displayError?.message || null;
  let tryAgainOption = true;
  if (displayError?.code === 'RESOURCE_EXHAUSTED') {
    errorMessage = quotaErrorMessage;
    rawMessage = null;
    tryAgainOption = false;
  }

  if (displayError?.code === 'WS_BLOCKED') {
    errorMessage = t('wsBlockedError');
  }

  if (!displayError || connected) {
    return <div className="error-screen--hidden" />;
  }

  return (
    <div className="error-screen">
      <div className="error-emoji">💔</div>
      <div className="error-message-container">
        {errorMessage}
      </div>
      {tryAgainOption ? (
        <button
          type="button"
          className="close-button"
          onClick={clearDisplayError}
        >
          {t('close')}
        </button>
      ) : null}
      {rawMessage ? (
        <div className="error-raw-message-container">
          {rawMessage}
        </div>
      ) : null}
    </div>
  );
}
