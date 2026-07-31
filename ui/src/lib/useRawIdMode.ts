import { useState, useCallback } from 'react';

const RAW_ID_MODE_KEY = 'collab.entityDisplay.raw';

function readPersistedRawMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(RAW_ID_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function useRawIdMode(): [boolean, (raw: boolean) => void] {
  const [raw, setRawState] = useState<boolean>(readPersistedRawMode);

  const setRaw = useCallback((next: boolean) => {
    setRawState(next);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(RAW_ID_MODE_KEY, String(next));
      }
    } catch {
      // localStorage unavailable — in-memory state still updates
    }
  }, []);

  return [raw, setRaw];
}
