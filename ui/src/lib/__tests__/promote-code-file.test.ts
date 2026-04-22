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

import { promoteCodeFile } from '../promote-code-file';
import { useSessionStore } from '../../stores/sessionStore';
import { useTabsStore } from '../../stores/tabsStore';

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
    // Restore fetch to a fresh mock before each test
    vi.stubGlobal('fetch', vi.fn());
  });

  it('happy path: code-file tab → fetch called, closeTab + openPermanent with returned id', async () => {
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

    // Mock fetch to return a successful response
    (fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ id: 'new-code-id', success: true }),
    });

    await promoteCodeFile('tab-1');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/code/create'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(closeTab).toHaveBeenCalledWith('tab-1');
    expect(openPermanent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'new-code-id',
        kind: 'artifact',
        artifactType: 'snippet',
        artifactId: 'new-code-id',
        name: 'foo.ts',
      })
    );
  });

  it('fetch error: throws and does not call closeTab or openPermanent', async () => {
    const tab = {
      id: 'tab-2',
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

    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ error: 'Internal error' }),
    });

    await expect(promoteCodeFile('tab-2')).rejects.toThrow('Internal error');
    expect(closeTab).not.toHaveBeenCalled();
    expect(openPermanent).not.toHaveBeenCalled();
  });

  it('non-code-file tab: falls through to promoteToPermanent, no fetch', async () => {
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
    expect(fetch).not.toHaveBeenCalled();
  });
});
