import { describe, it, expect, beforeEach } from 'vitest';
import { useTabsStore, sessionKey } from '../tabsStore';
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

      const bBefore = getCurrentEntry().panes.left.tabs.find((t: any) => t.id === 'b');
      expect(bBefore.isPinned).toBe(true);

      (useTabsStore.getState() as any).moveTabBetweenPanes('b', 'left', 'right');

      const entry = getCurrentEntry();
      expect(entry.panes.left.tabs.map((t: any) => t.id)).toEqual(['a']);
      const bAfter = entry.panes.right.tabs.find((t: any) => t.id === 'b');
      expect(bAfter).toBeDefined();
      expect(bAfter.isPinned).toBe(true);
      expect(bAfter.artifactId).toBe(bBefore.artifactId);
      expect(bAfter.kind).toBe(bBefore.kind);
      expect(bAfter.name).toBe(bBefore.name);
    });

    it('hands off active tab: left loses active, right gets active, activePaneId switches', () => {
      const store = useTabsStore.getState() as any;
      store.openPermanent(makeTab('a'));
      store.openPermanent(makeTab('b'));
      (useTabsStore.getState() as any).setActive('b');

      (useTabsStore.getState() as any).moveTabBetweenPanes('b', 'left', 'right');

      const entry = getCurrentEntry();
      expect(entry.panes.left.activeTabId).toBe('a');
      expect(entry.panes.right.activeTabId).toBe('b');
      expect(entry.activePaneId).toBe('right');
    });

    it('inserts at given index, renumbers order, and promotes right→left when left empties', () => {
      const store = useTabsStore.getState() as any;
      // Seed left with x, y, new
      store.openPermanent(makeTab('x'));
      store.openPermanent(makeTab('y'));
      store.openPermanent(makeTab('new'));

      // Move x and y to right first
      (useTabsStore.getState() as any).moveTabBetweenPanes('x', 'left', 'right');
      (useTabsStore.getState() as any).moveTabBetweenPanes('y', 'left', 'right');

      // Now move 'new' to right at index 1 — this empties left, which triggers the
      // UX invariant: empty left while right has tabs → promote right's tabs into left
      // so the UI never shows only a right pane.
      (useTabsStore.getState() as any).moveTabBetweenPanes('new', 'left', 'right', 1);

      const entry = getCurrentEntry();
      const leftIds = entry.panes.left.tabs.map((t: any) => t.id);
      expect(leftIds).toEqual(['x', 'new', 'y']);
      const leftOrders = entry.panes.left.tabs.map((t: any) => t.order);
      expect(leftOrders).toEqual([0, 1, 2]);
      expect(entry.panes.right.tabs).toEqual([]);
      expect(entry.activePaneId).toBe('left');
    });

    it('renumbers order on source pane after removal', () => {
      const store = useTabsStore.getState() as any;
      store.openPermanent(makeTab('a'));
      store.openPermanent(makeTab('b'));
      store.openPermanent(makeTab('c'));

      // Move middle 'b' to right
      (useTabsStore.getState() as any).moveTabBetweenPanes('b', 'left', 'right');

      const entry = getCurrentEntry();
      const remaining = entry.panes.left.tabs;
      expect(remaining.map((t: any) => t.id)).toEqual(['a', 'c']);
      expect(remaining.map((t: any) => t.order)).toEqual([0, 1]);
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
    it('is a no-op when target pane has no tabs', () => {
      const store = useTabsStore.getState() as any;
      store.openPermanent(makeTab('a'));

      (useTabsStore.getState() as any).setActivePaneId('right');

      const entry = getCurrentEntry();
      expect(entry.activePaneId).toBe('left');
    });

    it('switches when target pane has tabs', () => {
      const store = useTabsStore.getState() as any;
      store.openPermanent(makeTab('a'));
      store.openPermanent(makeTab('b'));

      // Put 'b' into right — both panes now have tabs
      (useTabsStore.getState() as any).moveTabBetweenPanes('b', 'left', 'right');

      // After move, activePaneId may have switched to right; explicitly set to 'left' first
      (useTabsStore.getState() as any).setActivePaneId('left');
      expect(getCurrentEntry().activePaneId).toBe('left');

      (useTabsStore.getState() as any).setActivePaneId('right');
      expect(getCurrentEntry().activePaneId).toBe('right');
    });
  });

  describe('persist v1→v2 migration', () => {
    it('migrates legacy single-pane bySession entries into panes.left', async () => {
      const legacyTab = {
        id: 'a',
        kind: 'artifact',
        artifactType: 'diagram',
        artifactId: 'a',
        name: 'Tab a',
        isPreview: false,
        isPinned: false,
        order: 0,
        openedAt: 1,
      };
      const key = sessionKey('/p', 's1');
      const legacy = {
        state: {
          bySession: {
            [key]: { tabs: [legacyTab], activeTabId: 'a' },
            'empty::k': { tabs: [], activeTabId: null },
          },
        },
        version: 1,
      };
      localStorage.setItem('collab.tabs.v2', JSON.stringify(legacy));

      await (useTabsStore as any).persist.rehydrate();

      const bySession = (useTabsStore.getState() as any).bySession;
      const migrated = bySession[key];
      expect(migrated.panes).toBeDefined();
      expect(migrated.panes.left.tabs.map((t: any) => t.id)).toEqual(['a']);
      expect(migrated.panes.left.activeTabId).toBe('a');
      expect(migrated.panes.right.tabs).toEqual([]);
      expect(migrated.panes.right.activeTabId).toBeNull();
      expect(migrated.activePaneId).toBe('left');

      const emptyMigrated = bySession['empty::k'];
      expect(emptyMigrated.panes.left.tabs).toEqual([]);
      expect(emptyMigrated.panes.right.tabs).toEqual([]);
    });
  });

  describe('left-empty collapse', () => {
    it('collapses right into left when left becomes empty', () => {
      const store = useTabsStore.getState() as any;
      store.openPermanent(makeTab('a'));
      store.openPermanent(makeTab('b'));

      // Move b to right
      (useTabsStore.getState() as any).moveTabBetweenPanes('b', 'left', 'right');
      // Move a to right — left should now be empty → collapse
      (useTabsStore.getState() as any).moveTabBetweenPanes('a', 'left', 'right');

      const entry = getCurrentEntry();
      // After collapse: what was in right is now in left, right is empty
      expect(entry.panes.left.tabs.map((t: any) => t.id)).toEqual(['b', 'a']);
      expect(entry.panes.right.tabs).toEqual([]);
      expect(entry.activePaneId).toBe('left');
    });
  });
});
