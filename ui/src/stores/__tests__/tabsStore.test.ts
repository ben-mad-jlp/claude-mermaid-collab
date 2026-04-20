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
  return useTabsStore.getState().bySession[key] ?? { tabs: [], activeTabId: null };
}

describe('useTabsStore', () => {
  beforeEach(() => {
    useTabsStore.setState({ bySession: {} });
    localStorage.clear();
    useSessionStore.setState({
      currentSession: { project: '/p', name: 's1' } as any,
    });
  });

  describe('openPreview', () => {
    it('appends with isPreview=true when no preview exists', () => {
      useTabsStore.getState().openPreview(makeTab('a'));
      const entry = getCurrentEntry();
      expect(entry.tabs).toHaveLength(1);
      expect(entry.tabs[0].id).toBe('a');
      expect(entry.tabs[0].isPreview).toBe(true);
      expect(entry.activeTabId).toBe('a');
    });

    it('replaces existing preview tab in-place', () => {
      const store = useTabsStore.getState();
      // First open a permanent tab so there's a non-preview ahead of the preview.
      store.openPermanent(makeTab('perm'));
      store.openPreview(makeTab('p1'));
      let entry = getCurrentEntry();
      const p1Order = entry.tabs.find((t) => t.id === 'p1')!.order;
      expect(entry.tabs.map((t) => t.id)).toEqual(['perm', 'p1']);

      // Open a new preview — should replace p1 in-place.
      useTabsStore.getState().openPreview(makeTab('p2'));
      entry = getCurrentEntry();
      expect(entry.tabs).toHaveLength(2);
      expect(entry.tabs.map((t) => t.id)).toEqual(['perm', 'p2']);
      const p2 = entry.tabs.find((t) => t.id === 'p2')!;
      expect(p2.isPreview).toBe(true);
      expect(p2.order).toBe(p1Order);
      expect(entry.activeTabId).toBe('p2');
      // previous preview removed
      expect(entry.tabs.find((t) => t.id === 'p1')).toBeUndefined();
    });

    it('on already-open id only activates', () => {
      const store = useTabsStore.getState();
      store.openPermanent(makeTab('a'));
      store.openPermanent(makeTab('b'));
      // Make 'a' active by calling openPreview on it.
      useTabsStore.getState().openPreview(makeTab('a'));
      const entry = getCurrentEntry();
      expect(entry.tabs).toHaveLength(2);
      expect(entry.activeTabId).toBe('a');
      // 'a' should still be permanent (isPreview=false), unchanged.
      expect(entry.tabs.find((t) => t.id === 'a')!.isPreview).toBe(false);
    });
  });

  describe('promoteToPermanent', () => {
    it('flips isPreview to false', () => {
      const store = useTabsStore.getState();
      store.openPreview(makeTab('a'));
      useTabsStore.getState().promoteToPermanent('a');
      const entry = getCurrentEntry();
      expect(entry.tabs[0].isPreview).toBe(false);
    });
  });

  describe('pinTab / unpinTab', () => {
    it('toggles isPinned', () => {
      const store = useTabsStore.getState();
      store.openPermanent(makeTab('a'));
      useTabsStore.getState().pinTab('a');
      expect(getCurrentEntry().tabs[0].isPinned).toBe(true);
      useTabsStore.getState().unpinTab('a');
      expect(getCurrentEntry().tabs[0].isPinned).toBe(false);
    });
  });

  describe('closeTab', () => {
    it('active middle tab → next neighbor active', () => {
      const store = useTabsStore.getState();
      store.openPermanent(makeTab('a'));
      store.openPermanent(makeTab('b'));
      store.openPermanent(makeTab('c'));
      useTabsStore.getState().setActive('b');
      useTabsStore.getState().closeTab('b');
      const entry = getCurrentEntry();
      expect(entry.tabs.map((t) => t.id)).toEqual(['a', 'c']);
      expect(entry.activeTabId).toBe('c');
    });

    it('active last tab → previous neighbor active', () => {
      const store = useTabsStore.getState();
      store.openPermanent(makeTab('a'));
      store.openPermanent(makeTab('b'));
      useTabsStore.getState().setActive('b');
      useTabsStore.getState().closeTab('b');
      const entry = getCurrentEntry();
      expect(entry.tabs.map((t) => t.id)).toEqual(['a']);
      expect(entry.activeTabId).toBe('a');
    });

    it('only-tab → activeTabId null', () => {
      useTabsStore.getState().openPermanent(makeTab('a'));
      useTabsStore.getState().closeTab('a');
      const entry = getCurrentEntry();
      expect(entry.tabs).toHaveLength(0);
      expect(entry.activeTabId).toBeNull();
    });

    it('non-active tab → activeTabId preserved', () => {
      const store = useTabsStore.getState();
      store.openPermanent(makeTab('a'));
      store.openPermanent(makeTab('b'));
      useTabsStore.getState().setActive('a');
      useTabsStore.getState().closeTab('b');
      const entry = getCurrentEntry();
      expect(entry.tabs.map((t) => t.id)).toEqual(['a']);
      expect(entry.activeTabId).toBe('a');
    });
  });

  describe('session switch save/restore', () => {
    it('preserves tabs per session', () => {
      // Open tabs under A ('/p','s1')
      const store = useTabsStore.getState();
      store.openPermanent(makeTab('a1'));
      store.openPermanent(makeTab('a2'));
      const keyA = sessionKey('/p', 's1');
      const keyB = sessionKey('/p', 's2');

      const snapshotA = useTabsStore.getState().bySession[keyA];
      expect(snapshotA.tabs.map((t) => t.id)).toEqual(['a1', 'a2']);

      // Switch to B
      useSessionStore.setState({
        currentSession: { project: '/p', name: 's2' } as any,
      });

      // B should be empty
      const entryB = useTabsStore.getState().bySession[keyB];
      expect(entryB).toBeUndefined();
      // A preserved
      expect(useTabsStore.getState().bySession[keyA].tabs.map((t) => t.id)).toEqual([
        'a1',
        'a2',
      ]);

      // Open a tab under B
      useTabsStore.getState().openPermanent(makeTab('b1'));
      expect(useTabsStore.getState().bySession[keyB].tabs.map((t) => t.id)).toEqual(['b1']);

      // Switch back to A
      useSessionStore.setState({
        currentSession: { project: '/p', name: 's1' } as any,
      });
      // A still has its two tabs
      expect(useTabsStore.getState().bySession[keyA].tabs.map((t) => t.id)).toEqual([
        'a1',
        'a2',
      ]);
      // B preserved separately
      expect(useTabsStore.getState().bySession[keyB].tabs.map((t) => t.id)).toEqual(['b1']);
    });
  });
});
