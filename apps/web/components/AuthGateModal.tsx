import { useState } from 'react';
import { signInWithGoogle } from '../firebase';
import { useAuthGate } from '@/lib/state';
import { useTranslation, useLanguage } from '@/lib/i18n';

export default function AuthGateModal() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [readPrivacy, setReadPrivacy] = useState(false);
  const { isAuthenticated, trialExpired } = useAuthGate();
  const { t } = useTranslation();
  const { language } = useLanguage();

  if (!trialExpired || isAuthenticated) {
    return null;
  }

  const privacyHref = language === 'es' ? '/privacidad' : '/privacy';
  const termsHref = language === 'es' ? '/terminos' : '/terms';
  const canSignIn = acceptedTerms && readPrivacy && !pending;

  async function handleSignIn() {
    setPending(true);
    setError('');

    try {
      await signInWithGoogle();
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

        <div className="authGateModal__clickwrap">
          <label className="authGateModal__checkbox">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={e => setAcceptedTerms(e.target.checked)}
            />
            <span>
              {t('clickwrapAcceptTerms')}{' '}
              <a href={termsHref} target="_blank" rel="noopener noreferrer">
                {t('legalTerms')}
              </a>{' '}
              <em className="authGateModal__required">({t('clickwrapRequired')})</em>
            </span>
          </label>
          <label className="authGateModal__checkbox">
            <input
              type="checkbox"
              checked={readPrivacy}
              onChange={e => setReadPrivacy(e.target.checked)}
            />
            <span>
              {t('clickwrapReadPrivacy')}{' '}
              <a href={privacyHref} target="_blank" rel="noopener noreferrer">
                {t('legalPrivacy')}
              </a>{' '}
              <em className="authGateModal__required">({t('clickwrapRequired')})</em>
            </span>
          </label>
        </div>

        <button
          type="button"
          className="button primary authGateModal__cta"
          disabled={!canSignIn}
          onClick={() => {
            if (canSignIn) {
              handleSignIn().catch(() => {});
            }
          }}
        >
          <span className="icon">login</span>
          {pending ? t('signingIn') : t('continueWithGoogle')}
        </button>
        {error ? <p className="authGateModal__error">{error}</p> : null}
      </div>
    </div>
  );
}
