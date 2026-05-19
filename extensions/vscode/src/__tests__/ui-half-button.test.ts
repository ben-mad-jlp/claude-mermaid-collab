/**
 * Unit tests for the collab-server status bar + toggle wiring in ui-half.ts.
 * Covers the I2 (dead-pid filter), I3 (cancelAllPending rejects awaiters),
 * and C1 (child-exit flips bar to failed) fixes.
 */
import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __reset,
  __getCommand,
  makeExtensionContext,
  commands,
  window,
  workspace,
  env,
} from './vscode-mock';

// ── fs/promises mock (readLocalInstances + activateUi's mkdir) ──────────────
vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  mkdir: vi.fn(async () => undefined),
}));

// ── server-resolver / spawn-server mocks ───────────────────────────────────
const fakeChild = (): any => {
  const ee = new EventEmitter() as any;
  ee.kill = vi.fn();
  return ee;
};
let lastSpawned: { sessionId: string; child: any } | null = null;

vi.mock('../server-resolver', () => ({
  resolveServerSource: vi.fn(async () => ({ rootDir: '/src', bunPath: '/bun', version: '1.0.17' })),
}));

vi.mock('../spawn-server', () => {
  class AlreadyRunning extends Error {
    constructor(public pid: number, public port: number, public sessionId: string) {
      super('already running');
      this.name = 'AlreadyRunning';
    }
  }
  return {
    AlreadyRunning,
    spawnCollabServer: vi.fn(async () => {
      const child = fakeChild();
      lastSpawned = { sessionId: 'sess-abc', child };
      return { pid: 4242, sessionId: 'sess-abc', child };
    }),
  };
});

import * as fsp from 'fs/promises';
import {
  readLocalInstances,
  awaitInstanceUp,
  cancelAllPending,
  activateUi,
  type Instance,
} from '../ui-half';

const tick = () => new Promise(r => setTimeout(r, 0));

function makeInst(over: Partial<Instance> = {}): Instance {
  return {
    version: 1,
    sessionId: 'sess-abc',
    port: 5555,
    project: '/tmp/proj',
    session: 'proj',
    pid: 4242,
    startedAt: '2026-01-01T00:00:00Z',
    serverVersion: '1.0.17',
    ...over,
  };
}

beforeEach(async () => {
  __reset();
  lastSpawned = null;
  // Re-establish the spawn-server mock implementation (cleared by __reset's
  // vi.clearAllMocks) so each test gets a fresh fake child.
  const spawnMod: any = await import('../spawn-server');
  spawnMod.spawnCollabServer.mockImplementation(async () => {
    const child = fakeChild();
    lastSpawned = { sessionId: 'sess-abc', child };
    return { pid: 4242, sessionId: 'sess-abc', child };
  });
  const resolverMod: any = await import('../server-resolver');
  resolverMod.resolveServerSource.mockResolvedValue({ rootDir: '/src', bunPath: '/bun', version: '1.0.17' });
  // ui-half.ts module state (collabServerState / pendingInstanceUp) persists
  // across tests because the module is imported once. Drive it back to
  // 'stopped' via a throwaway activate + the stop command.
  activateUi(makeExtensionContext());
  await __getCommand('mermaidCollab.stopCollabServer')!();
  // tunnelsBySessionId is module-global; dispose any leftover entry so a later
  // test's onInstanceUp doesn't short-circuit on a stale same-port tunnel.
  await __getCommand('mermaidCollab.ui.onInstanceDown')!({ sessionId: 'sess-abc' });
  cancelAllPending('test reset');
  __reset();
});

describe('readLocalInstances (I2 dead-pid filter)', () => {
  it('returns only alive-pid instances; keeps non-numeric pid; ignores non-json', async () => {
    (fsp.readdir as any).mockResolvedValue(['alive.json', 'dead.json', 'nopid.json', 'notes.txt']);
    (fsp.readFile as any).mockImplementation(async (p: string) => {
      if (p.endsWith('alive.json')) return JSON.stringify(makeInst({ sessionId: 'a', port: 1, pid: 111 }));
      if (p.endsWith('dead.json')) return JSON.stringify(makeInst({ sessionId: 'd', port: 2, pid: 222 }));
      if (p.endsWith('nopid.json')) return JSON.stringify({ ...makeInst({ sessionId: 'n', port: 3 }), pid: 'x' });
      throw new Error('unexpected file ' + p);
    });
    vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
      if (pid === 222) throw new Error('ESRCH');
      return true;
    }) as any);

    const out = await readLocalInstances();
    const ids = out.map(i => i.sessionId).sort();
    expect(ids).toEqual(['a', 'n']);
    expect(out.find(i => i.sessionId === 'd')).toBeUndefined();
  });

  it('returns [] when the instances dir is missing', async () => {
    (fsp.readdir as any).mockRejectedValue(new Error('ENOENT'));
    expect(await readLocalInstances()).toEqual([]);
  });
});

