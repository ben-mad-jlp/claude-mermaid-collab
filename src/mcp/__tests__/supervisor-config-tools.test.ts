// Unit tests for the set_node_profile_override MCP tool
// in src/mcp/supervisor-tools.ts. Isolates the supervisor-store DB via
// MERMAID_SUPERVISOR_DIR before import.
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'supervisor-config-tools-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import { handleSupervisorTool } from '../supervisor-tools.js';
import { addWatchedProject, _closeDb } from '../../services/supervisor-store.js';
import { listNodeProfileOverrides } from '../../services/orchestrator-config.js';

const PROJECT = '/tmp/supervisor-config-tools-proj';

beforeAll(() => {
  _closeDb();
  addWatchedProject(PROJECT);
});
afterAll(() => {
  _closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('set_node_profile_override', () => {
  it('sets an override, then clearing model/effort/provider deletes the row', async () => {
    const set = await handleSupervisorTool('set_node_profile_override', { project: PROJECT, kind: 'blueprint', model: 'sonnet' });
    expect(JSON.parse(set!).blueprint.model).toBe('sonnet');
    expect(listNodeProfileOverrides(PROJECT).blueprint.model).toBe('sonnet');

    const cleared = await handleSupervisorTool('set_node_profile_override', { project: PROJECT, kind: 'blueprint', model: null, effort: null, provider: null });
    expect(JSON.parse(cleared!).blueprint).toBeUndefined();
    expect(listNodeProfileOverrides(PROJECT).blueprint).toBeUndefined();
  });

  it('rejects an unknown kind', async () => {
    await expect(
      handleSupervisorTool('set_node_profile_override', { project: PROJECT, kind: 'not-a-kind', model: 'sonnet' }),
    ).rejects.toThrow(/kind must be one of/);
  });
});
