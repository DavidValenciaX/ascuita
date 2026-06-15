/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useLiveAPIContext } from '@/contexts/LiveAPIContext';
import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n';

export interface ExtendedErrorType {
  code?: number;
  message?: string;
  status?: string;
}

export default function ErrorScreen() {
  const { client } = useLiveAPIContext();
  const [error, setError] = useState<{ message?: string } | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    function onError(error: ErrorEvent) {
      console.error(error);
      setError(error);
    }

    client.on('error', onError);

    return () => {
      client.off('error', onError);
    };
  }, [client]);

  const quotaErrorMessage = t('errorQuota');

  let errorMessage = t('errorGeneric');
  let rawMessage: string | null = error?.message || null;
  let tryAgainOption = true;
  if (error?.message?.includes('RESOURCE_EXHAUSTED')) {
    errorMessage = quotaErrorMessage;
    rawMessage = null;
    tryAgainOption = false;
  }

  if (!error) {
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
          onClick={() => {
            setError(null);
          }}
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
