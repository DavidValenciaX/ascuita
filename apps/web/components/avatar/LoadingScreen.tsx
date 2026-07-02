import { useLiveAPIContext } from '@/contexts/LiveAPIContext';
import { useAuthGate } from '@/lib/state';
import { useTranslation } from '@/lib/i18n';

export default function LoadingScreen() {
  const { connecting, fatalError, displayError, audioReady } = useLiveAPIContext();
  const { authReady, trialExpired, isAuthenticated } = useAuthGate();
  const { t } = useTranslation();

  if (trialExpired && !isAuthenticated) return null;
  if (!authReady) return null;
  if (fatalError || displayError) return null;
  if (audioReady && !connecting) return null;

  let message = t('initializing');
  if (!audioReady) {
    message = t('preparingAudio');
  } else {
    message = t('connecting');
  }

  return (
    <div className="loading-screen">
      <div className="loading-screen__orb" />
      <div className="loading-screen__text">{message}</div>
    </div>
  );
}
