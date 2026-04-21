import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: {
    getState: vi.fn(),
  },
}));

vi.mock('../../stores/tabsStore', () => ({
  useTabsStore: {
    getState: vi.fn(),
  },
  sessionKey: (project: string, name: string) => `${project}::${name}`,
}));

vi.mock('../link-file', () => ({
  linkFile: vi.fn(),
}));

import { promoteCodeFile } from '../promote-code-file';
import { useSessionStore } from '../../stores/sessionStore';
import { useTabsStore } from '../../stores/tabsStore';
import { linkFile } from '../link-file';

const PROJECT = '/abs/project';
const SESSION = 'sess';

function makeTabsState(tabs: any[]) {
  const closeTab = vi.fn();
  const openPermanent = vi.fn();
  const promoteToPermanent = vi.fn();
  const getSessionTabs = vi.fn(() => ({ tabs, activeTabId: null, rightPaneTabId: null }));
  return {
    state: { closeTab, openPermanent, promoteToPermanent, getSessionTabs },
    closeTab,
    openPermanent,
    promoteToPermanent,
  };
}

describe('promoteCodeFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: no matching snippet → linkFile called once, closeTab + openPermanent with new snippetId', async () => {
    const tab = {
      id: 'tab-1',
      kind: 'code-file',
      artifactId: '/abs/foo.ts',
      name: 'foo.ts',
    };
    const { state, closeTab, openPermanent } = makeTabsState([tab]);

    (useSessionStore.getState as any).mockReturnValue({
      currentSession: { project: PROJECT, name: SESSION },
      snippets: [],
    });
    (useTabsStore.getState as any).mockReturnValue(state);
    (linkFile as any).mockResolvedValue('new-snip-id');

    await promoteCodeFile('tab-1');

    expect(linkFile).toHaveBeenCalledTimes(1);
    expect(linkFile).toHaveBeenCalledWith(PROJECT, SESSION, '/abs/foo.ts');
    expect(closeTab).toHaveBeenCalledWith('tab-1');
    expect(openPermanent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'new-snip-id',
        kind: 'artifact',
        artifactType: 'snippet',
        artifactId: 'new-snip-id',
        name: 'foo.ts',
      })
    );
  });

  it('dedupe: snippet envelope with matching filePath → linkFile NOT called, existing id used', async () => {
    const tab = {
      id: 'tab-2',
      kind: 'code-file',
      artifactId: '/abs/foo.ts',
      name: 'foo.ts',
    };
    const { state, closeTab, openPermanent } = makeTabsState([tab]);

    (useSessionStore.getState as any).mockReturnValue({
      currentSession: { project: PROJECT, name: SESSION },
      snippets: [
        { id: 'existing-snip', content: JSON.stringify({ filePath: '/abs/foo.ts', linked: true }) },
      ],
    });
    (useTabsStore.getState as any).mockReturnValue(state);

    await promoteCodeFile('tab-2');

    expect(linkFile).not.toHaveBeenCalled();
    expect(closeTab).toHaveBeenCalledWith('tab-2');
    expect(openPermanent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'existing-snip', artifactId: 'existing-snip' })
    );
  });

  it('non-code-file tab: falls through to promoteToPermanent', async () => {
    const tab = {
      id: 'tab-3',
      kind: 'artifact',
      artifactType: 'diagram',
      artifactId: 'diag-1',
      name: 'My Diagram',
    };
    const { state, promoteToPermanent } = makeTabsState([tab]);

    (useSessionStore.getState as any).mockReturnValue({
      currentSession: { project: PROJECT, name: SESSION },
      snippets: [],
    });
    (useTabsStore.getState as any).mockReturnValue(state);

    await promoteCodeFile('tab-3');

    expect(promoteToPermanent).toHaveBeenCalledWith('tab-3');
    expect(linkFile).not.toHaveBeenCalled();
  });
});
