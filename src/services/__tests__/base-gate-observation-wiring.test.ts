import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The recorder hits the real ledger DB (worker-ledger.openDb, keyed off
// MERMAID_SUPERVISOR_DIR and memoized on first open) — point it at a fresh temp
// dir BEFORE anything opens it, so these tests never touch the real ledger.
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'base-gate-observe-'));

const { runBaseGate } = await import('../leaf-gate');
const { listObservations } = await import('../worker-ledger');
const { upsertQuarantine, DEFAULT_TTL_MS } = await import('../flaky-quarantine');
type LeafGateConfig = import('../leaf-gate').LeafGateConfig;

const cfg: LeafGateConfig = { baseTest: 'npm run test:ci' };

describe('runBaseGate observation wiring', () => {
  it('a green lane writes watched rows with failed:false, including a prior quarantine name', async () => {
    const project = '/observe-green';
    const baseSha = 'sha-green';
    const now = Date.now();
    upsertQuarantine({
      project,
      test: 'suite > known flaky',
      quarantinedAtSha: 'abc123',
      evidence: { runs: 5, passRuns: 3, failRuns: 2 },
      ttlExpiresAt: now + DEFAULT_TTL_MS,
      seededFrom: null,
    }, now);

    const spawn = async () => ({ ran: true, code: 0, output: '' });
    await runBaseGate('/cwd', cfg, spawn, { project, baseSha });

    const rows = listObservations(project, 0);
    const row = rows.find((r) => r.test === 'suite > known flaky');
    expect(row).toBeDefined();
    expect(row!.failed).toBe(false);
    expect(row!.lane).toBe('baseTest');
  });

  it('a red lane writes failed:true rows for its extracted failing tests', async () => {
    const project = '/observe-red';
    const baseSha = 'sha-red';
    const spawn = async () => ({
      ran: true,
      code: 1,
      output: 'FAIL suite > broken test\n',
    });
    await runBaseGate('/cwd', cfg, spawn, { project, baseSha });

    const rows = listObservations(project, 0);
    const row = rows.find((r) => r.test === 'suite > broken test');
    expect(row).toBeDefined();
    expect(row!.failed).toBe(true);
    expect(row!.lane).toBe('baseTest');
  });

  it('a lane that could not run (ran:false) writes zero rows', async () => {
    const project = '/observe-ranfalse';
    const baseSha = 'sha-ranfalse';
    const spawn = async () => ({ ran: false, code: 1, output: '' });
    const result = await runBaseGate('/cwd', cfg, spawn, { project, baseSha });

    expect(result.status).toBe('error');
    expect(listObservations(project, 0)).toEqual([]);
  });

  it('omitting observe writes zero rows', async () => {
    const project = '/observe-omitted';
    const spawn = async () => ({ ran: true, code: 0, output: '' });
    await runBaseGate('/cwd', cfg, spawn);

    expect(listObservations(project, 0)).toEqual([]);
  });
});
