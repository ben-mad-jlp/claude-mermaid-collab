import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { __reset, __getCommand, makeExtensionContext } from './vscode-mock';

vi.mock('../server-resolver', () => ({ resolveServerSource: vi.fn() }));

vi.mock('../spawn-server', async () => {
  const actual = await vi.importActual<typeof import('../spawn-server')>('../spawn-server');
  return { ...actual, spawnCollabServer: vi.fn() };
});

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  readdir: vi.fn(async () => [] as string[]),
  readFile: vi.fn(async () => '{}'),
  unlink: vi.fn(async () => undefined),
}));

import { activateWorkspace } from '../workspace-half';
import { resolveServerSource } from '../server-resolver';
import { spawnCollabServer, AlreadyRunning } from '../spawn-server';

const resolveServerSourceMock = vi.mocked(resolveServerSource);
const spawnCollabServerMock = vi.mocked(spawnCollabServer);

let ctx: ReturnType<typeof makeExtensionContext>;

async function getHandler() {
  ctx = makeExtensionContext();
  await activateWorkspace(ctx);
  const handler = __getCommand('mermaidCollab.workspace.startServer');
  expect(handler).toBeTypeOf('function');
  return handler!;
}

beforeEach(() => {
  __reset();
  resolveServerSourceMock.mockResolvedValue({
    rootDir: '/root',
    bunPath: '/usr/bin/bun',
    version: '1.0.17',
  } as any);
});

afterEach(() => {
  for (const sub of ctx?.subscriptions ?? []) {
    try { sub.dispose(); } catch { /* noop */ }
  }
});

describe('mermaidCollab.workspace.startServer', () => {
  it('happy path: returns pid/sessionId/version from spawn + source', async () => {
    spawnCollabServerMock.mockResolvedValue({ pid: 1234, sessionId: 'abc123', child: {} } as any);
    const handler = await getHandler();

    const result = await handler({ project: '/p', session: 's' });

    expect(result).toEqual({ pid: 1234, sessionId: 'abc123', version: '1.0.17' });
    expect(spawnCollabServerMock).toHaveBeenCalledOnce();
    const callArgs = spawnCollabServerMock.mock.calls[0][0];
    expect(callArgs.project).toBe('/p');
    expect(callArgs.session).toBe('s');
  });

  it('AlreadyRunning: adopts the running server without throwing', async () => {
    spawnCollabServerMock.mockRejectedValue(new AlreadyRunning(999, 8080, 'sid9'));
    const handler = await getHandler();

    const result = await handler({ project: '/p', session: 's' });

    expect(result).toEqual({ pid: 999, sessionId: 'sid9', version: '1.0.17' });
  });

  it('other error: propagates the error (not swallowed)', async () => {
    spawnCollabServerMock.mockRejectedValue(new Error('boom'));
    const handler = await getHandler();

    await expect(handler({ project: '/p', session: 's' })).rejects.toThrow('boom');
  });

  it('getOrCreateOutput memoization: output channel created exactly once across two invocations', async () => {
    // remoteOutput is module-level and persists across tests, so reset the
    // module registry to get a fresh (uncached) workspace-half module.
    vi.resetModules();
    const { activateWorkspace: freshActivate } = await import('../workspace-half');
    const freshVscode: any = await import('vscode');

    spawnCollabServerMock.mockResolvedValue({ pid: 1, sessionId: 's1', child: {} } as any);
    ctx = freshVscode.makeExtensionContext();
    await freshActivate(ctx);
    const handler = freshVscode.__getCommand('mermaidCollab.workspace.startServer');
    expect(handler).toBeTypeOf('function');

    await handler!({ project: '/p', session: 's' });
    await handler!({ project: '/p', session: 's' });

    const remoteCalls = vi
      .mocked(freshVscode.window.createOutputChannel)
      .mock.calls.filter(([name]) => name === 'mermaid-collab Server (remote)');
    expect(remoteCalls.length).toBe(1);
  });
});
