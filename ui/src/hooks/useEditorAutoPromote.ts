import { useEffect } from 'react';
import { useTabsStore, sessionKey } from '../stores/tabsStore';
import { useSessionStore } from '../stores/sessionStore';
import { promoteCodeFile } from '../lib/promote-code-file';

type Listener = (tabId: string) => void;
const listeners = new Set<Listener>();

export const editorDirtyBus = {
  emitDirty(tabId: string) {
    listeners.forEach((l) => l(tabId));
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export function reportEditorDirty(tabId: string) {
  editorDirtyBus.emitDirty(tabId);
}

export function useEditorAutoPromote(): void {
  useEffect(() => {
    const promoted = new Set<string>();
    const unsub = editorDirtyBus.subscribe((tabId) => {
      if (promoted.has(tabId)) return;
      const session = useSessionStore.getState().currentSession;
      if (!session || !session.project || !session.name) return;
      const key = sessionKey(session.project, session.name);
      const bySession = useTabsStore.getState().bySession;
      const entry = bySession?.[key];
      if (!entry) return;
      const tab = entry.tabs.find((t) => t.id === tabId);
      if (!tab) return;
      if (tab.isPreview) {
        if (tab.kind === 'code-file') void promoteCodeFile(tabId);
        else useTabsStore.getState().promoteToPermanent(tabId);
      }
      promoted.add(tabId);
    });
    return unsub;
  }, []);
}

export default useEditorAutoPromote;
