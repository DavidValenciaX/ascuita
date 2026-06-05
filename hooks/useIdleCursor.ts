import { useEffect } from 'react';

export function useIdleCursor(timeoutMs: number = 3000) {
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const onMouseMove = () => {
      document.body.classList.remove('cursor-hidden');
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        document.body.classList.add('cursor-hidden');
      }, timeoutMs);
    };

    const onMouseLeave = () => {
      clearTimeout(timeoutId);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchstart', onMouseMove);
    window.addEventListener('mouseleave', onMouseLeave);

    // Initial trigger
    timeoutId = setTimeout(() => {
      document.body.classList.add('cursor-hidden');
    }, timeoutMs);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchstart', onMouseMove);
      window.removeEventListener('mouseleave', onMouseLeave);
      clearTimeout(timeoutId);
      document.body.classList.remove('cursor-hidden');
    };
  }, [timeoutMs]);
}
