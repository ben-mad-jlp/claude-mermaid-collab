import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * S6 — the READ-SIDE drift oracle as a CI check (epic b2c858d4, de-conflate todo status).
 *
 * The de-conflate refactor makes `ready`/`blocked`/`in_progress` DERIVED facts owned by
 * claimability.ts; no reader may branch on the shadow enum (`status === 'ready'|'blocked'`).
 * This test runs the grep oracle from the design and asserts it returns NOTHING outside a
 * small, EXPLICIT, COMMENTED allowlist of known-deferred sites. As each allowlisted site
 * migrates (the S5 tail), delete its entry here and the oracle tightens to zero automatically.
 *
 * It also asserts NO `claimable_todos` SQL view exists (the forbidden second copy of the rule).
 */

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

// The design's oracle pattern: any `status === 'ready'` / `status === 'blocked'` read.
const ORACLE_PATTERN = `status *=== *['"](ready|blocked)['"]`;

/**
 * ALLOWLIST — known sites that currently match the oracle, each with its reason and
 * its removal trigger. The test PASSES today because every live match is one of these.
 *
 * Two categories:
 *   (A) NOT a lying read — write-side translation seams (a status WRITE that the seam
 *       rewrites into a decision-write), comments, or a legacy invariant that reads the
 *       enum on purpose. These are coherent under the new model and stay.
 *   (B) S5-TAIL — genuine unmigrated read-side derivations. Marked "remove when S5-tail
 *       lands"; deleting the migrated site's entry makes the oracle tighten to zero.
 *
 * Each entry is keyed by repo-relative path; `count` is how many oracle matches that file
 * currently has. A file not listed here must have ZERO matches.
 */
interface AllowEntry {
  file: string;
  count: number;
  reason: string;
}
const ALLOWLIST: AllowEntry[] = [
  // (A) WRITE-side seam — translates a status:'ready' write into approvedAt (the Planner
  //     approve verb). Not a read of the shadow enum. Stays.
  { file: 'src/routes/supervisor-routes.ts', count: 2, reason: 'write-side: status==="ready" → approvedAt (Planner approve verb) + its explanatory comment; not a derived read' },

  // (A) WRITE-side seam — resetTodo fires the kick when the requested status is 'ready'
  //     (post-translation input-edge), reading the requested param, not a stored row. Stays.
  { file: 'src/services/todo-store.ts', count: 1, reason: 'write-side: resetTodo kick on requested status==="ready" (unheld input edge), not a derived read' },

  // (A) LEGACY invariant check — the epic-planned-ready-child invariant intentionally reads
  //     a child's enum. Orthogonal to the claim model; not a readiness derivation. Stays.
  { file: 'src/services/invariant-check.ts', count: 1, reason: 'legacy epic-planned-ready-child invariant intentionally reads child.status==="ready"' },

  // (B) S5-TAIL — coordinator-core still keys claim selection on status==='ready'. Migrate to
  //     isClaimable/claimReason; remove when S5-tail lands.
  { file: 'src/services/coordinator-core.ts', count: 1, reason: 'S5-tail: daemon-core still reads status==="ready"; migrate to isClaimable — remove when S5-tail lands' },

  // (B) S5-TAIL — funnel.ts byId-absent single-todo fallback (documented in funnel.ts):
  //     2 matches (ready + blocked legacy-enum fallbacks). Remove when callers thread byId.
  { file: 'ui/src/components/supervisor/bridge/funnel.ts', count: 3, reason: 'S5-tail: byId-absent legacy-enum fallback (ready + blocked) + the blocked-fallback explanatory comment — remove when callers thread byId' },

  // (B) S5-TAIL — BridgeDashboard readyCount still reads status==='ready'. Migrate to isClaimable;
  //     remove when S5-tail lands.
  { file: 'ui/src/components/supervisor/bridge/BridgeDashboard.tsx', count: 1, reason: 'S5-tail: readyCount reads status==="ready"; migrate to isClaimable — remove when S5-tail lands' },

  // NOTE on comment-only matches: a few files contain the literal `status==='ready'` inside
  // explanatory COMMENTS (e.g. ui/src/lib/claimability.ts, funnel.ts blocked-fallback comment).
  // Those are caught by the oracle pattern too; they are folded into the per-file counts above
  // (funnel.ts) or listed here. claimability.ts (lib) doc comment:
  { file: 'ui/src/lib/claimability.ts', count: 1, reason: 'doc comment quoting the forbidden pattern (no actual read)' },
];

