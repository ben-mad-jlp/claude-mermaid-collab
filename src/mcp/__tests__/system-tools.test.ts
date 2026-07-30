// Unit test for the daemon_status MCP tool's conductor timeout-kill surfacing
// in src/mcp/system-tools.ts. Isolates the supervisor-store DB via
// MERMAID_SUPERVISOR_DIR before import.
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'system-tools-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import { handleSystemTool } from '../system-tools.js';
import { addWatchedProject, setConductorLastPass, _closeDb } from '../../services/supervisor-store.js';
import {
  openPassRow,
  finalizePassRow,
  _closeConductorJournalDb,
} from '../../services/conductor-pass-journal.js';

const PROJECT = '/tmp/system-tools-proj';

beforeAll(() => {
  _closeDb();
  addWatchedProject(PROJECT);
});
afterAll(() => {
  _closeDb();
  _closeConductorJournalDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('daemon_status', () => {
  it('surfaces the conductor timeout-kill count and needs-attention state', async () => {
    setConductorLastPass(PROJECT, {
      missionId: 'm1',
      reason: 'conductor-timeouts-capped',
      tickAt: Date.now(),
      status: 'killed 3x — needs you',
      timeoutKills: 3,
    });
    const result = await handleSystemTool('daemon_status', { project: PROJECT });
    const parsed = JSON.parse(result!);
    expect(parsed.conductor.timeoutKills).toBe(3);
    expect(parsed.state).toBe('needs-attention');
  });
});

describe('list_conductor_passes', () => {
  it('list_conductor_passes returns seeded rows via the registered handler', async () => {
    const project = '/tmp/system-tools-journal-proj';
    for (const [missionId, startedAt] of [['m1', 1000], ['m1', 3000], ['m2', 2000]] as const) {
      const id = openPassRow(project, missionId, startedAt);
      expect(id).not.toBeNull();
      finalizePassRow(id!, { endedAt: startedAt + 1000, outcome: 'conducted', ran: true });
    }

    const all = JSON.parse((await handleSystemTool('list_conductor_passes', { project }))!);
    expect(all.map((r: any) => r.startedAt)).toEqual([3000, 2000, 1000]);
    expect(all[0].outcome).toBe('conducted');
    expect(all[0].ran).toBe(true);

    const scoped = JSON.parse((await handleSystemTool('list_conductor_passes', { project, missionId: 'm1' }))!);
    expect(scoped.map((r: any) => r.startedAt)).toEqual([3000, 1000]);

    const capped = JSON.parse((await handleSystemTool('list_conductor_passes', { project, limit: 1 }))!);
    expect(capped).toHaveLength(1);
    expect(capped[0].startedAt).toBe(3000);
  });
});
