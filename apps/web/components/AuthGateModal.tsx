import { useState } from 'react';
import { signInWithGooglePopup } from '../firebase';
import { useAuthGate } from '@/lib/state';
import { useTranslation } from '@/lib/i18n';

export default function AuthGateModal() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const { isAuthenticated, trialExpired } = useAuthGate();
  const { t } = useTranslation();

  if (!trialExpired || isAuthenticated) {
    return null;
  }

  async function handleSignIn() {
    setPending(true);
    setError('');

    try {
      await signInWithGooglePopup();
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : 'Could not sign in with Google'
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="modalShroud authGateModal" role="dialog" aria-modal="true">
      <div className="modal authGateModal__card">
        <div className="authGateModal__eyebrow">{t('trialEndedEyebrow')}</div>
        <h2>{t('trialEndedTitle')}</h2>
        <p className="authGateModal__text">{t('trialEndedBody')}</p>
        <button
          type="button"
          className="button primary authGateModal__cta"
          disabled={pending}
          onClick={() => {
            handleSignIn().catch(() => {});
          }}
        >
          <span className="icon">login</span>
          {pending ? t('signingIn') : t('continueWithGoogle')}
        </button>
        <p className="authGateModal__hint">{t('trialEndedHint')}</p>
        {error ? <p className="authGateModal__error">{error}</p> : null}
      </div>
    </div>
  );
}
