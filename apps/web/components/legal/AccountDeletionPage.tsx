import { useEffect, useState } from 'react';
import LegalLayout from './LegalLayout';
import {
  auth,
  onAuthStateChanged,
  signInWithGoogle,
  signOutFromGoogle,
} from '../../firebase';
import { deleteAccount } from '@/lib/account-deletion';
import { useTranslation } from '@/lib/i18n';
import { confirmDestructive } from '@/lib/confirm-dialog';

type DeletionState = 'idle' | 'signing-in' | 'deleting' | 'success' | 'error';

export default function AccountDeletionPage() {
  const { language, t } = useTranslation();
  const [email, setEmail] = useState(auth.currentUser?.email || '');
  const [state, setState] = useState<DeletionState>('idle');

  useEffect(() => {
    return onAuthStateChanged(auth, user => {
      setEmail(user?.email || '');
    });
  }, []);

  async function handleSignIn() {
    setState('signing-in');
    try {
      const result = await signInWithGoogle();
      setEmail(result.user.email || '');
      setState('idle');
    } catch {
      setState('error');
    }
  }

  async function handleDelete() {
    const user = auth.currentUser;
    if (!user) {
      await handleSignIn();
      return;
    }

    const confirmed = await confirmDestructive({
      title: t('accountDeleteConfirmTitle'),
      text: t('accountDeleteConfirm'),
      confirmText: t('accountDeletionDelete'),
      cancelText: t('confirmCancel'),
    });
    if (!confirmed) return;

    setState('deleting');
    try {
      const token = await user.getIdToken(true);
      await deleteAccount(token);
      await signOutFromGoogle();
      setEmail('');
      setState('success');
    } catch {
      setState('error');
    }
  }

  const isBusy = state === 'signing-in' || state === 'deleting';

  return (
    <LegalLayout
      title={t('accountDeletionTitle')}
      lang={language}
    >
      <p>{t('accountDeletionIntro')}</p>
      {email ? (
        <>
          <p>{t('accountDeletionSignedIn').replace('{email}', email)}</p>
          <button
            type="button"
            className="button primary"
            disabled={isBusy}
            onClick={() => {
              void handleDelete();
            }}
          >
            {state === 'deleting'
              ? t('accountDeleting')
              : t('accountDeletionDelete')}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="button primary"
          disabled={isBusy}
          onClick={() => {
            void handleSignIn();
          }}
        >
          {state === 'signing-in'
            ? t('signingIn')
            : t('accountDeletionSignIn')}
        </button>
      )}
      {state === 'success' ? <p>{t('accountDeletionSuccess')}</p> : null}
      {state === 'error' ? <p>{t('accountDeletionError')}</p> : null}
    </LegalLayout>
  );
}
