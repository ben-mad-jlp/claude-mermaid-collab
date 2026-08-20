// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordNode, _closeLedgerDb, type LedgerEntry } from '../worker-ledger';
import { getLeafRun } from '../ledger-stats';

let dir: string;

/** Seed one node row with sane defaults. ts is explicit so ordering is deterministic. */
function node(over: Partial<LedgerEntry> & { leafId: string; ts: number }): void {
  const { ts, ...rest } = over;
  recordNode(
    {
      project: '/p',
      todoId: over.leafId,
      session: 'lane',
      authMode: 'subscription',
      nodeKind: 'implement',
      model: 'sonnet',
      nodesSpent: 1,
      ...rest,
    },
    ts,
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'leaf-run-provider-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeLedgerDb();
});
afterEach(() => {
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('getLeafRun provider surface', () => {
  it('1. getLeafRun reports provider on each node row', () => {
    node({ leafId: 'LP', ts: 1000, provider: 'grok' });
    node({ leafId: 'LP', ts: 2000, provider: 'claude' });
    const run = getLeafRun('LP');
    expect(run).not.toBeNull();
    expect(run!.nodes.map((n) => n.provider)).toEqual(['grok', 'claude']);
  });

  it('2. getLeafRun reports providerFallbackReason parsed from the row outcomeDetail providerFallback.reason', () => {
    node({
      leafId: 'LF',
      ts: 1000,
      outcomeDetail: JSON.stringify({ providerFallback: { reason: '<x>' } }),
    });
    const run = getLeafRun('LF');
    expect(run).not.toBeNull();
    expect(run!.nodes[0].providerFallbackReason).toBe('<x>');
  });

  it('3. a node row with non-JSON outcomeDetail yields providerFallbackReason null instead of throwing', () => {
    node({ leafId: 'LN', ts: 1000, outcomeDetail: 'not json at all' });
    let run: ReturnType<typeof getLeafRun> = null;
    expect(() => {
      run = getLeafRun('LN');
    }).not.toThrow();
    expect(run).not.toBeNull();
    expect(run!.nodes[0].providerFallbackReason).toBeNull();
  });
});
