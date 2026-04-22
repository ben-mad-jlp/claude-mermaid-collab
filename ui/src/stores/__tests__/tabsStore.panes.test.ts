import { describe, it, expect, beforeEach } from 'vitest';
import { useTabsStore, sessionKey, useSessionTabs } from '../tabsStore';
import { useSessionStore } from '../sessionStore';

function makeTab(id: string, overrides: Partial<{ name: string; artifactId: string }> = {}) {
  return {
    id,
    kind: 'artifact' as const,
    artifactType: 'diagram' as const,
    artifactId: overrides.artifactId ?? id,
    name: overrides.name ?? `Tab ${id}`,
  };
}

function getCurrentEntry() {
  const cs = useSessionStore.getState().currentSession!;
  const key = sessionKey(cs.project, cs.name);
  return (useTabsStore.getState() as any).bySession[key];
}

/**
 * Helper to get the synthesized panes view (same as useSessionTabs hook but callable outside React).
 * useSessionTabs is a hook but its logic is replicable: reads bySession + rightPaneTabId.
 */
function getPanesView() {
  const cs = useSessionStore.getState().currentSession!;
  const key = sessionKey(cs.project, cs.name);
  const entry = (useTabsStore.getState() as any).bySession[key];
  if (!entry) return null;
  const leftPane = { tabs: entry.tabs, activeTabId: entry.activeTabId };
  const rightTab = entry.rightPaneTabId
    ? entry.tabs.find((t: any) => t.id === entry.rightPaneTabId)
    : undefined;
  const rightPane = {
    tabs: rightTab ? [rightTab] : [],
    activeTabId: entry.rightPaneTabId,
  };
  return { ...entry, panes: { left: leftPane, right: rightPane } };
}

