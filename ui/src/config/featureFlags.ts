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
  // Bridge P4: the focal DecisionCard is now the always-on act surface — default
  // ON, only disabled by an explicit '0'/'false' opt-out in storage.
  jsonRenderDecisionCard: true,
};

function isTruthy(value: string | null): boolean {
  return value === '1' || value === 'true';
}

/** A flag that defaults ON: absent ⇒ true; present ⇒ honour the stored value. */
function isOnByDefault(value: string | null): boolean {
  return value === null ? true : isTruthy(value);
}

function readFlags(): FeatureFlags {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    return {
      wysiwygDocumentEditor: isTruthy(window.localStorage.getItem(STORAGE_KEY)),
      jsonRenderDecisionCard: isOnByDefault(window.localStorage.getItem(JSON_RENDER_KEY)),
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
    // Defaults ON, so the OFF case must persist an explicit '0' (removing the
    // key would fall back to the default-on state).
    window.localStorage.setItem(JSON_RENDER_KEY, enabled ? '1' : '0');
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
