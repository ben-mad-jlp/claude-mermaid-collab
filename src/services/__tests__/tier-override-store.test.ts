// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTierOverride, setTierOverride, listTierOverrides, _closeTierDb } from '../tier-override-store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tier-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeTierDb();
});
afterEach(() => {
  _closeTierDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('tier-override-store', () => {
  test('set + get a project override', () => {
    expect(setTierOverride('project', '/p', 'implement', 'claude', 'claude-sonnet-4-6')).toBe(true);
    const o = getTierOverride('project', '/p', 'implement');
    expect(o).toMatchObject({ scope: 'project', scopeId: '/p', phase: 'implement', provider: 'claude', model: 'claude-sonnet-4-6' });
    expect(getTierOverride('project', '/p', 'research')).toBeNull();
  });

  test('upsert replaces the row', () => {
    setTierOverride('epic', 'E1', 'verify', 'claude');
    setTierOverride('epic', 'E1', 'verify', 'grok-build', 'grok-build-0.1');
    expect(getTierOverride('epic', 'E1', 'verify')).toMatchObject({ provider: 'grok-build', model: 'grok-build-0.1' });
  });

  test('empty provider clears the override', () => {
    setTierOverride('project', '/p', 'implement', 'claude');
    expect(setTierOverride('project', '/p', 'implement', '')).toBe(true);
    expect(getTierOverride('project', '/p', 'implement')).toBeNull();
  });

  test('listTierOverrides returns a scope’s rows', () => {
    setTierOverride('project', '/p', 'implement', 'claude');
    setTierOverride('project', '/p', 'review', 'claude', 'claude-opus-4-8');
    setTierOverride('epic', 'E1', 'implement', 'grok-build');
    expect(listTierOverrides('project', '/p').map((o) => o.phase).sort()).toEqual(['implement', 'review']);
    expect(listTierOverrides('epic', 'E1').length).toBe(1);
  });
});
