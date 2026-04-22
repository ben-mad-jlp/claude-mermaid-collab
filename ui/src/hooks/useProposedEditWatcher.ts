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

    // Backfill: open tabs for any code files with a pending proposedEdit
    const codeFiles = useSessionStore.getState().codeFiles;
    for (const cf of codeFiles) {
      if (!cf.proposedEdit) continue;
      const key = sessionKey(currentSession.project, currentSession.name);
      const entry = useTabsStore.getState().bySession[key];
      if (entry?.activeTabId === cf.id) continue;
      useTabsStore.getState().openPermanent({
        id: cf.id,
        kind: 'artifact',
        artifactType: 'code',
        artifactId: cf.id,
        name: cf.name,
      });
    }
  }, [currentSessionName]);

  // Live WS listener: open tab when a new proposal arrives
  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client.onMessage((msg: any) => {
      const currentSession = useSessionStore.getState().currentSession;
      if (!currentSession) return;

      if (msg?.type === 'snippet_updated') {
        const { id, content, project, session } = msg as { id?: string; content?: string; project?: string; session?: string };
        if (!id || !content) return;
        if (project !== currentSession.project || session !== currentSession.name) return;
        openSnippetTab(id, content);
        return;
      }

      if (msg?.type === 'code_file_updated') {
        const { id, content, project, session } = msg as { id?: string; content?: string; project?: string; session?: string };
        if (!id || !content) return;
        if (project !== currentSession.project || session !== currentSession.name) return;
        try {
          const record = JSON.parse(content);
          if (!record?.proposedEdit) return;
          const key = sessionKey(currentSession.project, currentSession.name);
          const entry = useTabsStore.getState().bySession[key];
          if (entry?.activeTabId === id) return;
          const codeFiles = useSessionStore.getState().codeFiles;
          const cf = codeFiles.find((f) => f.id === id);
          useTabsStore.getState().openPermanent({
            id,
            kind: 'artifact',
            artifactType: 'code',
            artifactId: id,
            name: cf?.name ?? record?.name ?? id,
          });
        } catch { /* ignore parse errors */ }
      }
    });

    return () => sub.unsubscribe();
  }, []);
}

export default useProposedEditWatcher;
