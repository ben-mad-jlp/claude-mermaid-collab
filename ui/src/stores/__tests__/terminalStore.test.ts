import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useTerminalStore } from '../terminalStore.js';

const FETCH_DATA = { id: 'abc', tmuxSession: 'vscode-collab-mc-x-y' };

function makeFetch(delay = 0) {
  return vi.fn(() =>
    new Promise<Response>((resolve) =>
      setTimeout(
        () =>
          resolve({
            ok: true,
            status: 201,
            json: async () => FETCH_DATA,
          } as unknown as Response),
        delay
      )
    )
  );
}

beforeEach(() => {
  useTerminalStore.setState({ open: false, tabs: [], activeTabId: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openFor', () => {
  it('creates a tab, sets activeTabId, opens drawer on first call', async () => {
    global.fetch = makeFetch();

    await useTerminalStore.getState().openFor('p', 's', { serverId: 'srv1', serverLabel: 'local' });

    const state = useTerminalStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].id).toBe('abc');
    expect(state.tabs[0].title).toBe('s');
    expect(state.tabs[0].tmuxName).toBe('vscode-collab-mc-x-y');
    expect(state.activeTabId).toBe('abc');
    expect(state.open).toBe(true);
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('dedup: second sequential call for same session activates existing tab without fetching again', async () => {
    global.fetch = makeFetch();

    await useTerminalStore.getState().openFor('p', 's', { serverId: 'srv1', serverLabel: 'local' });
    await useTerminalStore.getState().openFor('p', 's', { serverId: 'srv1', serverLabel: 'local' });

    const state = useTerminalStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledOnce();
    expect(state.activeTabId).toBe('abc');
  });

  it('in-flight guard: concurrent calls only produce one tab and one fetch', async () => {
    global.fetch = makeFetch(20);

    await Promise.all([
      useTerminalStore.getState().openFor('p', 's', { serverId: 'srv1', serverLabel: 'local' }),
      useTerminalStore.getState().openFor('p', 's', { serverId: 'srv1', serverLabel: 'local' }),
    ]);

    const state = useTerminalStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledOnce();
  });
});

describe('closeTab', () => {
  it('removes the tab and clears activeTabId when the closed tab was active', async () => {
    global.fetch = makeFetch();
    await useTerminalStore.getState().openFor('p', 's', { serverId: 'srv1', serverLabel: 'local' });

    useTerminalStore.getState().closeTab('abc');

    const state = useTerminalStore.getState();
    expect(state.tabs).toHaveLength(0);
    expect(state.activeTabId).toBeNull();
    expect(state.open).toBe(false);
  });

  it('does not affect activeTabId when a non-active tab is closed', async () => {
    global.fetch = makeFetch();
    await useTerminalStore.getState().openFor('p', 's1', { serverId: 'srv1', serverLabel: 'local' });

    // Add second tab manually
    useTerminalStore.setState((s) => ({
      tabs: [...s.tabs, { id: 'def', title: 's2', tmuxName: 'tmux-s2', serverId: 'srv1', serverLabel: 'local' }],
    }));
    useTerminalStore.getState().setActive('abc');

    useTerminalStore.getState().closeTab('def');

    const state = useTerminalStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe('abc');
  });
});

describe('setActive / toggle / setWidth', () => {
  it('setActive updates activeTabId', () => {
    useTerminalStore.setState({ tabs: [{ id: 'x', title: 't', tmuxName: 'n', serverId: 'srv1', serverLabel: 'local' }] });
    useTerminalStore.getState().setActive('x');
    expect(useTerminalStore.getState().activeTabId).toBe('x');
  });

  it('toggle flips open state', () => {
    useTerminalStore.setState({ open: false });
    useTerminalStore.getState().toggle();
    expect(useTerminalStore.getState().open).toBe(true);
    useTerminalStore.getState().toggle();
    expect(useTerminalStore.getState().open).toBe(false);
  });

  it('setWidth updates width', () => {
    useTerminalStore.getState().setWidth(600);
    expect(useTerminalStore.getState().width).toBe(600);
  });
});
