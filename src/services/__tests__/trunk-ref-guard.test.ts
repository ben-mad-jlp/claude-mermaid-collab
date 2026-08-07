import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * TRUNK-REF DRIFT ORACLE (mission da532749 tail).
 *
 * Several git/base/land code paths historically hardcoded the trunk as literal
 * `master`, so on a repo whose trunk is `main` (no `master` ref) they failed:
 * `rev-list master..X` enumerated nothing, `worktree add trial master` errored,
 * base-comparison probes returned null. The canonical fix is to resolve the trunk
 * via `WorktreeManager.detectBaseBranch()` (main→master→origin/HEAD→'master').
 *
 * This oracle greps PRODUCTION `src/` for any literal trunk ref in a git context
 * (`'master'`, `"master"`, `master..`, `..master`) and asserts every match is on
 * an EXPLICIT, COMMENTED allowlist of known-safe sites. A NEW unlisted literal
 * `master` (a fresh hardcode) FAILS this test. As a site migrates to
 * detectBaseBranch, drop/decrement its entry and the oracle tightens.
 *
 * Safe categories:
 *   (FALLBACK) the `.catch(() => 'master')` / literal fallback INSIDE a resolver
 *              that tries main first — behaviour-preserving, correct on main-trunk.
 *   (DEFAULT)  a `baseRef = 'master'` default PARAMETER on a helper whose real
 *              callers thread the resolved trunk (the default is only the un-threaded
 *              legacy edge).
 *   (STRING)   prose in a comment / tool description / user-facing message.
 *   (CONSERVATIVE) a soft `?? 'master'` fallback deliberately LEFT un-wired because
 *              wiring detectBaseBranch would force an async refactor of a hot path
 *              or thread a param through many callers (trunk-ref Part B rule).
 *              TODO(trunk-ref): resolve via detectBaseBranch when cheap.
 */

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

// Literal trunk ref in a git context: quoted 'master'/"master" or a range endpoint.
const ORACLE_PATTERN = `'master'|"master"|master\\.\\.|\\.\\.master`;

interface AllowEntry {
  file: string;
  count: number;
  reason: string;
}

