import { describe, it, expect, afterAll } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentSessionRegistry } from '../session-registry.ts';
import type { AgentEvent } from '../contracts.ts';

const INTEGRATION = process.env.INTEGRATION === '1';
const d = INTEGRATION ? describe : describe.skip;

d('integration: real claude child', () => {
  const broadcasts: Array<{ type: 'agent_event'; channel: string; event: AgentEvent }> = [];
  const events: AgentEvent[] = [];
  let registry: AgentSessionRegistry;
  let tmpDir: string;
  let cwd: string;
  const sessionId = `integration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  afterAll(async () => {
    try {
      if (registry) await registry.stop(sessionId);
    } finally {
      if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
      if (cwd) await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('spawns real claude, receives assistant_delta + turn_end within 30s', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-integ-'));
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-integ-cwd-'));

    registry = new AgentSessionRegistry({
      broadcast: (msg) => {
        broadcasts.push(msg);
        events.push(msg.event);
      },
      persistDir: tmpDir,
    });

    const child = await registry.getOrCreate(sessionId, cwd);
    child.writeUserMessage('say only pong');

    const deadline = Date.now() + 30_000;
    let deltaCount = 0;
    let turnEndCount = 0;
    while (Date.now() < deadline) {
      deltaCount = events.filter((e) => e.kind === 'assistant_delta').length;
      turnEndCount = events.filter((e) => e.kind === 'turn_end').length;
      if (deltaCount >= 1 && turnEndCount >= 1) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(deltaCount).toBeGreaterThanOrEqual(1);
    expect(turnEndCount).toBe(1);

    const parseErrors = events.filter(
      (e) => e.kind === 'error' && (e as any).where === 'parse',
    );
    expect(parseErrors).toEqual([]);
  }, 35_000);
});
