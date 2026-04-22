import { useSessionStore } from '../stores/sessionStore';
import { useTabsStore, sessionKey } from '../stores/tabsStore';

export async function promoteCodeFile(tabId: string): Promise<void> {
  const tabsState = useTabsStore.getState();
  const sessionState = useSessionStore.getState();
  const currentSession = sessionState.currentSession;

  if (!currentSession || !currentSession.project || !currentSession.name) {
    return;
  }

  const key = sessionKey(currentSession.project, currentSession.name);
  const entry = tabsState.getSessionTabs(key);
  const tab = entry.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  if (tab.kind !== 'code-file') {
    tabsState.promoteToPermanent(tabId);
    return;
  }

  const stem = tab.artifactId;
  const absPath = stem.startsWith('/')
    ? stem
    : `${currentSession.project.replace(/\/$/, '')}/${stem}`;

  try {
    const response = await fetch(
      `/api/code/create?project=${encodeURIComponent(currentSession.project)}&session=${encodeURIComponent(currentSession.name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: absPath, name: tab.name }),
      },
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as any;
      throw new Error(err?.error ?? `Failed to create code artifact (${response.status})`);
    }

    const data = await response.json() as { id: string; success: boolean };
    const snippetId = data.id;

    tabsState.closeTab(tabId);
    tabsState.openPermanent({
      id: snippetId,
      kind: 'artifact',
      artifactType: 'snippet',
      artifactId: snippetId,
      name: tab.name,
    });
  } catch (err) {
    console.error('[promoteCodeFile] failed to promote code-file tab', err);
    throw err;
  }
}
