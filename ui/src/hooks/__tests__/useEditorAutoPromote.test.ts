import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditorAutoPromote, reportEditorDirty } from '../useEditorAutoPromote';
import { useTabsStore, sessionKey, type TabDescriptor } from '../../stores/tabsStore';
import { useSessionStore } from '../../stores/sessionStore';

function currentKey(): string {
  const cs = useSessionStore.getState().currentSession!;
  return sessionKey(cs.project, cs.name);
}

function seedTab(id: string, isPreview: boolean) {
  const key = currentKey();
  const tab: TabDescriptor = {
    id,
    kind: 'artifact',
    artifactType: 'diagram',
    artifactId: id,
    name: `Tab ${id}`,
    isPreview,
    isPinned: false,
    order: 0,
    openedAt: Date.now(),
  };
  const existing = useTabsStore.getState().bySession[key] ?? { tabs: [], activeTabId: null };
  useTabsStore.setState({
    bySession: {
      ...useTabsStore.getState().bySession,
      [key]: {
        tabs: [...existing.tabs, tab],
        activeTabId: existing.activeTabId ?? id,
      },
    },
  });
}

function getTab(id: string): TabDescriptor | undefined {
  const key = currentKey();
  const entry = useTabsStore.getState().bySession[key];
  return entry?.tabs.find((t) => t.id === id);
}

describe('useEditorAutoPromote', () => {
  beforeEach(() => {
    useTabsStore.setState({ bySession: {} });
    localStorage.clear();
    useSessionStore.setState({
      currentSession: { project: '/p', name: 's1' } as any,
    });
  });

  it('promotes a preview tab on first dirty emit', () => {
    seedTab('t1', true);
    renderHook(() => useEditorAutoPromote());
    act(() => {
      reportEditorDirty('t1');
    });
    expect(getTab('t1')!.isPreview).toBe(false);
  });

  it('does not change an already-permanent tab', () => {
    seedTab('t1', false);
    renderHook(() => useEditorAutoPromote());
    expect(() => {
      act(() => {
        reportEditorDirty('t1');
      });
    }).not.toThrow();
    expect(getTab('t1')!.isPreview).toBe(false);
  });

  it('ignores unknown tab ids', () => {
    renderHook(() => useEditorAutoPromote());
    const before = useTabsStore.getState().bySession;
    expect(() => {
      act(() => {
        reportEditorDirty('ghost');
      });
    }).not.toThrow();
    expect(useTabsStore.getState().bySession).toEqual(before);
  });

  it('only promotes once per tab', () => {
    seedTab('t1', true);
    renderHook(() => useEditorAutoPromote());
    const spy = vi.fn();
    useTabsStore.setState({ promoteToPermanent: spy } as any);
    act(() => {
      reportEditorDirty('t1');
    });
    act(() => {
      reportEditorDirty('t1');
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount', () => {
    seedTab('t1', true);
    const { unmount } = renderHook(() => useEditorAutoPromote());
    unmount();
    const spy = vi.fn();
    useTabsStore.setState({ promoteToPermanent: spy } as any);
    act(() => {
      reportEditorDirty('t1');
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('no-op when currentSession is null', () => {
    useSessionStore.setState({ currentSession: null });
    renderHook(() => useEditorAutoPromote());
    expect(() => {
      act(() => {
        reportEditorDirty('t1');
      });
    }).not.toThrow();
  });
});
