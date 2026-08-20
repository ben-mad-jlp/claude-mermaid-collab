/**
 * Bridge scope follows the SELECTED PROJECT, not the current session's server.
 *
 * Regression (observed 2026-08-20): with a qbs/trimaxion session current, the Bridge
 * scoped every read and write to the remote server. Two LOCAL projects' conductor
 * levers read `enabled:false` off the remote — which does not have those projects —
 * while the local server said `true`, so the switches showed OFF and a click would
 * have written the flag onto the wrong machine.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const LOCAL = 'local-server-id';
const REMOTE = 'remote-server-id';
const LOCAL_PROJECT = '/Users/me/Code/collab';
const REMOTE_PROJECT = '/home/ben/code/qbs';

let serversValue: Array<{ id: string; source: 'local' | 'manual'; status: string }> = [];

vi.mock('@/contexts/ServerContext', () => ({
  useServers: () => ({ servers: serversValue }),
}));

import { useProjectServerScope } from '../useProjectServerScope';

function mockProjectLists(byServer: Record<string, string[]>) {
  (window as any).mc = {
    invokeOnServer: (id: string, _opts: unknown) =>
      Promise.resolve({ ok: true, status: 200, body: { projects: (byServer[id] ?? []).map((p) => ({ project: p })) } }),
  };
}

beforeEach(() => {
  serversValue = [
    { id: LOCAL, source: 'local', status: 'online' },
    { id: REMOTE, source: 'manual', status: 'online' },
  ];
  mockProjectLists({ [LOCAL]: [LOCAL_PROJECT], [REMOTE]: [REMOTE_PROJECT] });
});

afterEach(() => {
  delete (window as any).mc;
  vi.clearAllMocks();
});

describe('useProjectServerScope', () => {
  it('resolves a local project to the LOCAL server even when the session is on a remote', async () => {
    const { result } = renderHook(() => useProjectServerScope(LOCAL_PROJECT, REMOTE));
    await waitFor(() => expect(result.current).toBe(LOCAL));
  });

  it('resolves a remote project to the remote server', async () => {
    const { result } = renderHook(() => useProjectServerScope(REMOTE_PROJECT, LOCAL));
    await waitFor(() => expect(result.current).toBe(REMOTE));
  });

  it('falls back to the supplied scope for a project no server claims', async () => {
    const { result } = renderHook(() => useProjectServerScope('/nowhere/at/all', REMOTE));
    await waitFor(() => expect(result.current).toBe(REMOTE));
  });

  it('prefers the LOCAL server when two servers claim the same path', async () => {
    mockProjectLists({ [LOCAL]: [LOCAL_PROJECT], [REMOTE]: [LOCAL_PROJECT] });
    const { result } = renderHook(() => useProjectServerScope(LOCAL_PROJECT, REMOTE));
    await waitFor(() => expect(result.current).toBe(LOCAL));
  });
});
