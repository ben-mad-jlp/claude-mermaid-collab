import { useEffect, useState } from 'react';

export interface FeatureFlags {
  wysiwygDocumentEditor: boolean;
  /** BR-4: render an escalation's rich `ui` spec in a focal DecisionCard. */
  jsonRenderDecisionCard: boolean;
}

const STORAGE_KEY = 'ff.wysiwygDocumentEditor';
const JSON_RENDER_KEY = 'ff.jsonRenderDecisionCard';
const CHANGE_EVENT = 'featureflags:change';

const DEFAULTS: FeatureFlags = {
  wysiwygDocumentEditor: false,
  jsonRenderDecisionCard: false,
};

function isTruthy(value: string | null): boolean {
  return value === '1' || value === 'true';
}

function readFlags(): FeatureFlags {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    return {
      wysiwygDocumentEditor: isTruthy(window.localStorage.getItem(STORAGE_KEY)),
      jsonRenderDecisionCard: isTruthy(window.localStorage.getItem(JSON_RENDER_KEY)),
    };
  } catch {
    return DEFAULTS;
  }
}

export function setWysiwygDocumentEditor(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
}

export function setJsonRenderDecisionCard(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) window.localStorage.setItem(JSON_RENDER_KEY, '1');
    else window.localStorage.removeItem(JSON_RENDER_KEY);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
}

export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>(() => readFlags());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => setFlags(readFlags());
    const storageHandler = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === JSON_RENDER_KEY) sync();
    };
    window.addEventListener('storage', storageHandler);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', storageHandler);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  return flags;
}

export default useFeatureFlags;
