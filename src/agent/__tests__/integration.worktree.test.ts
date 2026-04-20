import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentSessionRegistry } from '../session-registry.ts';
import type { AgentEvent } from '../contracts.ts';

const INTEGRATION = process.env.INTEGRATION === '1';
const d = INTEGRATION ? describe : describe.skip;

/**
 * Gated worktree-lifecycle integration test. Mirrors the gating pattern in
 * integration.permission.test.ts: INTEGRATION=1 runs these against the real
 * `claude` CLI and real git; otherwise the whole describe is skipped.
 *
 * Covers:
 *   a. ensure() emits worktree_info with branch=collab/*, path exists, dirty=false
 *   b. path-based auto-allow: a Read request with a path under the worktree
 *      returns verdict=allow and emits permission_resolved{resolvedBy:'worktree_auto'}
 *      without surfacing a user-facing permission_requested event. Drives the
 *      permission socket directly (rather than via claude tool_use) to avoid
 *      CLI-version flakiness.
 *   c. runCommitPushPR: writing a file + calling registry.runCommitPushPR emits
 *      the full ComposeCommitPushPR tool_call stream and pushes to origin.
 *   d. deleteSession: removes worktree from disk and from `git worktree list`.
 */

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  const [stdoutBuf, stderrBuf, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code: code ?? 0, stdout: stdoutBuf, stderr: stderrBuf };
}

function sendPermissionRequest(
  socketPath: string,
  payload: unknown,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let buf = '';
    client.setEncoding('utf8');
    client.on('connect', () => {
      client.write(JSON.stringify(payload) + '\n');
    });
    client.on('data', (chunk: string) => {
      buf += chunk;
    });
    client.on('end', () => {
      try {
        const line = buf.split('\n').find((l) => l.trim().length > 0) ?? '';
        resolve(JSON.parse(line));
      } catch (e) {
        reject(e);
      }
    });
    client.on('error', reject);
  });
}

function socketPathFor(persistDir: string, sessionId: string): string {
  const shortHash = createHash('sha1').update(sessionId).digest('hex').slice(0, 16);
  return path.join(persistDir, 'sockets', `${shortHash}.sock`);
}

