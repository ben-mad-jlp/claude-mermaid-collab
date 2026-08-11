// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// The behaviour this table exists for: a claim is a LEASE. The old global `leaf_inflight` row had
// no deadline, and the daemon is SIGKILLed by its liveness watchdog (477 times in the 18 days to
// 2026-08-10) — SIGKILL runs no cleanup, so a claim outlived its holder forever and every such
// leaf had to be reset by hand. The two tests that carry the whole change are "a dead holder's
// claim expires and is re-acquirable" and "a live claim cannot be stolen"; the rest guard the
// index's status as a HINT rather than an authority.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireClaim, heartbeatClaim, releaseClaim, isClaimLive, listClaims, reapExpiredClaims,
  rebuildClaimIndex, indexedProjectFor, indexedProjects, _closeClaimIndexDb,
  LEAF_CLAIM_LEASE_MS,
} from '../leaf-claim-store';
import { openCollabDb, _closeAllCollabDbs } from '../collab-db';
import { makeClaimProject } from '../__fixtures__/claim-project';

let dir: string;
let project: string;
const T0 = 1_700_000_000_000;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claim-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeClaimIndexDb();
  _closeAllCollabDbs();
  project = makeClaimProject(join(dir, 'proj'), ['L1', 'L2']);
});
afterEach(() => {
  _closeClaimIndexDb();
  _closeAllCollabDbs();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('the lease (the reason this table replaced leaf_inflight)', () => {
  test("a SIGKILLed holder's claim EXPIRES and the leaf becomes re-acquirable", () => {
    expect(acquireClaim({ project, leafId: 'L1', holder: 'daemon-A', leaseMs: 60_000 }, T0)).toBe(true);
    // daemon-A is now gone: no release, no heartbeat, nothing ever runs its cleanup.
    expect(isClaimLive(project, 'L1', undefined, T0 + 59_000)).toBe(true);
    expect(isClaimLive(project, 'L1', undefined, T0 + 60_001)).toBe(false);
    expect(acquireClaim({ project, leafId: 'L1', holder: 'daemon-B', leaseMs: 60_000 }, T0 + 60_001)).toBe(true);
    const row = openCollabDb(project).query('SELECT holder FROM leaf_claim WHERE leafId=?').get('L1') as { holder: string };
    expect(row.holder).toBe('daemon-B');
  });

  test('a LIVE claim cannot be stolen by another holder', () => {
    expect(acquireClaim({ project, leafId: 'L1', holder: 'daemon-A', leaseMs: 60_000 }, T0)).toBe(true);
    expect(acquireClaim({ project, leafId: 'L1', holder: 'daemon-B', leaseMs: 60_000 }, T0 + 59_999)).toBe(false);
    const row = openCollabDb(project).query('SELECT holder, expiresAt FROM leaf_claim WHERE leafId=?')
      .get('L1') as { holder: string; expiresAt: number };
    expect(row.holder).toBe('daemon-A');       // still A's
    expect(row.expiresAt).toBe(T0 + 60_000);   // and the failed steal did not push the deadline out
  });

  test('the SAME holder re-stamping its own claim renews rather than fails', () => {
    // Not cosmetic: the executor re-stamps at every node boundary (that is what keeps nodeKind
    // fresh). If a self-renew read as a steal, a leaf would lose its own claim at node 2.
    expect(acquireClaim({ project, leafId: 'L1', holder: 'A', nodeKind: 'blueprint', leaseMs: 60_000 }, T0)).toBe(true);
    expect(acquireClaim({ project, leafId: 'L1', holder: 'A', nodeKind: 'implement', leaseMs: 60_000 }, T0 + 30_000)).toBe(true);
    expect(listClaims({ project, now: T0 + 30_000 })[0].nodeKind).toBe('implement');
  });

  test('heartbeat extends a live claim and REFUSES an expired one', () => {
    acquireClaim({ project, leafId: 'L1', holder: 'A', leaseMs: 60_000 }, T0);
    expect(heartbeatClaim(project, 'L1', 60_000, T0 + 50_000)).toBe(true);
    expect(isClaimLive(project, 'L1', undefined, T0 + 100_000)).toBe(true); // pushed to T0+110s
    // Once lapsed, the leaf may already belong to someone else — a heartbeat must not resurrect it.
    expect(heartbeatClaim(project, 'L1', 60_000, T0 + 200_000)).toBe(false);
    expect(isClaimLive(project, 'L1', undefined, T0 + 200_000)).toBe(false);
  });

  test('epoch mismatch reads as not-live even inside the lease', () => {
    acquireClaim({ project, leafId: 'L1', holder: 'A', epoch: 'epoch-1', leaseMs: 60_000 }, T0);
    expect(isClaimLive(project, 'L1', 'epoch-1', T0 + 1)).toBe(true);
    expect(isClaimLive(project, 'L1', 'epoch-2', T0 + 1)).toBe(false);
  });

  test('reapExpiredClaims frees only the lapsed leases', () => {
    acquireClaim({ project, leafId: 'L1', holder: 'A', leaseMs: 10_000 }, T0);
    acquireClaim({ project, leafId: 'L2', holder: 'A', leaseMs: 600_000 }, T0);
    expect(reapExpiredClaims(project, T0 + 20_000)).toBe(1);
    expect(listClaims({ project, now: T0 + 20_000 }).map((c) => c.leafId)).toEqual(['L2']);
    expect(reapExpiredClaims(project, T0 + 20_000)).toBe(0); // idempotent
  });

  test('the default lease outlives the longest node cap (IMPLEMENT_TIMEOUT_MS = 30min)', () => {
    // A lease shorter than the slowest legitimate refresh gap would let a healthy long implement
    // node lose its own leaf mid-build — strictly worse than the bug being fixed.
    expect(LEAF_CLAIM_LEASE_MS).toBeGreaterThan(30 * 60 * 1000);
  });
});

describe('the claim cannot outlive its leaf (the foreign key)', () => {
  test('claiming a leafId that is not a todo is REJECTED', () => {
    expect(() => acquireClaim({ project, leafId: 'ghost', holder: 'A' })).toThrow();
  });

  test('deleting the leaf cascades the claim away', () => {
    acquireClaim({ project, leafId: 'L1', holder: 'A' }, T0);
    openCollabDb(project).prepare('DELETE FROM todos WHERE id = ?').run('L1');
    expect(isClaimLive(project, 'L1', undefined, T0 + 1)).toBe(false);
  });
});

describe('the global index is a HINT, never the authority', () => {
  test('a stale pointer at a project with no claim reads as not-live and is cleaned up', () => {
    acquireClaim({ project, leafId: 'L1', holder: 'A' }, T0);
    // Delete the CLAIM behind the index's back — the state a process that died between the two
    // writes leaves behind.
    openCollabDb(project).prepare('DELETE FROM leaf_claim WHERE leafId = ?').run('L1');
    expect(indexedProjectFor('L1')).toBe(project); // the pointer still says "look here"…
    expect(listClaims({ now: T0 + 1 })).toEqual([]); // …and the project database says no.
    expect(indexedProjectFor('L1')).toBeNull(); // swept on the way past
  });

  test('an EXPIRED claim keeps its pointer — expiry is not absence', () => {
    // The opportunistic sweep must key on "no claim row", not "no LIVE claim row": dropping the
    // pointer to a merely-lapsed claim would hide it from the reapers, which is how a phantom
    // becomes permanent.
    acquireClaim({ project, leafId: 'L1', holder: 'A', leaseMs: 1000 }, T0);
    expect(listClaims({ now: T0 + 5000 })).toEqual([]);
    expect(indexedProjectFor('L1')).toBe(project);
  });

  test('listClaims() without a project answers across projects via the index', () => {
    const other = makeClaimProject(join(dir, 'other'), ['X1']);
    acquireClaim({ project, leafId: 'L1', holder: 'A' }, T0);
    acquireClaim({ project: other, leafId: 'X1', holder: 'A' }, T0);
    expect(listClaims({ now: T0 + 1 }).map((c) => c.leafId).sort()).toEqual(['L1', 'X1']);
    expect(indexedProjects().sort()).toEqual([other, project].sort());
  });

  test('rebuildClaimIndex reconstructs the pointers from the project databases', () => {
    acquireClaim({ project, leafId: 'L1', holder: 'A' }, T0);
    acquireClaim({ project, leafId: 'L2', holder: 'A' }, T0);
    // Lose the index entirely (a deleted ledger, a rolled-back file) — the claims are untouched.
    releaseIndexOnly();
    expect(listClaims({ now: T0 + 1 })).toEqual([]);
    expect(rebuildClaimIndex([project])).toBe(2);
    expect(listClaims({ now: T0 + 1 }).map((c) => c.leafId).sort()).toEqual(['L1', 'L2']);
  });

  test('rebuildClaimIndex skips a project it cannot open rather than refusing', () => {
    acquireClaim({ project, leafId: 'L1', holder: 'A' }, T0);
    expect(rebuildClaimIndex(['/definitely/not/a/project', project])).toBe(1);
  });

  test('releaseClaim drops both the claim and its pointer', () => {
    acquireClaim({ project, leafId: 'L1', holder: 'A' }, T0);
    releaseClaim(project, 'L1');
    expect(indexedProjectFor('L1')).toBeNull();
    expect(isClaimLive(project, 'L1', undefined, T0 + 1)).toBe(false);
  });
});

/** Wipe the pointer table without touching a single claim. */
function releaseIndexOnly(): void {
  const { Database } = require('bun:sqlite');
  const d = new Database(join(dir, 'worker-ledger.db'));
  d.exec('DELETE FROM leaf_claim_index');
  d.close();
}
