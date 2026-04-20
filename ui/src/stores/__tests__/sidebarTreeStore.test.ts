import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useSidebarTreeStore, type SidebarTreeState } from '../sidebarTreeStore';

describe('useSidebarTreeStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useSidebarTreeStore.setState({
      collapsedSections: new Set<string>(),
      showDeprecated: false,
      searchQuery: '',
      forceExpandedSections: new Set<string>(),
    } as Partial<SidebarTreeState> as SidebarTreeState);
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('toggleSection', () => {
    it('adds id when absent', () => {
      useSidebarTreeStore.getState().toggleSection('section-a');
      const state = useSidebarTreeStore.getState();
      expect(state.collapsedSections.has('section-a')).toBe(true);
    });

    it('removes id when present (toggle twice → empty)', () => {
      const { toggleSection } = useSidebarTreeStore.getState();
      toggleSection('section-a');
      toggleSection('section-a');
      expect(useSidebarTreeStore.getState().collapsedSections.has('section-a')).toBe(false);
      expect(useSidebarTreeStore.getState().collapsedSections.size).toBe(0);
    });

    it('keeps independent ids coexisting', () => {
      const { toggleSection } = useSidebarTreeStore.getState();
      toggleSection('a');
      toggleSection('b');
      const state = useSidebarTreeStore.getState();
      expect(state.collapsedSections.has('a')).toBe(true);
      expect(state.collapsedSections.has('b')).toBe(true);
      expect(state.collapsedSections.size).toBe(2);
    });
  });

  describe('showDeprecated', () => {
    it('defaults to false', () => {
      expect(useSidebarTreeStore.getState().showDeprecated).toBe(false);
    });

    it('setShowDeprecated(true) updates state and persists', () => {
      useSidebarTreeStore.getState().setShowDeprecated(true);
      expect(useSidebarTreeStore.getState().showDeprecated).toBe(true);
      const stored = localStorage.getItem('collab.sidebar.tree.showDeprecated.v1');
      expect(stored).not.toBeNull();
      expect(stored!.length).toBeGreaterThan(0);
    });
  });

  describe('searchQuery', () => {
    it('trims setSearchQuery("  foo  ") to "foo"', () => {
      useSidebarTreeStore.getState().setSearchQuery('  foo  ');
      expect(useSidebarTreeStore.getState().searchQuery).toBe('foo');
    });

    it('empty string clears forceExpandedSections', () => {
      useSidebarTreeStore.getState().setForceExpandedSections(['x', 'y']);
      expect(useSidebarTreeStore.getState().forceExpandedSections.size).toBe(2);
      useSidebarTreeStore.getState().setSearchQuery('');
      expect(useSidebarTreeStore.getState().forceExpandedSections.size).toBe(0);
    });

    it('does not persist searchQuery to localStorage', () => {
      useSidebarTreeStore.getState().setSearchQuery('needle-xyz');
      for (const key of Object.keys(localStorage)) {
        const value = localStorage.getItem(key) ?? '';
        expect(value).not.toContain('searchQuery');
        expect(value).not.toContain('needle-xyz');
      }
    });
  });

  describe('forceExpandedSections', () => {
    it('setForceExpandedSections(["x","y"]) sets a Set', () => {
      useSidebarTreeStore.getState().setForceExpandedSections(['x', 'y']);
      const state = useSidebarTreeStore.getState();
      expect(state.forceExpandedSections).toBeInstanceOf(Set);
      expect(state.forceExpandedSections.has('x')).toBe(true);
      expect(state.forceExpandedSections.has('y')).toBe(true);
    });

    it('setSearchQuery("") clears forceExpandedSections', () => {
      useSidebarTreeStore.getState().setForceExpandedSections(['x', 'y']);
      useSidebarTreeStore.getState().setSearchQuery('');
      expect(useSidebarTreeStore.getState().forceExpandedSections.size).toBe(0);
    });

    it('is not persisted to localStorage', () => {
      useSidebarTreeStore.getState().setForceExpandedSections(['unique-token-abc', 'another-token-def']);
      for (const key of Object.keys(localStorage)) {
        const value = localStorage.getItem(key) ?? '';
        expect(value).not.toContain('unique-token-abc');
        expect(value).not.toContain('another-token-def');
        expect(value).not.toContain('forceExpandedSections');
      }
    });
  });

  describe('collapsed persistence', () => {
    it('persists collapsed section ids to localStorage', () => {
      const { toggleSection } = useSidebarTreeStore.getState();
      toggleSection('sec1');
      toggleSection('sec2');
      const stored = localStorage.getItem('collab.sidebar.tree.collapsed.v1');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      const serialized = JSON.stringify(parsed);
      expect(serialized).toContain('sec1');
      expect(serialized).toContain('sec2');
    });
  });
});
