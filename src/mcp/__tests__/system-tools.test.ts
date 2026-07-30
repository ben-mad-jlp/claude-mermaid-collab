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

const PROJECT = '/tmp/system-tools-proj';

beforeAll(() => {
  _closeDb();
  addWatchedProject(PROJECT);
});
afterAll(() => {
  _closeDb();
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
