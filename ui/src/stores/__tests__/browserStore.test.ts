import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useBrowserStore } from '../browserStore.js';

const mockTab = {
  id: 't1',
  kind: 'session' as const,
  session: 'mysess',
  url: '',
  title: '',
};

function resetStore() {
  useBrowserStore.setState({
    visible: false,
    tabs: [],
    activeId: null,
    width: 480,
  });
}

beforeEach(() => {
  resetStore();
  delete (window as any).mc;
});

afterEach(() => {
  delete (window as any).mc;
});

describe('browserStore — no bridge', () => {
  it('refresh() does not throw and leaves tabs empty', async () => {
    await expect(useBrowserStore.getState().refresh()).resolves.toBeUndefined();
    expect(useBrowserStore.getState().tabs).toEqual([]);
  });

  it('activateTab() does not throw and does not change state', () => {
    expect(() => useBrowserStore.getState().activateTab('t1')).not.toThrow();
    expect(useBrowserStore.getState().activeId).toBeNull();
    expect(useBrowserStore.getState().visible).toBe(false);
  });

  it('activateSession() does not throw and does not change state', async () => {
    await expect(useBrowserStore.getState().activateSession('mysess')).resolves.toBeUndefined();
    expect(useBrowserStore.getState().activeId).toBeNull();
  });
});

describe('browserStore — with mock bridge', () => {
  let listTabs: ReturnType<typeof vi.fn>;
  let activateTab: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listTabs = vi.fn(async () => [mockTab]);
    activateTab = vi.fn();
    (window as any).mc = { browser: { listTabs, activateTab } };
  });

  it('refresh() populates tabs from bridge', async () => {
    await useBrowserStore.getState().refresh();
    expect(listTabs).toHaveBeenCalledOnce();
    expect(useBrowserStore.getState().tabs).toEqual([mockTab]);
  });

  it('activateSession() finds matching tab, calls bridge.activateTab, sets activeId and visible', async () => {
    await useBrowserStore.getState().activateSession('mysess');
    expect(activateTab).toHaveBeenCalledWith('t1');
    expect(useBrowserStore.getState().activeId).toBe('t1');
    expect(useBrowserStore.getState().visible).toBe(true);
  });

  it('activateSession() with no matching tab does not call bridge.activateTab', async () => {
    await useBrowserStore.getState().activateSession('nope');
    expect(activateTab).not.toHaveBeenCalled();
    expect(useBrowserStore.getState().activeId).toBeNull();
  });
});

describe('browserStore — UI state actions', () => {
  it('toggle flips visible', () => {
    expect(useBrowserStore.getState().visible).toBe(false);
    useBrowserStore.getState().toggle();
    expect(useBrowserStore.getState().visible).toBe(true);
    useBrowserStore.getState().toggle();
    expect(useBrowserStore.getState().visible).toBe(false);
  });

  it('show sets visible true', () => {
    useBrowserStore.getState().show();
    expect(useBrowserStore.getState().visible).toBe(true);
  });

  it('hide sets visible false', () => {
    useBrowserStore.setState({ visible: true });
    useBrowserStore.getState().hide();
    expect(useBrowserStore.getState().visible).toBe(false);
  });

  it('setWidth sets width', () => {
    useBrowserStore.getState().setWidth(800);
    expect(useBrowserStore.getState().width).toBe(800);
  });
});