const ALLOWLIST: AllowEntry[] = [
  // (FALLBACK + DEFAULT + STRING) the shared trunk-ref.ts resolver itself: its own
  // origin/HEAD-then-main-then-master probe array + literal fallback (twice — the
  // early-return inside the try and the catch-block return) + two doc-comment mentions.
  // All four call sites below delegate here.
  { file: 'src/services/trunk-ref.ts', count: 5, reason: 'resolveTrunkRef main→master probe array + two literal-fallback returns + two doc-comment mentions' },

  // (FALLBACK + DEFAULT + STRING) the canonical resolver itself + the many
  // `baseRef: string = 'master'` default params on WorktreeManager git helpers
  // whose real callers pass a resolved ref, plus detectBaseBranch's main→master
  // candidate list and its literal fallback, plus doc comments. All behaviour-
  // preserving on a master-trunk repo.
  { file: 'src/agent/worktree-manager.ts', count: 14, reason: 'detectBaseBranch main→master probe + literal fallback; baseRef="master" default params on git helpers (callers thread resolved ref); doc comments' },

  // (CONSERVATIVE) leaf-executor's baseBranch fallback on the HOT dispatch path
  // (:1260 deps construction, :2951 node wiring) + doc comments. Wiring
  // detectBaseBranch here would make the synchronous dispatch async / thread a
  // param through many callers — deliberately LEFT per the Part B conservative rule.
  { file: 'src/services/leaf-executor.ts', count: 7, reason: 'CONSERVATIVE: baseBranch ?? "master" on the hot leaf dispatch path (:1260/:2951) + doc comments; wiring detectBaseBranch would async-refactor a hot path' },

  // (STRING) the flow-header comment's "ahead of master (rev-list master..<source>)"
  // prose is the only literal-matching line left in this file.
  { file: 'src/services/adopt-branch-as-epic.ts', count: 1, reason: 'flow-header comment ("ahead of master (rev-list master..<source>)") is the only literal-matching line' },

  // (DEFAULT + STRING) commitsBehindMaster's baseRef default param + two
  // `HEAD..master` doc-comment mentions in the predicate table.
  { file: 'src/services/steward-proof.ts', count: 3, reason: 'commitsBehindMaster baseRef default param + two HEAD..master doc-comment mentions in the predicate table' },

  // (FALLBACK + DEFAULT + STRING) epic-branch-status is the LIGHT trunk-resolution
  // module (todo-store only). What remains: DEFAULT_REQUESTED_REF (the un-threaded
  // default, named once); two `baseRef = 'master'` default params on helpers whose
  // callers thread the resolved ref; pickBaseRef's own SEPARATE, deliberately
  // un-migrated main→master probe list + its build123d doc comment — pickBaseRef is
  // called DIRECTLY by conductor-wake-gate.ts and epic-branch-status.test.ts and is
  // not part of the resolver collapse. Low-level services import detectTrunkRef from
  // HERE (not the heavy coordinator-live hub) to avoid a module-init TDZ cycle.
  { file: 'src/services/epic-branch-status.ts', count: 5, reason: 'DEFAULT_REQUESTED_REF; two baseRef="master" default params; pickBaseRef (a separate, un-migrated picker used directly by conductor-wake-gate.ts and its own tests) main→master probe + build123d doc comment' },

  // (FALLBACK + STRING) epic_branch_status passes baseRef||"master" into
  // getEpicBranchStatus, which resolves the trunk internally via the shared resolver in
  // trunk-ref.ts — correct on a main-trunk repo. Plus a comment and three tool
  // DESCRIPTION strings mentioning "master".
  { file: 'src/mcp/epic-tools.ts', count: 5, reason: 'baseRef||"master" resolved internally by getEpicBranchStatus via the shared resolver in trunk-ref.ts + comment + tool description strings' },

  // (FALLBACK + STRING) impacted-suite baseline worktree now resolves the trunk via a
  // ctx.exec main→master probe (literal fallback) + a comment.
  { file: 'src/services/gate-runner.ts', count: 3, reason: 'impacted-suite baseline: main→master probe via ctx.exec + literal fallback + comment' },

  // (FALLBACK + STRING) runEpicLandGate now resolves the trunk via the injected git
  // runner (main→master probe, literal fallback) + a comment.
  { file: 'src/services/epic-land-gate.ts', count: 3, reason: 'runEpicLandGate: main→master probe via injected git + literal fallback + comment' },

  // (FALLBACK + STRING) revalidateStaleEpic resolves via detectBaseBranch (fixed by
  // mission da532749) + two user-facing "on branch other than master" messages.
  { file: 'src/services/coordinator-land.ts', count: 3, reason: 'revalidateStaleEpic detectBaseBranch fallback + user-facing checkout-branch messages' },

  // (FALLBACK) both sweep entrypoints now resolve baseRef via
  // detectBaseBranch().catch(()=>"master") (trunk-ref Part B).
  { file: 'src/services/landed-epic-sweep.ts', count: 3, reason: 'reconcileLandedEpics + terminalizeLandedEpics + gcEpicBranches resolve baseRef via detectBaseBranch fallback (Part B)' },

  // (FALLBACK + STRING) conductor-wake-gate pickBaseRef fallback arg + the comment
  // explaining why a literal master would signature-freeze.
  { file: 'src/services/conductor-wake-gate.ts', count: 2, reason: 'pickBaseRef fallback arg + explanatory comment' },

  // (CONSERVATIVE) verify-epic base fallback `opts.base?.trim() || 'master'` on the
  // verify dispatch path — LEFT un-wired per the Part B conservative rule.
  // TODO(trunk-ref): resolve via detectBaseBranch when cheap.
  { file: 'src/services/verify-epic.ts', count: 1, reason: 'CONSERVATIVE: base ?? "master" on the verify dispatch path (Part B leave); TODO(trunk-ref) resolve via detectBaseBranch' },

  // (CONSERVATIVE) rescue-ref baseRef default 'master' — DELIBERATELY LEFT: the
  // function ALREADY has an explicit main-then-master probe immediately after
  // (baseRefResolved falls through to refs/heads/main), so it is correct on a
  // main-trunk repo without importing detectBaseBranch. Safest un-touched.
  { file: 'src/services/rescue-ref.ts', count: 1, reason: 'CONSERVATIVE: baseRef default "master" but the function already probes main-then-master right after — correct on main-trunk without detectBaseBranch' },

  // (STRING) comment describing the off-master derivation (`git rev-list master..<branch>`).
  { file: 'src/routes/supervisor-routes.ts', count: 1, reason: 'comment describing the off-master rev-list derivation' },

  // (CONSERVATIVE / FALLBACK) base-repair raise site's detectBaseBranch() fail-open
  // default — mirrors the `.catch(() => 'master')` pattern already allowed elsewhere.
  { file: 'src/services/conductor-infra-arm.ts', count: 1, reason: 'CONSERVATIVE/FALLBACK: detectBaseBranch() fail-open default "master" at the base-repair raise site, mirrors the .catch(() => "master") pattern already allowed elsewhere' },
];

interface Match { file: string; line: number; text: string; }

function runOracle(): Match[] {
  const res = spawnSync('grep', ['-rnE', ORACLE_PATTERN, 'src/'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
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

describe('trunk-ref drift oracle', () => {
  test('no literal-master git refs outside the documented allowlist', () => {
    const matches = runOracle();

    // Exclude test files — they legitimately construct master/main temp repos and
    // reference the literal to drive/assert the trunk resolution. The oracle targets
    // PRODUCTION code, not fixtures.
    const live = matches.filter((m) => !/(\.test\.ts|__tests__\/)/.test(m.file));

    const byFile = new Map<string, number>();
    for (const m of live) byFile.set(m.file, (byFile.get(m.file) ?? 0) + 1);

    const allowed = new Map(ALLOWLIST.map((a) => [a.file, a.count]));

    const offenders: string[] = [];
    for (const [file, count] of byFile) {
      const exp = allowed.get(file);
      if (exp == null) {
        const lines = live.filter((m) => m.file === file);
        offenders.push(
          `UNLISTED literal-master ref ${file}:\n${lines.map((l) => `    ${l.line}: ${l.text.trim()}`).join('\n')}\n  → resolve the trunk via detectBaseBranch (see mission da532749), or add a COMMENTED allowlist entry explaining why it is safe.`,
        );
      } else if (count !== exp) {
        const lines = live.filter((m) => m.file === file);
        offenders.push(
          `COUNT DRIFT ${file}: expected ${exp}, found ${count}:\n${lines.map((l) => `    ${l.line}: ${l.text.trim()}`).join('\n')}`,
        );
      }
    }
    expect(offenders, offenders.join('\n\n')).toEqual([]);

    // Allowlist hygiene: a listed file that no longer matches must be removed.
    const stale = ALLOWLIST.filter((a) => (byFile.get(a.file) ?? 0) === 0).map((a) => a.file);
    expect(stale, `stale allowlist entries (migrated — delete them): ${stale.join(', ')}`).toEqual([]);
  });
});
