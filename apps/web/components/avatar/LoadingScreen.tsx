import { useLiveAPIContext } from '@/contexts/LiveAPIContext';
import { useAuthGate } from '@/lib/state';
import { useTranslation } from '@/lib/i18n';
import { useEffect, useRef } from 'react';

export default function LoadingScreen() {
  const { connecting, fatalError, displayError, audioReady, audioStarting, audioError, startAudio } = useLiveAPIContext();
  const { authReady, trialExpired, isAuthenticated } = useAuthGate();
  const { t, language } = useTranslation();
  const startButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (authReady && !audioReady && !audioStarting) startButtonRef.current?.focus();
  }, [authReady, audioReady, audioStarting, isAuthenticated]);

  if (trialExpired && !isAuthenticated) return null;
  if (!authReady) return null;
  if (fatalError || displayError) return null;
  if (audioReady && !connecting) return null;

  if (!audioReady) {
    return (
      <section
        className="audio-welcome"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audio-welcome-title"
        onKeyDown={event => {
          if (event.key !== 'Tab') return;
          const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="audio-welcome__content">
          <h1 id="audio-welcome-title" className="audio-welcome__title">{t('audioPermissionTitle')}</h1>
          <button
            type="button"
            ref={startButtonRef}
            className="audio-welcome__start"
            onClick={() => { void startAudio(); }}
            disabled={audioStarting}
            aria-busy={audioStarting}
            aria-describedby="audio-welcome-title"
          >
            <span className="audio-welcome__microphone" aria-hidden="true">
              {audioStarting ? (
                <span className="audio-welcome__spinner" />
              ) : (
                <svg viewBox="0 0 32 32" fill="none">
                  <rect x="11" y="3" width="10" height="17" rx="5" stroke="currentColor" strokeWidth="2" />
                  <path d="M6.5 14.5v1a9.5 9.5 0 0 0 19 0v-1M16 25v4m-5 0h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
            </span>
            <span className="audio-welcome__label">{t(audioStarting ? 'audioStarting' : audioError ? 'audioRetry' : 'audioStart')}</span>
          </button>
          <div className="audio-welcome__feedback">
            {audioStarting && <p role="status">{t('audioPermissionWaiting')}</p>}
            {audioError && <p role="alert">{t(audioError)}</p>}
          </div>
        </div>
        <a className="audio-welcome__privacy" href={language === 'es' ? '/privacidad' : '/privacy'} target="_blank" rel="noopener noreferrer">{t('legalPrivacy')}</a>
      </section>
    );
  }

  return (
    <div className="loading-screen" role="status">
      <div className="loading-screen__orb" aria-hidden="true" />
      <div className="loading-screen__text">{t('connecting')}</div>
    </div>
  );
}