describe('awaitInstanceUp + cancelAllPending (I3)', () => {
  it('cancelAllPending rejects the pending promise and clears the map', async () => {
    const p = awaitInstanceUp('xyz', 60_000);
    const rejection = expect(p).rejects.toThrow(/boom-reason/);
    cancelAllPending('boom-reason');
    await rejection;
    // Second cancel is a no-op (map already cleared) — must not throw.
    expect(() => cancelAllPending('again')).not.toThrow();
  });
});

describe('activateUi: collab status bar + toggle', () => {
  const collabBar = () =>
    window.createStatusBarItem.mock.results
      .map(r => r.value)
      .find((i: any) => i.priority === 98);

  it('initial bar text is the stopped text', () => {
    activateUi(makeExtensionContext());
    expect(collabBar().text).toBe('$(plug) collab');
  });

  it('toggle with no workspace folder warns and does not change state', async () => {
    activateUi(makeExtensionContext());
    workspace.workspaceFolders = undefined;
    await __getCommand('mermaidCollab.toggleCollabServer')!();
    expect(window.showWarningMessage).toHaveBeenCalled();
    expect(collabBar().text).toBe('$(plug) collab');
  });

  it('local start → onInstanceUp with matching version → ready bar', async () => {
    const ctx = makeExtensionContext();
    activateUi(ctx);
    workspace.workspaceFolders = [{ uri: { fsPath: '/tmp/proj' } }];
    env.remoteName = undefined;

    const toggle = __getCommand('mermaidCollab.toggleCollabServer')!();
    await tick();
    expect(lastSpawned).not.toBeNull();
    expect(collabBar().text).toBe('$(loading~spin) collab');

    await __getCommand('mermaidCollab.ui.onInstanceUp')!(
      makeInst({ sessionId: lastSpawned!.sessionId, port: 5555, serverVersion: '1.0.17' }),
    );
    await toggle;
    await tick();

    // openTunnel mock yields local port 39999.
    expect(collabBar().text).toBe('$(check) collab :39999');

    // Ready → toggle again opens the UI.
    const exec = vi.spyOn(commands, 'executeCommand');
    await __getCommand('mermaidCollab.toggleCollabServer')!();
    expect(exec).toHaveBeenCalledWith('mermaidCollab.openUi');
  });

  it('differing serverVersion → skew bar', async () => {
    const ctx = makeExtensionContext();
    activateUi(ctx);
    workspace.workspaceFolders = [{ uri: { fsPath: '/tmp/proj' } }];
    env.remoteName = undefined;

    const toggle = __getCommand('mermaidCollab.toggleCollabServer')!();
    await tick();
    await __getCommand('mermaidCollab.ui.onInstanceUp')!(
      makeInst({ sessionId: lastSpawned!.sessionId, serverVersion: '9.9.9' }),
    );
    await toggle;
    await tick();
    expect(collabBar().text).toBe('$(warning) collab :39999');
  });

  it('stopCollabServer resets bar to stopped and cancels pending awaiters (C1/I3)', async () => {
    const ctx = makeExtensionContext();
    activateUi(ctx);
    workspace.workspaceFolders = [{ uri: { fsPath: '/tmp/proj' } }];
    env.remoteName = undefined;

    const toggle = __getCommand('mermaidCollab.toggleCollabServer')!();
    await tick();
    expect(collabBar().text).toBe('$(loading~spin) collab');

    await __getCommand('mermaidCollab.stopCollabServer')!();
    expect(collabBar().text).toBe('$(plug) collab');
    // The in-flight start awaiter was cancelled — startCollabServerLocal
    // swallows it because state is now 'stopped'.
    await toggle;
    await tick();
    expect(collabBar().text).toBe('$(plug) collab');
  });

  it('C1: child exit after ready flips bar to failed', async () => {
    const ctx = makeExtensionContext();
    activateUi(ctx);
    workspace.workspaceFolders = [{ uri: { fsPath: '/tmp/proj' } }];
    env.remoteName = undefined;

    const toggle = __getCommand('mermaidCollab.toggleCollabServer')!();
    await tick();
    await __getCommand('mermaidCollab.ui.onInstanceUp')!(
      makeInst({ sessionId: lastSpawned!.sessionId, serverVersion: '1.0.17' }),
    );
    await toggle;
    await tick();
    expect(collabBar().text).toBe('$(check) collab :39999');

    lastSpawned!.child.emit('exit', 1, null);
    await tick();
    expect(collabBar().text).toBe('$(error) collab');
  });
});
