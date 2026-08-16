import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEAF_NODE_KINDS, NODE_PROFILE } from '../leaf-node-profile';
import { resolveNodeModel, resolveNodeProvider } from '../node-provider';
import { setNodeProfileOverride, _closeDb } from '../orchestrator-config';

// Isolate both config.json (MERMAID_CONFIG_PATH) AND the orchestrator DB
// (MERMAID_SUPERVISOR_DIR) to temp so tests never touch the developer's real state.
const PROJECT = '/proj/campaign-roles';
let tmpDir: string;

function isolate() {
  tmpDir = mkdtempSync(join(tmpdir(), 'campaign-roles-'));
  process.env.MERMAID_CONFIG_PATH = join(tmpDir, 'config.json');
  process.env.MERMAID_SUPERVISOR_DIR = tmpDir;
  _closeDb();
}

beforeEach(isolate);
afterEach(() => {
  delete process.env.MERMAID_CONFIG_PATH;
  delete process.env.MERMAID_SUPERVISOR_DIR;
  _closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('campaign-role node profiles', () => {
  it('exposes the lens and commander roles through the same node-profile registry as blueprint and implement', () => {
    // Both kinds must be in the kinds array
    expect(LEAF_NODE_KINDS).toContain('lens');
    expect(LEAF_NODE_KINDS).toContain('commander');

    // Both must have NODE_PROFILE entries
    expect(NODE_PROFILE.lens).toBeDefined();
    expect(NODE_PROFILE.commander).toBeDefined();

    // Verify they have the correct properties
    expect(NODE_PROFILE.lens.model).toBe('opus');
    expect(NODE_PROFILE.lens.effort).toBe('high');
    expect(NODE_PROFILE.lens.allowedTools).toContain('Read');
    expect(NODE_PROFILE.lens.allowedTools).toContain('Grep');
    expect(NODE_PROFILE.lens.allowedTools).toContain('Glob');
    expect(NODE_PROFILE.lens.allowedTools).toContain('Bash');

    expect(NODE_PROFILE.commander.model).toBe('opus');
    expect(NODE_PROFILE.commander.effort).toBe('high');
    expect(NODE_PROFILE.commander.allowedTools).toContain('Read');
    expect(NODE_PROFILE.commander.allowedTools).toContain('Grep');
    expect(NODE_PROFILE.commander.allowedTools).toContain('Glob');
    expect(NODE_PROFILE.commander.allowedTools).toContain('Bash');

    // Verify they resolve through the same registry as blueprint/implement (no override)
    expect(resolveNodeModel(PROJECT, 'lens', 'claude', NODE_PROFILE.lens.model)).toBe('opus');
    expect(resolveNodeModel(PROJECT, 'commander', 'claude', NODE_PROFILE.commander.model)).toBe('opus');

    // Same call shape used for blueprint/implement — blueprint defaults to sonnet
    expect(resolveNodeModel(PROJECT, 'blueprint', 'claude', NODE_PROFILE.blueprint.model)).toBe('sonnet');
    expect(resolveNodeModel(PROJECT, 'implement', 'claude', NODE_PROFILE.implement.model)).toBe('sonnet');
  });

  it('honours a per-project model override pinned on a lens role independently of the commander', () => {
    // Pin lens to sonnet (a valid Claude model)
    setNodeProfileOverride(PROJECT, 'lens', 'sonnet', null, null);

    // lens resolves to the override
    expect(resolveNodeModel(PROJECT, 'lens', 'claude', NODE_PROFILE.lens.model)).toBe('sonnet');

    // commander is unaffected and keeps its default
    expect(resolveNodeModel(PROJECT, 'commander', 'claude', NODE_PROFILE.commander.model)).toBe('opus');

    // Verify provider resolution still works for both kinds
    expect(resolveNodeProvider(PROJECT, 'lens', NODE_PROFILE.lens.allowedTools)).toBe('claude');
    expect(resolveNodeProvider(PROJECT, 'commander', NODE_PROFILE.commander.allowedTools)).toBe('claude');
  });
});
