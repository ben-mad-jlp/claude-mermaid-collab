import { useEffect } from 'react';
import { useTabsStore, sessionKey } from '../stores/tabsStore';
import { useSessionStore } from '../stores/sessionStore';

function isEditingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return true;
  if (t.isContentEditable) return true;
  return false;
}

export function useTabKeyboard({ enabled = true }: { enabled?: boolean } = {}): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (isEditingTarget(e) && e.key !== 'Tab') return;
      const session = useSessionStore.getState().currentSession;
      if (!session || !session.project || !session.name) return;
      const key = sessionKey(session.project, session.name);
      const entry = useTabsStore.getState().bySession?.[key];
      if (!entry) return;
      const ordered = [...entry.tabs].sort((a, b) => a.order - b.order);
      if (ordered.length === 0) return;
      const activeIdx = ordered.findIndex((t) => t.id === entry.activeTabId);

      if (e.key === 'Tab') {
        e.preventDefault();
        const dir = e.shiftKey ? -1 : 1;
        const base = activeIdx < 0 ? 0 : activeIdx;
        const next = (base + dir + ordered.length) % ordered.length;
        useTabsStore.getState().setActive(ordered[next].id);
        return;
      }
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        if (entry.activeTabId) useTabsStore.getState().closeTab(entry.activeTabId);
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        if (idx < ordered.length) useTabsStore.getState().setActive(ordered[idx].id);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

export default useTabKeyboard;
