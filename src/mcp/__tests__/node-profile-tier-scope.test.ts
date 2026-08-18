// Unit tests for tier-scoped node profile overrides in set_node_profile_override.
// Tests that a kind like 'implement@small' is accepted, stored tier-scoped,
// and resolved correctly by resolveTierScopedNodeModel.
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'node-profile-tier-scope-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;
process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = '1';

import { handleSupervisorTool } from '../supervisor-tools.js';
import { addWatchedProject, _closeDb } from '../../services/supervisor-store.js';
import { listNodeProfileOverrides, resolveTierScopedNodeModel } from '../../services/orchestrator-config.js';

const PROJECT = '/tmp/node-profile-tier-scope-proj';

beforeAll(() => {
  _closeDb();
  addWatchedProject(PROJECT);
});
afterAll(() => {
  _closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
  delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
});

describe('set_node_profile_override with tier scope', () => {
  it('a tier-scoped kind is accepted and stored', async () => {
    const result = await handleSupervisorTool('set_node_profile_override', {
      project: PROJECT,
      kind: 'implement@small',
      model: 'sonnet',
    });
    expect(result).toBeDefined();
    const parsed = JSON.parse(result!);
    expect(parsed['implement@small']).toBeDefined();
    expect(parsed['implement@small'].model).toBe('sonnet');

    // Verify tier-scoped lookup works
    const overrides = listNodeProfileOverrides(PROJECT);
    expect(overrides['implement@small']).toBeDefined();
    expect(overrides['implement@small'].model).toBe('sonnet');

    // Tier-scoped resolver should return sonnet for small tier
    const smallResolved = resolveTierScopedNodeModel(overrides, 'implement', 'small');
    expect(smallResolved).toBe('sonnet');

    // Tier-scoped resolver should NOT return sonnet for full tier (no override exists for full)
    const fullResolved = resolveTierScopedNodeModel(overrides, 'implement', 'full');
    expect(fullResolved).toBeNull();
  });

  it('an unknown base kind is still refused', async () => {
    await expect(
      handleSupervisorTool('set_node_profile_override', {
        project: PROJECT,
        kind: 'not-a-kind@small',
        model: 'sonnet',
      }),
    ).rejects.toThrow(/kind must be one of/);
  });
});
