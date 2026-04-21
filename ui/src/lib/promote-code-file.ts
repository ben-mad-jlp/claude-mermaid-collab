import { useSessionStore } from '../stores/sessionStore';
import { useTabsStore, sessionKey } from '../stores/tabsStore';
import { linkFile } from './link-file';

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

  let existingId: string | undefined;
  for (const s of sessionState.snippets) {
    try {
      const parsed = JSON.parse(s.content);
      if (parsed?.filePath === absPath) {
        existingId = s.id;
        break;
      }
    } catch {
      continue;
    }
  }

  try {
    const snippetId =
      existingId ??
      (await linkFile(currentSession.project, currentSession.name, absPath));

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
