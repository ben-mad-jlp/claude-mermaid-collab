import { useEffect, useRef } from 'react';

export interface UseIdleDetectorOptions {
  thresholdMs: number;
  onIdleReturn: () => void;
}

export function useIdleDetector({ thresholdMs, onIdleReturn }: UseIdleDetectorOptions): void {
  const lastActivityTsRef = useRef(Date.now());
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionsRef = useRef({ thresholdMs, onIdleReturn });

  useEffect(() => {
    optionsRef.current = { thresholdMs, onIdleReturn };
  });

  useEffect(() => {
    const handleActivity = () => {
      if (throttleRef.current !== null) return;
      throttleRef.current = setTimeout(() => {
        lastActivityTsRef.current = Date.now();
        throttleRef.current = null;
      }, 1000);
    };

    const handleFocus = () => {
      if (Date.now() - lastActivityTsRef.current > optionsRef.current.thresholdMs) {
        optionsRef.current.onIdleReturn();
      }
    };

    window.addEventListener('mousemove', handleActivity, { passive: true });
    window.addEventListener('keydown', handleActivity, { passive: true });
    window.addEventListener('pointerdown', handleActivity, { passive: true });
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('pointerdown', handleActivity);
      window.removeEventListener('focus', handleFocus);
      if (throttleRef.current !== null) {
        clearTimeout(throttleRef.current);
        throttleRef.current = null;
      }
    };
  }, []); // stable — reads from optionsRef
}
