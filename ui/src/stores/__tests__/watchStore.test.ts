import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useWatchStore } from '../watchStore.js';

function resetStore() {
  useWatchStore.setState({ watchedIds: [] });
}

beforeEach(() => {
  resetStore();
  localStorage.clear();
  delete (window as any).mc;
});

afterEach(() => {
  delete (window as any).mc;
});

describe('watchStore — toggleWatched', () => {
  it('adds an id when absent', () => {
    useWatchStore.getState().toggleWatched('server-1');
    expect(useWatchStore.getState().watchedIds).toEqual(['server-1']);
  });

  it('removes an id when present', () => {
    useWatchStore.getState().toggleWatched('server-1');
    useWatchStore.getState().toggleWatched('server-1');
    expect(useWatchStore.getState().watchedIds).toEqual([]);
  });

  it('isWatched tracks toggle correctly', () => {
    expect(useWatchStore.getState().isWatched('server-1')).toBe(false);
    useWatchStore.getState().toggleWatched('server-1');
    expect(useWatchStore.getState().isWatched('server-1')).toBe(true);
    useWatchStore.getState().toggleWatched('server-1');
    expect(useWatchStore.getState().isWatched('server-1')).toBe(false);
  });
});

describe('watchStore — localStorage persistence', () => {
  it('toggleWatched persists to localStorage', () => {
    useWatchStore.getState().toggleWatched('server-1');
    expect(JSON.parse(localStorage.getItem('watched-servers')!)).toEqual(['server-1']);
  });

  it('toggleWatched remove persists to localStorage', () => {
    useWatchStore.getState().toggleWatched('server-1');
    useWatchStore.getState().toggleWatched('server-1');
    expect(JSON.parse(localStorage.getItem('watched-servers')!)).toEqual([]);
  });

  it('setWatched persists to localStorage', () => {
    useWatchStore.getState().setWatched(['a', 'b']);
    expect(JSON.parse(localStorage.getItem('watched-servers')!)).toEqual(['a', 'b']);
  });
});

describe('watchStore — with mock window.mc bridge', () => {
  let setWatchedServers: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setWatchedServers = vi.fn();
    (window as any).mc = { setWatchedServers };
  });

  it('toggleWatched calls mc.setWatchedServers with the new id array', () => {
    useWatchStore.getState().toggleWatched('server-1');
    expect(setWatchedServers).toHaveBeenCalledWith(['server-1']);
  });

  it('toggleWatched remove calls mc.setWatchedServers with empty array', () => {
    useWatchStore.getState().toggleWatched('server-1');
    setWatchedServers.mockClear();
    useWatchStore.getState().toggleWatched('server-1');
    expect(setWatchedServers).toHaveBeenCalledWith([]);
  });

  it("setWatched(['a','b']) calls mc.setWatchedServers with ['a','b']", () => {
    useWatchStore.getState().setWatched(['a', 'b']);
    expect(setWatchedServers).toHaveBeenCalledWith(['a', 'b']);
  });
});

describe('watchStore — no-op safety without window.mc', () => {
  it('toggleWatched does not throw without window.mc', () => {
    expect(() => useWatchStore.getState().toggleWatched('server-1')).not.toThrow();
  });

  it('setWatched does not throw without window.mc', () => {
    expect(() => useWatchStore.getState().setWatched(['a', 'b'])).not.toThrow();
  });
});
