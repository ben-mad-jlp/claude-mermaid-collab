import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { useTabKeyboard } from '../useTabKeyboard';
import { useTabsStore, sessionKey, type TabDescriptor } from '../../stores/tabsStore';
import { useSessionStore } from '../../stores/sessionStore';

const KEY = sessionKey('/p', 's');

function seedTabs() {
  const tabs: TabDescriptor[] = [
    {
      id: 't1',
      kind: 'artifact',
      artifactId: 't1',
      name: 't1',
      isPreview: false,
      isPinned: false,
      order: 0,
      openedAt: 0,
    },
    {
      id: 't2',
      kind: 'artifact',
      artifactId: 't2',
      name: 't2',
      isPreview: false,
      isPinned: false,
      order: 1,
      openedAt: 0,
    },
    {
      id: 't3',
      kind: 'artifact',
      artifactId: 't3',
      name: 't3',
      isPreview: false,
      isPinned: false,
      order: 2,
      openedAt: 0,
    },
  ];
  useTabsStore.setState({
    bySession: {
      [KEY]: { tabs, activeTabId: 't1' },
    },
  });
}

function getEntry() {
  return useTabsStore.getState().bySession[KEY] ?? { tabs: [], activeTabId: null };
}

function fire(init: KeyboardEventInit, target?: EventTarget) {
  act(() => {
    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    if (target) {
      Object.defineProperty(ev, 'target', { value: target, writable: false });
    }
    window.dispatchEvent(ev);
  });
}

describe('useTabKeyboard', () => {
  beforeEach(() => {
    useTabsStore.setState({ bySession: {} });
    useSessionStore.setState({
      currentSession: { project: '/p', name: 's' } as any,
    });
    seedTabs();
  });

  it('Ctrl+Tab cycles forward with wrap', () => {
    renderHook(() => useTabKeyboard());
    fire({ key: 'Tab', ctrlKey: true });
    expect(getEntry().activeTabId).toBe('t2');
    fire({ key: 'Tab', ctrlKey: true });
    expect(getEntry().activeTabId).toBe('t3');
    fire({ key: 'Tab', ctrlKey: true });
    expect(getEntry().activeTabId).toBe('t1');
  });

  it('Ctrl+Shift+Tab cycles backward with wrap', () => {
    renderHook(() => useTabKeyboard());
    fire({ key: 'Tab', ctrlKey: true, shiftKey: true });
    expect(getEntry().activeTabId).toBe('t3');
    fire({ key: 'Tab', ctrlKey: true, shiftKey: true });
    expect(getEntry().activeTabId).toBe('t2');
    fire({ key: 'Tab', ctrlKey: true, shiftKey: true });
    expect(getEntry().activeTabId).toBe('t1');
  });

  it('Meta+Tab also works', () => {
    renderHook(() => useTabKeyboard());
    fire({ key: 'Tab', metaKey: true });
    expect(getEntry().activeTabId).toBe('t2');
  });

  it('Ctrl+W closes active tab', () => {
    renderHook(() => useTabKeyboard());
    fire({ key: 'w', ctrlKey: true });
    const entry = getEntry();
    expect(entry.tabs.find((t) => t.id === 't1')).toBeUndefined();
    expect(entry.tabs.map((t) => t.id)).toEqual(['t2', 't3']);
  });

  it('Ctrl+1/2/3 jumps to index', () => {
    renderHook(() => useTabKeyboard());
    fire({ key: '2', ctrlKey: true });
    expect(getEntry().activeTabId).toBe('t2');
    fire({ key: '3', ctrlKey: true });
    expect(getEntry().activeTabId).toBe('t3');
  });

  it('Ctrl+9 with 3 tabs is no-op', () => {
    renderHook(() => useTabKeyboard());
    fire({ key: '9', ctrlKey: true });
    expect(getEntry().activeTabId).toBe('t1');
  });

  it('enabled:false → no state change', () => {
    renderHook(() => useTabKeyboard({ enabled: false }));
    const before = getEntry();
    fire({ key: 'Tab', ctrlKey: true });
    fire({ key: '2', ctrlKey: true });
    fire({ key: 'w', ctrlKey: true });
    const after = getEntry();
    expect(after.activeTabId).toBe(before.activeTabId);
    expect(after.tabs.map((t) => t.id)).toEqual(before.tabs.map((t) => t.id));
  });

  it('input target skipped for non-Tab keys; Tab still works', () => {
    renderHook(() => useTabKeyboard());
    const input = document.createElement('input');
    document.body.appendChild(input);

    // Non-Tab key from input: ignored.
    fire({ key: '2', ctrlKey: true }, input);
    expect(getEntry().activeTabId).toBe('t1');

    // Tab key from input: still handled.
    fire({ key: 'Tab', ctrlKey: true }, input);
    expect(getEntry().activeTabId).toBe('t2');

    document.body.removeChild(input);
  });
});
