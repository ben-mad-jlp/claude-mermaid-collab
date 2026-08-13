// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// Handler-level tests for quarantine_test / list_quarantine, driven through
// handleEpicTool (the shipped dispatch) against a temp MERMAID_SUPERVISOR_DIR ledger.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _closeLedgerDb } from '../../../services/worker-ledger';
import { handleEpicTool } from '../../epic-tools';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'quarantine-verbs-mcp-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
  _closeLedgerDb();
});
afterEach(() => {
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('quarantine_test / list_quarantine handlers', () => {
  test('quarantine_test writes a manual 72h row that list_quarantine round-trips', async () => {
    const before = Date.now();
    const writeJson = await handleEpicTool('quarantine_test', { project, test: 'flaky case title' });
    expect(writeJson).not.toBeNull();
    const written = JSON.parse(writeJson!);
    expect(written.seededFrom).toBe('manual');
    expect(written.quarantinedAtSha).toBe('manual');
    expect(written.evidence.runs).toBe(0);

    const listJson = await handleEpicTool('list_quarantine', { project });
    expect(listJson).not.toBeNull();
    const listed = JSON.parse(listJson!);
    expect(listed.count).toBe(1);
    const row = listed.rows.find((r: any) => r.test === 'flaky case title');
    expect(row).toBeDefined();
    expect(row.seededFrom).toBe('manual');
    expect(row.quarantinedAtSha).toBe('manual');
    expect(row.evidence.runs).toBe(0);
    expect('testFile' in row).toBe(true);

    const delta = row.ttlExpiresAt - before;
    expect(Math.abs(delta - 72 * 3600_000)).toBeLessThan(5000);
  });

  test('missing test arg throws naming test', async () => {
    await expect(handleEpicTool('quarantine_test', { project })).rejects.toThrow(/test/);
  });
});