interface Match {
  file: string;
  line: number;
  text: string;
}

function runOracle(): Match[] {
  // grep -rnE over src/ and ui/src/. Exit 1 = no matches (fine). We parse stdout.
  const res = spawnSync(
    'grep',
    ['-rnE', ORACLE_PATTERN, 'src/', 'ui/src/'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  // grep exit codes: 0 = matches, 1 = none, >1 = error.
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(`grep oracle failed (status ${res.status}): ${res.stderr}`);
  }
  const out = (res.stdout ?? '').trim();
  if (!out) return [];
  return out.split('\n').map((l) => {
    const m = l.match(/^([^:]+):(\d+):(.*)$/);
    if (!m) throw new Error(`unparseable grep line: ${l}`);
    return { file: m[1], line: Number(m[2]), text: m[3] };
  });
}

describe('S6 read-side drift oracle', () => {
  test('no status==="ready"/"blocked" reads outside the documented allowlist', () => {
    const matches = runOracle();

    // Exclude test files — they legitimately reference the shadow enum to drive/assert the
    // store seam (e.g. asserting a patch translated status:'blocked' → a hold). The oracle
    // targets PRODUCTION readers, not test fixtures.
    const live = matches.filter((m) => !/(\.test\.ts|__tests__\/)/.test(m.file));

    const byFile = new Map<string, number>();
    for (const m of live) byFile.set(m.file, (byFile.get(m.file) ?? 0) + 1);

    const allowed = new Map(ALLOWLIST.map((a) => [a.file, a.count]));

    // 1. Every matched file must be on the allowlist with the EXPECTED count (no new
    //    unlisted readers, and no drift in a listed file's count).
    const offenders: string[] = [];
    for (const [file, count] of byFile) {
      const exp = allowed.get(file);
      if (exp == null) {
        const lines = live.filter((m) => m.file === file);
        offenders.push(`UNLISTED reader ${file}:\n${lines.map((l) => `    ${l.line}: ${l.text.trim()}`).join('\n')}`);
      } else if (count !== exp) {
        offenders.push(`COUNT DRIFT ${file}: expected ${exp}, found ${count}`);
      }
    }
    expect(offenders, offenders.join('\n\n')).toEqual([]);

    // 2. Allowlist hygiene: an allowlisted file that NO LONGER matches must be removed
    //    (the oracle tightens to zero automatically). Flag stale entries.
    const stale = ALLOWLIST.filter((a) => (byFile.get(a.file) ?? 0) === 0).map((a) => a.file);
    expect(stale, `stale allowlist entries (migrated — delete them): ${stale.join(', ')}`).toEqual([]);
  });

  test('no claimable_todos SQL view exists (no forbidden second copy of the rule)', () => {
    const res = spawnSync('grep', ['-rniE', 'claimable_todos', 'src/', 'ui/src/'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    if (res.status !== 0 && res.status !== 1) {
      throw new Error(`grep view-check failed (status ${res.status}): ${res.stderr}`);
    }
    const hits = (res.stdout ?? '')
      .split('\n')
      .filter((l) => l.trim() && !l.includes('status-oracle.test.ts'));
    expect(hits, `claimable_todos appears (forbidden SQL view re-encoding the rule):\n${hits.join('\n')}`).toEqual([]);
  });
});
