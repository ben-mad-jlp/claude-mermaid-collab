/**
 * Sync-spawn regression tripwire (crit-6, mission 693bbc27).
 *
 * WHY: the sidecar is a single-threaded event loop guarded by the Electron liveness
 * watchdog (45s). Any synchronous subprocess call in daemon-resident code blocks that
 * loop for the child's full runtime — epic-branch probes and gate runs via spawnSync
 * held it long enough that the watchdog silently kill+respawned the sidecar in a loop
 * (2026-07-22 crash-loop). The class was retired by converting daemon-resident sync
 * spawns to async (Bun.spawn / child_process.execFile + await); this test makes the
 * NEXT sync-spawn addition fail CI instead of crash-looping production.
 *
 * RULE: every occurrence of spawnSync / execSync / execFileSync in non-test src code
 * must appear in the allowlist below, with a comment documenting WHY it is exempt —
 * either it runs outside the sidecar process, or its worst-case bound is far under
 * the 45s watchdog. Counts are EXACT: adding one more sync call to an allowlisted
 * file fails too (convert it to async, or consciously re-justify + bump the count).
 *
 * HOW TO FIX A FAILURE: convert the new call site to an async spawn —
 * mirror leaf-gate.ts `defaultGateSpawn` (Bun.spawn + await exited) or
 * steward-proof.ts `execAsync` (child_process.execFile promisified). Only allowlist
 * when you can state a hard worst-case bound well under 45s.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC_ROOT = resolve(import.meta.dir, '../..'); // …/src
const SYNC_SPAWN = /\b(?:spawnSync|execSync|execFileSync)\b/g;

/**
 * file (repo-relative under src/) → { count, reason }.
 * count is the EXACT number of sync-spawn identifier occurrences allowed (imports
 * included), after comment stripping. reason documents the exemption.
 */
