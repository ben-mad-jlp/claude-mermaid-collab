import { describe, it, expect, beforeEach } from 'vitest';
import { useSidebarTreeStore } from '../sidebarTreeStore';

const sortedIds = (ids: Set<string>) => Array.from(ids).sort();

describe('sidebarTreeStore multiSelection', () => {
  beforeEach(() => {
    useSidebarTreeStore.getState().clearSelection();
  });

  it('setSelection replaces ids and sets anchor, clears anchor when omitted', () => {
    const { setSelection } = useSidebarTreeStore.getState();
    setSelection(['a', 'b'], 'a');
    let state = useSidebarTreeStore.getState();
    expect(sortedIds(state.multiSelection.ids)).toEqual(['a', 'b']);
    expect(state.multiSelection.anchorId).toBe('a');

    setSelection(['c']);
    state = useSidebarTreeStore.getState();
    expect(sortedIds(state.multiSelection.ids)).toEqual(['c']);
    expect(state.multiSelection.anchorId).toBeNull();
  });

  it('toggleInSelection adds id when absent and updates anchorId', () => {
    const { toggleInSelection } = useSidebarTreeStore.getState();
    toggleInSelection('x');
    const state = useSidebarTreeStore.getState();
    expect(sortedIds(state.multiSelection.ids)).toEqual(['x']);
    expect(state.multiSelection.anchorId).toBe('x');
  });

  it('toggleInSelection removes id when present (anchor shifts to remaining id)', () => {
    const { setSelection, toggleInSelection } = useSidebarTreeStore.getState();
    setSelection(['x', 'y'], 'x');
    toggleInSelection('x');
    const state = useSidebarTreeStore.getState();
    expect(sortedIds(state.multiSelection.ids)).toEqual(['y']);
    expect(state.multiSelection.anchorId).toBe('y');
  });

  it('toggleInSelection with explicit anchor override', () => {
    const { toggleInSelection } = useSidebarTreeStore.getState();
    toggleInSelection('z', 'y');
    const state = useSidebarTreeStore.getState();
    expect(state.multiSelection.anchorId).toBe('y');
    expect(state.multiSelection.ids.has('z')).toBe(true);
  });

  it('extendSelectionTo with null anchor seeds to [id],id', () => {
    const { extendSelectionTo } = useSidebarTreeStore.getState();
    extendSelectionTo('a', ['a', 'b', 'c']);
    const state = useSidebarTreeStore.getState();
    expect(sortedIds(state.multiSelection.ids)).toEqual(['a']);
    expect(state.multiSelection.anchorId).toBe('a');
  });

  it('extendSelectionTo forward range', () => {
    const { setSelection, extendSelectionTo } = useSidebarTreeStore.getState();
    setSelection(['a'], 'a');
    extendSelectionTo('c', ['a', 'b', 'c', 'd']);
    const state = useSidebarTreeStore.getState();
    expect(sortedIds(state.multiSelection.ids)).toEqual(['a', 'b', 'c']);
    expect(state.multiSelection.anchorId).toBe('a');
  });

  it('extendSelectionTo backward range', () => {
    const { setSelection, extendSelectionTo } = useSidebarTreeStore.getState();
    setSelection(['c'], 'c');
    extendSelectionTo('a', ['a', 'b', 'c', 'd']);
    const state = useSidebarTreeStore.getState();
    expect(sortedIds(state.multiSelection.ids)).toEqual(['a', 'b', 'c']);
    expect(state.multiSelection.anchorId).toBe('c');
  });

  it('extendSelectionTo with stale anchor falls back to single', () => {
    const { setSelection, extendSelectionTo } = useSidebarTreeStore.getState();
    setSelection(['zzz'], 'zzz');
    extendSelectionTo('b', ['a', 'b', 'c', 'd']);
    const state = useSidebarTreeStore.getState();
    expect(sortedIds(state.multiSelection.ids)).toEqual(['b']);
    expect(state.multiSelection.anchorId).toBe('b');
  });

  it('extendSelectionTo with target not in visibleOrder falls back to single', () => {
    const { setSelection, extendSelectionTo } = useSidebarTreeStore.getState();
    setSelection(['a'], 'a');
    extendSelectionTo('missing', ['a', 'b', 'c', 'd']);
    const state = useSidebarTreeStore.getState();
    expect(sortedIds(state.multiSelection.ids)).toEqual(['missing']);
    expect(state.multiSelection.anchorId).toBe('missing');
  });

  it('clearSelection resets', () => {
    const { setSelection, clearSelection } = useSidebarTreeStore.getState();
    setSelection(['a', 'b'], 'a');
    clearSelection();
    const state = useSidebarTreeStore.getState();
    expect(sortedIds(state.multiSelection.ids)).toEqual([]);
    expect(state.multiSelection.anchorId).toBeNull();
  });
});
