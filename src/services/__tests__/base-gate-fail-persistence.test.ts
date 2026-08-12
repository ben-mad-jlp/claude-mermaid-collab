import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the ledger DB at a fresh temp dir BEFORE anything opens it, so these tests
// never touch the real ledger (see sibling base-gate-quarantine-downgrade.test.ts).
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'base-gate-fail-persistence-'));

const { resolveBaseGreen } = await import('../leaf-gate');
const { getEpicBaseGate, invalidateEpicBaseGate } = await import('../worker-ledger');
const { upsertQuarantine, DEFAULT_TTL_MS } = await import('../flaky-quarantine');
type LeafGateConfig = import('../leaf-gate').LeafGateConfig;
type LeafGateResult = import('../leaf-gate').LeafGateResult;

const cfg: LeafGateConfig = { baseTest: 'x' };
const ensureEpicWorktree = async () => ({ path: '/tmp/x' });

describe('resolveBaseGreen fail persistence', () => {
  describe('fail paths persist citable epic_base_gate rows', () => {
    it('plain lane fail persists a citable epic_base_gate row', async () => {
      const project = '/persistence-plain-fail';
      const targetProject = '/persistence-plain-fail-target';
      const now = Date.now();

      const runGate = async (): Promise<LeafGateResult> => ({
        status: 'fail',
        output: 'FAIL baseTest',
        reasons: [],
        declared: true,
        baselineFailures: { baseTest: ['x'] },
      });

      const r = await resolveBaseGreen({
        epicId: 'epic-plain-fail', project, targetProject, epicBaseSha: 'sha-plain-fail', gateCfg: cfg,
        ensureEpicWorktree, runGate, now: () => now,
      });

      expect(r?.status).toBe('fail');

      // Verify the row persists and is readable
      const row = getEpicBaseGate('epic-plain-fail', 'sha-plain-fail');
      expect(row).not.toBeNull();
      expect(row?.status).toBe('fail');
      expect(row?.baseSha).toBe('sha-plain-fail');

      // Verify invalidation works
      const invalidated = invalidateEpicBaseGate('epic-plain-fail');
      expect(invalidated.deleted).toBe(true);
    });

    it('mixed quarantined/non-quarantined fail persists a citable epic_base_gate row', async () => {
      const project = '/persistence-mixed-fail';
      const targetProject = '/persistence-mixed-fail-target';
      const now = Date.now();

      // Seed a quarantined test
      upsertQuarantine({
        project: targetProject,
        test: 'suite > flaky',
        quarantinedAtSha: 'abc123',
        evidence: { runs: 5, passRuns: 3, failRuns: 2 },
        ttlExpiresAt: now + DEFAULT_TTL_MS,
        seededFrom: null,
      }, now);

      const runGate = async (): Promise<LeafGateResult> => ({
        status: 'fail',
        output: 'FAIL suite > flaky\nFAIL suite > real bug',
        reasons: [],
        declared: true,
        baselineFailures: { baseTest: ['suite > flaky', 'suite > real bug'] },
      });

      const r = await resolveBaseGreen({
        epicId: 'epic-mixed-fail', project, targetProject, epicBaseSha: 'sha-mixed-fail', gateCfg: cfg,
        ensureEpicWorktree, runGate, now: () => now,
      });

      expect(r?.status).toBe('fail');
      expect(r?.quarantinedOnlyFailures).toBeUndefined();

      // Verify the row persists despite mixed status
      const row = getEpicBaseGate('epic-mixed-fail', 'sha-mixed-fail');
      expect(row).not.toBeNull();
      expect(row?.status).toBe('fail');
      expect(row?.baseSha).toBe('sha-mixed-fail');

      // Verify invalidation works
      const invalidated = invalidateEpicBaseGate('epic-mixed-fail');
      expect(invalidated.deleted).toBe(true);
    });

    it('poisoned-checkout fallthrough fail persists a citable epic_base_gate row', async () => {
      const project = '/persistence-poisoned-fail';
      const targetProject = '/persistence-poisoned-fail-target';
      const now = Date.now();

      const runGate = async (): Promise<LeafGateResult> => ({
        status: 'fail',
        output: 'FAIL baseTest',
        reasons: [],
        declared: true,
        baselineFailures: { baseTest: ['x'] },
        poisonedCheckout: { paths: ['a'], restored: ['a'] },
      });

      const r = await resolveBaseGreen({
        epicId: 'epic-poisoned-fail', project, targetProject, epicBaseSha: 'sha-poisoned-fail', gateCfg: cfg,
        ensureEpicWorktree, runGate, now: () => now,
      });

      expect(r?.status).toBe('fail');
      expect(r?.poisonedCheckout).toEqual({ paths: ['a'], restored: ['a'] });

      // Verify the row persists with the extra field intact
      const row = getEpicBaseGate('epic-poisoned-fail', 'sha-poisoned-fail');
      expect(row).not.toBeNull();
      expect(row?.status).toBe('fail');
      expect(row?.baseSha).toBe('sha-poisoned-fail');

      // Verify invalidation works
      const invalidated = invalidateEpicBaseGate('epic-poisoned-fail');
      expect(invalidated.deleted).toBe(true);
    });
  });

  describe('downgrade paths do NOT persist rows', () => {
    it('dep-optimizer-corruption downgrade to error requires no row', async () => {
      const project = '/persistence-dep-optimizer';
      const targetProject = '/persistence-dep-optimizer-target';
      const now = Date.now();

      const runGate = async (): Promise<LeafGateResult> => ({
        status: 'fail',
        output: 'Cannot find module foo\nError at .vite/deps/bar',
        reasons: [],
        declared: true,
        baselineFailures: { baseTest: ['x'] },
      });

      const r = await resolveBaseGreen({
        epicId: 'epic-dep-optimizer', project, targetProject, epicBaseSha: 'sha-dep-optimizer', gateCfg: cfg,
        ensureEpicWorktree, runGate, now: () => now,
      });

      expect(r?.status).toBe('error');

      // Verify no row is written for downgraded errors
      const row = getEpicBaseGate('epic-dep-optimizer', 'sha-dep-optimizer');
      expect(row).toBeNull();
    });

    it('dep-optimizer-corruption downgrade to error requires no row (.vitest-cache/deps variant)', async () => {
      const project = '/persistence-dep-optimizer-vc';
      const targetProject = '/persistence-dep-optimizer-vc-target';
      const now = Date.now();

      const runGate = async (): Promise<LeafGateResult> => ({
        status: 'fail',
        output: 'ERR_MODULE_NOT_FOUND: Cannot find module\nat .vitest-cache/deps/chunk-XYZ.js',
        reasons: [],
        declared: true,
        baselineFailures: { baseTest: ['x'] },
      });

      const r = await resolveBaseGreen({
        epicId: 'epic-dep-optimizer-vc', project, targetProject, epicBaseSha: 'sha-dep-optimizer-vc', gateCfg: cfg,
        ensureEpicWorktree, runGate, now: () => now,
      });

      expect(r?.status).toBe('error');

      const row = getEpicBaseGate('epic-dep-optimizer-vc', 'sha-dep-optimizer-vc');
      expect(row).toBeNull();
    });

    it('epicBaseSha:null downgrades to error and requires no row', async () => {
      const project = '/persistence-null-sha';
      const targetProject = '/persistence-null-sha-target';
      const now = Date.now();

      const runGate = async (): Promise<LeafGateResult> => ({
        status: 'fail',
        output: 'FAIL baseTest',
        reasons: [],
        declared: true,
        baselineFailures: { baseTest: ['x'] },
      });

      const r = await resolveBaseGreen({
        epicId: 'epic-null-sha', project, targetProject, epicBaseSha: null, gateCfg: cfg,
        ensureEpicWorktree, runGate, now: () => now,
      });

      expect(r?.status).toBe('error');
      expect(r?.reasons).toContain('no epic base sha to key a cached verdict to — cannot record a citable base-gate fact');

      // Verify no row is written for null-sha downgrades
      const row = getEpicBaseGate('epic-null-sha', null);
      expect(row).toBeNull();
    });
  });
});