const ALLOWLIST: Record<string, { count: number; reason: string }> = {
  'services/mission-loop.ts': {
    count: 2,
    reason:
      'Red-trunk silence sweep (never-again batch fix 3): one execFileSync import + one ' +
      '`git rev-parse HEAD` — a sub-second local-ref read, and the whole pass is throttled ' +
      'to once per MISSION_LOOP_INTERVAL_MS (2.5 min) per project, so it never rides the tick.',
  },
  'services/campaign-reconcile.ts': {
    count: 2,
    reason:
      'Probe verdict provenance: one execFileSync import + one `git rev-parse HEAD` — the ' +
      'same sub-second local-ref read allowlisted for mission-loop.ts. It runs only when a ' +
      'campaign reconcile records a verdict, is wrapped in try/catch returning "unknown", ' +
      'and is injectable via deps.commitSha so tests never spawn at all.',
  },
  'services/campaign-pass.ts': {
    count: 3,
    reason:
      'Probe verdict provenance, same call as campaign-reconcile.ts: `git rev-parse HEAD` to ' +
      'pin the commit a verdict was recorded against. Three occurrences rather than two ' +
      'because the require-style import names the identifier twice. Sub-second local-ref ' +
      'read, wrapped in try/catch returning "unknown", and the pass is throttled per project ' +
      'so it never rides the tick. NOTE: this is the third copy of the same three-line ' +
      'helper (mission-loop.ts, campaign-reconcile.ts, here) — worth extracting to one ' +
      'injectable commitSha() rather than allowlisting a fourth.',
  },
  'services/impacted-tests.ts': {
    count: 2,
    reason:
      'Graph-memo identity probe: one execFileSync import + one call running `git rev-parse ' +
      'HEAD^{tree}` / `git status --porcelain` — sub-second local-object reads, bounded well ' +
      'under 45s, and memoized per tree so a warm plan spawns nothing at all.',
  },
  'services/hotpath-profiler.ts': {
    count: 7,
    reason:
      'WRAPS Bun.spawnSync (capture original + reassign + typeof-guard) to attribute spawn ' +
      'traffic during event-loop wedges; it never initiates a sync spawn itself — every call ' +
      'through the wrapper is a pass-through of an already-allowlisted caller, so the wrapper ' +
      'adds ~zero blocking on top of the wrapped call.',
  },
  'testing/hermetic-tripwire.ts': {
    count: 4,
    reason:
      'Test infrastructure: PATCHES cp.spawnSync/Bun.spawnSync inside the test runner ' +
      'to intercept hermeticity violations. Never loaded by the daemon.',
  },
  'services/leaf-commit-scope.ts': {
    count: 4,
    reason:
      'import + three one-shot `git diff --name-only` reads of a leaf worktree — ' +
      'pure index/tree reads, ~50-300ms worst case.',
  },
  'services/stage-untracked.ts': {
    count: 3,
    reason:
      'import + `git status --porcelain` + chunked `git add --intent-to-add` — ' +
      'index-only ops bounded by untracked-file count, ~100-500ms worst case.',
  },
  'services/worktree-write-leak.ts': {
    count: 6,
    reason:
      'import + git status + three per-path `git checkout HEAD --` restores ' +
      '(tracked-file recovery in quarantineAndRestoreMainCheckout, reclaimPreDirtyScopeOverlap, ' +
      'and residue restore in sweepLeakedWrites) — bounded by the (small) leak count, ' +
      'each ~50ms; runs on leak detection/restore only.',
  },
  'services/epic-land-gate.ts': {
    count: 2,
    reason:
      'import + a shared git helper doing one-shot plumbing (ls-files/rev-parse/' +
      'merge-base/diff) plus ONE detached-worktree add/remove per gate run (~1-3s ' +
      'worst case on this repo). The gate\'s SUITE runs go through the async ' +
      'defaultGateSpawn (418427a5), never this helper.',
  },
  'services/mutation-probe.ts': {
    count: 6,
    reason:
      'import + one-shot git plumbing per probe run: worktree add --detach, ' +
      'worktree remove --force + prune (cleanup), and `diff HEAD --binary` piped ' +
      'into `apply --binary` to carry the dirty tree into the trial worktree — ' +
      '~1-3s worst case on this repo. The probe ARMS (the actual test-suite runs, ' +
      'the only unbounded work here) go through the async Bun.spawn ArmRunner, ' +
      'never this plumbing.',
  },
  'services/system-status.ts': {
    count: 3,
    reason:
      'import + `git rev-parse --short HEAD` + `git status --porcelain` per status ' +
      'call — two one-shot local reads, ~100ms worst case.',
  },
};

/** Strip // line comments and /* *​/ block comments so documentation may still SAY
 *  "spawnSync". Naive (does not parse strings), which is fine for a lint tripwire —
 *  a sync-spawn CALL cannot live inside a string/comment and still execute. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('no sync spawn in daemon-resident src (crit-6, 693bbc27)', () => {
  it('every spawnSync/execSync/execFileSync site is allowlisted with a documented bound', () => {
    const violations: string[] = [];
    const seenCounts = new Map<string, number>();

    for (const file of walk(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file);
      const code = stripComments(readFileSync(file, 'utf8'));
      const count = (code.match(SYNC_SPAWN) ?? []).length;
      if (count === 0) continue;
      seenCounts.set(rel, count);
      const entry = ALLOWLIST[rel];
      if (!entry) {
        violations.push(
          `${rel}: ${count} sync-spawn occurrence(s) and NOT allowlisted — convert to an ` +
            `async spawn (see defaultGateSpawn in leaf-gate.ts) or allowlist with a documented <45s bound.`,
        );
      } else if (count !== entry.count) {
        violations.push(
          `${rel}: expected exactly ${entry.count} sync-spawn occurrence(s), found ${count} — ` +
            `a site was ${count > entry.count ? 'ADDED (convert it to async)' : 'removed (shrink the allowlist)'}. `,
        );
      }
    }

    // Stale allowlist entries (file cleaned up or renamed) must be pruned too.
    for (const rel of Object.keys(ALLOWLIST)) {
      if (!seenCounts.has(rel)) {
        violations.push(`${rel}: allowlisted but has no sync-spawn occurrences — remove the stale entry.`);
      }
    }

    expect(violations).toEqual([]);
  });
});
