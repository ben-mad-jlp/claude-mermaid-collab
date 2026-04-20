import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentSessionRegistry } from '../session-registry.ts';
import type { AgentEvent } from '../contracts.ts';

const INTEGRATION = process.env.INTEGRATION === '1';
const d = INTEGRATION ? describe : describe.skip;

/**
 * Gated permission-flow integration test. Mirrors the gating pattern in
 * integration.test.ts: INTEGRATION=1 in env runs these against the real
 * `claude` CLI; otherwise the whole describe is skipped.
 *
 * Caveat: the claude CLI's exact tool_use emission for a given prompt can be
 * flaky across versions. If a scenario fails to reach `permission_requested`
 * within the deadline, the test fails loudly so humans can adjust the prompt.
 */
d('integration: permission flow end-to-end', () => {
  let registry: AgentSessionRegistry | null = null;
  let tmpDir = '';
  let cwd = '';
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
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-perm-'));
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-perm-cwd-'));
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
      if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
      if (cwd) await fs.rm(cwd, { recursive: true, force: true });
      tmpDir = '';
      cwd = '';
    }
  });

  function makeRegistry(permissionTimeoutMs?: number): AgentSessionRegistry {
    return new AgentSessionRegistry({
      broadcast: (msg) => {
        events.push(msg.event);
      },
      persistDir: tmpDir,
      permissionTimeoutMs,
    });
  }

  it('supervised mode: permission_requested surfaces and allow_once lets turn complete', async () => {
    registry = makeRegistry(60_000);
    const sessionId = freshSessionId('perm-allow');

    const child = await registry.getOrCreate(sessionId, cwd);
    registry.setPermissionMode(sessionId, 'supervised');

    child.writeUserMessage(
      'Use the Bash tool to run the command: true. Do not respond until the tool finishes.',
    );

    const gotRequest = await waitFor(
      () =>
        events.some(
          (e) => e.kind === 'permission_requested' && (e as any).name === 'Bash',
        ),
      30_000,
    );
    expect(gotRequest).toBe(true);

    const req = events.find(
      (e) => e.kind === 'permission_requested' && (e as any).name === 'Bash',
    ) as any;
    expect(req.promptId).toBeTruthy();

    registry.resolvePermission(sessionId, req.promptId, 'allow_once', 'tester');

    const gotResolved = await waitFor(
      () =>
        events.some(
          (e) =>
            e.kind === 'permission_resolved' &&
            (e as any).promptId === req.promptId &&
            (e as any).decision === 'allow_once' &&
            (e as any).resolvedBy === 'user',
        ),
      5_000,
    );
    expect(gotResolved).toBe(true);

    const turnEnded = await waitFor(
      () => events.some((e) => e.kind === 'turn_end'),
      30_000,
    );
    expect(turnEnded).toBe(true);
  }, 90_000);

  it('bypass mode: auto-allows without surfacing a prompt', async () => {
    registry = makeRegistry(60_000);
    const sessionId = freshSessionId('perm-bypass');

    const child = await registry.getOrCreate(sessionId, cwd);
    registry.setPermissionMode(sessionId, 'bypass');

    child.writeUserMessage(
      'Use the Bash tool to run the command: true. Keep the answer short.',
    );

    const turnEnded = await waitFor(
      () => events.some((e) => e.kind === 'turn_end'),
      30_000,
    );
    expect(turnEnded).toBe(true);

    // No user-facing permission prompts should have been surfaced.
    const userPrompts = events.filter((e) => e.kind === 'permission_requested');
    expect(userPrompts).toEqual([]);

    // If claude did invoke Bash, there should be a resolved event with
    // resolvedBy:'mode_auto'. If it did NOT invoke Bash (flaky prompts), we
    // still at least confirmed no user prompt surfaced.
    const autos = events.filter(
      (e) =>
        e.kind === 'permission_resolved' && (e as any).resolvedBy === 'mode_auto',
    );
    // Informational — do not hard-fail on tool-use flakiness, but if Bash fired
    // the auto-resolve MUST have been emitted.
    const bashStarted = events.some(
      (e) => e.kind === 'tool_call_started' && (e as any).name === 'Bash',
    );
    if (bashStarted) {
      expect(autos.length).toBeGreaterThanOrEqual(1);
    }
  }, 90_000);

  it('supervised mode: unresolved prompt times out and fires permission_resolved{decision:timeout, resolvedBy:timeout}', async () => {
    registry = makeRegistry(1_000);
    const sessionId = freshSessionId('perm-timeout');

    const child = await registry.getOrCreate(sessionId, cwd);
    registry.setPermissionMode(sessionId, 'supervised');

    child.writeUserMessage(
      'Use the Bash tool to run the command: true. Do not respond until the tool finishes.',
    );

    const gotRequest = await waitFor(
      () =>
        events.some(
          (e) => e.kind === 'permission_requested' && (e as any).name === 'Bash',
        ),
      30_000,
    );
    expect(gotRequest).toBe(true);

    const req = events.find(
      (e) => e.kind === 'permission_requested' && (e as any).name === 'Bash',
    ) as any;

    // Deliberately do NOT resolve. Wait past the 1s timeout.
    const timedOut = await waitFor(
      () =>
        events.some(
          (e) =>
            e.kind === 'permission_resolved' &&
            (e as any).promptId === req.promptId &&
            (e as any).decision === 'timeout' &&
            (e as any).resolvedBy === 'timeout',
        ),
      5_000,
    );
    expect(timedOut).toBe(true);
  }, 60_000);
});
