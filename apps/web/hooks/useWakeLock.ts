import { useEffect } from 'react';

/**
 * Keeps the screen on while the page is visible, using the Screen Wake Lock API.
 * The browser releases the lock automatically when the tab is hidden, so it is
 * re-requested whenever the page becomes visible again. No-op where unsupported.
 */
export function useWakeLock(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;

    const request = async () => {
      if (disposed || document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (disposed) {
          void lock.release();
          return;
        }
        sentinel = lock;
      } catch {
        // Denied (e.g. battery saver, not user-activated yet). Retried on next interaction/visibility change.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void request();
    };

    void request();
    document.addEventListener('visibilitychange', onVisibilityChange);
    // Some browsers require a user gesture before granting the lock.
    window.addEventListener('pointerdown', request);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pointerdown', request);
      if (sentinel && !sentinel.released) void sentinel.release();
      sentinel = null;
    };
  }, [enabled]);
}