describe('useTabsStore panes', () => {
  beforeEach(() => {
    useTabsStore.setState({ bySession: {} } as any);
    localStorage.clear();
    useSessionStore.setState({
      currentSession: { project: '/p', name: 's1' } as any,
    });
  });

  describe('moveTabBetweenPanes', () => {
    it('preserves metadata (isPinned, artifactId, kind, name) when moving', () => {
      const store = useTabsStore.getState() as any;
      store.openPermanent(makeTab('a'));
      store.openPermanent(makeTab('b'));
      (useTabsStore.getState() as any).pinTab('b');

      // b is pinned. Move to right pane via pinTabRight (underlying mechanism)
      (useTabsStore.getState() as any).moveTabBetweenPanes('b', 'left', 'right');

      const entry = getCurrentEntry();
      // In the new model, rightPaneTabId = 'b', all tabs remain in flat list
      expect(entry.rightPaneTabId).toBe('b');
      const bTab = entry.tabs.find((t: any) => t.id === 'b');
      expect(bTab).toBeDefined();
      expect(bTab.isPinned).toBe(true);
      expect(bTab.artifactId).toBe('b');
      expect(bTab.kind).toBe('artifact');
      expect(bTab.name).toBe('Tab b');
    });

    it('setting rightPaneTabId synthesizes correct panes view', () => {
      const store = useTabsStore.getState() as any;
      store.openPermanent(makeTab('a'));
      store.openPermanent(makeTab('b'));
      (useTabsStore.getState() as any).setActive('b');

      (useTabsStore.getState() as any).moveTabBetweenPanes('b', 'left', 'right');

      const view = getPanesView()!;
      // Both tabs are in left pane (flat list)
      expect(view.panes.left.tabs.map((t: any) => t.id)).toContain('a');
      expect(view.panes.left.tabs.map((t: any) => t.id)).toContain('b');
      // Right pane shows the pinned-right tab
      expect(view.panes.right.tabs.map((t: any) => t.id)).toEqual(['b']);
      expect(view.panes.right.activeTabId).toBe('b');
    });

    it('inserts at given index is ignored (no-op) in new model', () => {
      const store = useTabsStore.getState() as any;
      store.openPermanent(makeTab('x'));
      store.openPermanent(makeTab('y'));
      store.openPermanent(makeTab('new'));

      // Move to right pane — insertAtIndex is ignored
      (useTabsStore.getState() as any).moveTabBetweenPanes('x', 'left', 'right', 1);

      const entry = getCurrentEntry();
      expect(entry.rightPaneTabId).toBe('x');
    });

    it('renumbers order on source pane after removal — tabs stay in flat list', () => {
      const store = useTabsStore.getState() as any;
      store.openPermanent(makeTab('a'));
      store.openPermanent(makeTab('b'));
      store.openPermanent(makeTab('c'));

      // Move middle 'b' to right
      (useTabsStore.getState() as any).moveTabBetweenPanes('b', 'left', 'right');

      const entry = getCurrentEntry();
      // In new model, all tabs remain; only rightPaneTabId changes
      expect(entry.tabs.map((t: any) => t.id)).toContain('a');
      expect(entry.tabs.map((t: any) => t.id)).toContain('b');
      expect(entry.tabs.map((t: any) => t.id)).toContain('c');
      expect(entry.rightPaneTabId).toBe('b');
    });

    it('no-op when fromPane === toPane', () => {
      const store = useTabsStore.getState() as any;
      store.openPermanent(makeTab('a'));
      store.openPermanent(makeTab('b'));

      const before = JSON.stringify(getCurrentEntry());
      (useTabsStore.getState() as any).moveTabBetweenPanes('a', 'left', 'left');
      const after = JSON.stringify(getCurrentEntry());
      expect(after).toBe(before);
    });

    it('no-op when tab not found in fromPane', () => {
      const store = useTabsStore.getState() as any;
      store.openPermanent(makeTab('a'));

      const before = JSON.stringify(getCurrentEntry());
      (useTabsStore.getState() as any).moveTabBetweenPanes('ghost', 'left', 'right');
      const after = JSON.stringify(getCurrentEntry());
      expect(after).toBe(before);
    });
  });

  describe('setActivePaneId', () => {
    it('is a no-op (left is always the interactive pane)', () => {
      const store = useTabsStore.getState() as any;
      store.openPermanent(makeTab('a'));

      // setActivePaneId is a no-op in the new model
      (useTabsStore.getState() as any).setActivePaneId('right');

      const entry = getCurrentEntry();
      // activePaneId always stays 'left'
      expect(entry.activePaneId).toBe('left');
    });

    it('is a no-op even when target pane has a tab pinned to right', () => {
      const store = useTabsStore.getState() as any;
      store.openPermanent(makeTab('a'));
      store.openPermanent(makeTab('b'));

      // Pin b to right
      (useTabsStore.getState() as any).moveTabBetweenPanes('b', 'left', 'right');

      (useTabsStore.getState() as any).setActivePaneId('left');
      expect(getCurrentEntry().activePaneId).toBe('left');

      // setActivePaneId('right') is a no-op
      (useTabsStore.getState() as any).setActivePaneId('right');
      expect(getCurrentEntry().activePaneId).toBe('left');
    });
  });

  describe('persist v3 migration', () => {
    it('clears legacy state on version < 3 migration', async () => {
      const key = sessionKey('/p', 's1');
      const legacy = {
        state: {
          bySession: {
            [key]: { tabs: [{ id: 'a' }], activeTabId: 'a' },
          },
        },
        version: 1,
      };
      localStorage.setItem('collab.tabs.v3', JSON.stringify(legacy));

      await (useTabsStore as any).persist.rehydrate();

      const bySession = (useTabsStore.getState() as any).bySession;
      // v3 migration wipes everything for version < 3
      expect(bySession).toEqual({});
    });
  });

  describe('pinTabRight / unpinTabRight', () => {
    it('pinTabRight sets rightPaneTabId, unpinTabRight clears it', () => {
      const store = useTabsStore.getState() as any;
      store.openPermanent(makeTab('a'));
      store.openPermanent(makeTab('b'));

      store.pinTabRight('b');
      expect(getCurrentEntry().rightPaneTabId).toBe('b');

      store.unpinTabRight('b');
      expect(getCurrentEntry().rightPaneTabId).toBeNull();
    });

    it('unpinTabRight is a no-op if id does not match current rightPaneTabId', () => {
      const store = useTabsStore.getState() as any;
      store.openPermanent(makeTab('a'));
      store.openPermanent(makeTab('b'));

      store.pinTabRight('b');
      store.unpinTabRight('a'); // 'a' is not the pinned-right tab
      expect(getCurrentEntry().rightPaneTabId).toBe('b');
    });
  });
});
