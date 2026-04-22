import { useEffect } from 'react';
import { getWebSocketClient } from '../lib/websocket';
import { useTabsStore, sessionKey } from '../stores/tabsStore';
import { useSessionStore } from '../stores/sessionStore';
import { useUIStore } from '../stores/uiStore';

function openSnippetTab(id: string, content: string): void {
  let name = id;
  try {
    const data = JSON.parse(content);
    if (!data?.proposedEdit || typeof data.proposedEdit.newCode !== 'string') return;
    if (typeof data.filePath === 'string' && data.filePath) {
      name = data.filePath.split('/').pop() || data.filePath;
    } else if (typeof data.name === 'string' && data.name) {
      name = data.name;
    }
  } catch {
    return;
  }

  const currentSession = useSessionStore.getState().currentSession;
  if (!currentSession) return;
  const key = sessionKey(currentSession.project, currentSession.name);
  const entry = useTabsStore.getState().bySession[key];
  if (entry?.activeTabId === id) return;

  useTabsStore.getState().openPermanent({
    id,
    kind: 'artifact',
    artifactType: 'snippet',
    artifactId: id,
    name,
  });
}

export function useProposedEditWatcher(): void {
  // Re-run when the active session changes so backfill sees the right snippets
  const currentSessionName = useSessionStore((s) => s.currentSession?.name);

  useEffect(() => {
    const currentSession = useSessionStore.getState().currentSession;
    if (!currentSession) return;

    // Sync pairMode from server for this session
    fetch(
      `/api/pair-mode?project=${encodeURIComponent(currentSession.project)}&session=${encodeURIComponent(currentSession.name)}`
    )
      .then((r) => r.json())
      .then((data: any) => {
        if (typeof data.pairMode === 'boolean') {
          useUIStore.getState().setPairMode(data.pairMode);
        }
      })
      .catch(() => {});

    // Backfill: open tabs for any snippets that already have a pending proposedEdit
    const snippets = useSessionStore.getState().snippets;
    for (const snippet of snippets) {
      if (snippet.content) openSnippetTab(snippet.id, snippet.content);
    }
  }, [currentSessionName]);

  // Live WS listener: open tab when a new proposal arrives
  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client.onMessage((msg: any) => {
      if (!msg || msg.type !== 'snippet_updated') return;
      const { id, content, project, session } = msg as {
        id?: string;
        content?: string;
        project?: string;
        session?: string;
      };
      if (!id || !content) return;

      const currentSession = useSessionStore.getState().currentSession;
      if (
        !currentSession ||
        project !== currentSession.project ||
        session !== currentSession.name
      ) return;

      openSnippetTab(id, content);
    });

    return () => sub.unsubscribe();
  }, []);
}

export default useProposedEditWatcher;