d('integration: worktree lifecycle end-to-end', () => {
  let registry: AgentSessionRegistry | null = null;
  let persistDir = '';
  let projectRoot = '';
  let bareRemote = '';
  let worktreeBaseDir = '';
  const events: AgentEvent[] = [];
  const sessionIds: string[] = [];

  function freshSessionId(prefix: string): string {
    const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionIds.push(id);
    return id;
  }

  async function waitFor(
    predicate: () => boolean,
    timeoutMs = 30_000,
    stepMs = 100,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((r) => setTimeout(r, stepMs));
    }
    return predicate();
  }

  beforeEach(async () => {
    events.length = 0;

    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-wt-persist-'));
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-wt-project-'));
    bareRemote = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-wt-remote-'));
    worktreeBaseDir = path.join(persistDir, 'worktrees');

    // Set up bare remote.
    const bareInit = await runGit(bareRemote, ['init', '--bare', '--initial-branch=main', bareRemote]);
    expect(bareInit.code).toBe(0);

    // Set up working project repo on `main`.
    const init = await runGit(projectRoot, ['init', '--initial-branch=main', projectRoot]);
    expect(init.code).toBe(0);
    await runGit(projectRoot, ['config', 'user.email', 'test@example.com']);
    await runGit(projectRoot, ['config', 'user.name', 'Test']);
    await runGit(projectRoot, ['config', 'commit.gpgsign', 'false']);
    await fs.writeFile(path.join(projectRoot, 'README.md'), '# test\n', 'utf8');
    const add = await runGit(projectRoot, ['add', '-A']);
    expect(add.code).toBe(0);
    const commit = await runGit(projectRoot, ['commit', '-m', 'init']);
    expect(commit.code).toBe(0);
    const remoteAdd = await runGit(projectRoot, ['remote', 'add', 'origin', bareRemote]);
    expect(remoteAdd.code).toBe(0);
    const push = await runGit(projectRoot, ['push', '-u', 'origin', 'main']);
    expect(push.code).toBe(0);
  });

  afterEach(async () => {
    try {
      if (registry) {
        for (const sid of sessionIds) {
          try {
            await registry.stop(sid);
          } catch {
            /* noop */
          }
        }
      }
    } finally {
      sessionIds.length = 0;
      registry = null;
      for (const dir of [persistDir, projectRoot, bareRemote, worktreeBaseDir]) {
        if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
      persistDir = projectRoot = bareRemote = worktreeBaseDir = '';
    }
  });

  function makeRegistry(): AgentSessionRegistry {
    return new AgentSessionRegistry({
      broadcast: (msg) => {
        events.push(msg.event);
      },
      persistDir,
      projectRoot,
      worktreeBaseDir,
      permissionTimeoutMs: 60_000,
    });
  }

  it('ensure emits worktree_info with collab/* branch and clean state', async () => {
    registry = makeRegistry();
    const sessionId = freshSessionId('wt-info');

    await registry.getOrCreate(sessionId, projectRoot);

    const got = await waitFor(
      () => events.some((e) => e.kind === 'worktree_info'),
      30_000,
    );
    expect(got).toBe(true);

    const info = events.find((e) => e.kind === 'worktree_info') as any;
    expect(info).toBeTruthy();
    expect(info.info.kind).not.toBe('non_git');
    expect(info.info.branch).toMatch(/^collab\//);
    expect(info.info.path).toBeTruthy();
    expect(info.info.baseBranch).toBe('main');
    expect(info.dirty).toBe(false);

    const stat = await fs.stat(info.info.path);
    expect(stat.isDirectory()).toBe(true);
  }, 60_000);

  it('path-based auto-allow: Read inside worktree resolves via worktree_auto without surfacing a prompt', async () => {
    registry = makeRegistry();
    const sessionId = freshSessionId('wt-auto');

    await registry.getOrCreate(sessionId, projectRoot);

    const gotInfo = await waitFor(
      () => events.some((e) => e.kind === 'worktree_info'),
      30_000,
    );
    expect(gotInfo).toBe(true);
    const infoEvent = events.find((e) => e.kind === 'worktree_info') as any;
    const wtPath: string = infoEvent.info.path;

    // Drop any events that may have been emitted in the meantime (e.g.
    // session_started) and snapshot the count before the direct request.
    const preCount = events.length;

    // Drive the permission socket directly to avoid claude CLI flakiness.
    const sockPath = socketPathFor(persistDir, sessionId);
    // Socket file should exist now that startChild completed.
    await fs.access(sockPath);

    const targetFile = path.join(wtPath, 'README.md');
    const response = await sendPermissionRequest(sockPath, {
      hookEventName: 'PreToolUse',
      toolName: 'Read',
      toolInput: { file_path: targetFile },
      sessionId,
    });

    expect(response?.hookSpecificOutput?.permissionDecision).toBe('allow');
    expect(response?.hookSpecificOutput?.permissionDecisionReason).toBe('worktree_auto');

    const resolvedEv = await waitFor(
      () =>
        events
          .slice(preCount)
          .some(
            (e) =>
              e.kind === 'permission_resolved' &&
              (e as any).resolvedBy === 'worktree_auto' &&
              (e as any).decision === 'allow_once',
          ),
      5_000,
    );
    expect(resolvedEv).toBe(true);

    // No user-facing permission_requested should have been surfaced for this
    // auto-allowed in-worktree Read.
    const userPrompts = events
      .slice(preCount)
      .filter((e) => e.kind === 'permission_requested');
    expect(userPrompts).toEqual([]);
  }, 60_000);

  it('runCommitPushPR emits ComposeCommitPushPR tool_call stream and pushes branch', async () => {
    registry = makeRegistry();
    const sessionId = freshSessionId('wt-pr');

    await registry.getOrCreate(sessionId, projectRoot);

    const gotInfo = await waitFor(
      () => events.some((e) => e.kind === 'worktree_info'),
      30_000,
    );
    expect(gotInfo).toBe(true);
    const infoEvent = events.find((e) => e.kind === 'worktree_info') as any;
    const wtPath: string = infoEvent.info.path;
    const wtBranch: string = infoEvent.info.branch;

    // Write a file directly inside the worktree (bypass claude).
    await fs.writeFile(path.join(wtPath, 'hello.txt'), 'hello world\n', 'utf8');

    const preCount = events.length;

    await registry.runCommitPushPR(sessionId, {
      title: 'test commit',
      body: 'body text',
    });

    const newEvents = events.slice(preCount);
    const turnStart = newEvents.find((e) => e.kind === 'turn_start');
    expect(turnStart).toBeTruthy();

    const toolStart = newEvents.find(
      (e) => e.kind === 'tool_call_started' && (e as any).name === 'ComposeCommitPushPR',
    ) as any;
    expect(toolStart).toBeTruthy();

    const toolDone = newEvents.find(
      (e) =>
        e.kind === 'tool_call_completed' &&
        (e as any).toolUseId === toolStart.toolUseId,
    ) as any;
    expect(toolDone).toBeTruthy();
    expect(toolDone.status).toBe('ok');
    expect(toolDone.output).toBeTruthy();
    expect(toolDone.output.branch).toBe(wtBranch);
    expect(toolDone.output.pushed).toBe(true);

    expect(newEvents.some((e) => e.kind === 'turn_end')).toBe(true);

    // Verify bare remote received the branch.
    const brList = await runGit(bareRemote, ['branch', '--list', wtBranch]);
    expect(brList.code).toBe(0);
    expect(brList.stdout).toContain(wtBranch);
  }, 90_000);

  it('deleteSession removes the worktree from disk and from `git worktree list`', async () => {
    registry = makeRegistry();
    const sessionId = freshSessionId('wt-del');

    await registry.getOrCreate(sessionId, projectRoot);
    const gotInfo = await waitFor(
      () => events.some((e) => e.kind === 'worktree_info'),
      30_000,
    );
    expect(gotInfo).toBe(true);
    const infoEvent = events.find((e) => e.kind === 'worktree_info') as any;
    const wtPath: string = infoEvent.info.path;

    // Sanity: path exists pre-delete.
    const preStat = await fs.stat(wtPath);
    expect(preStat.isDirectory()).toBe(true);

    await registry.deleteSession(sessionId);
    // Remove from our tracked list so afterEach doesn't re-stop it.
    const idx = sessionIds.indexOf(sessionId);
    if (idx !== -1) sessionIds.splice(idx, 1);

    let exists = true;
    try {
      await fs.access(wtPath);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);

    const list = await runGit(projectRoot, ['worktree', 'list', '--porcelain']);
    expect(list.code).toBe(0);
    expect(list.stdout).not.toContain(wtPath);
  }, 60_000);
});
