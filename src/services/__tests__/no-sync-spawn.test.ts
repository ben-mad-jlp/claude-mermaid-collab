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
  'testing/hermetic-tripwire.ts': {
    count: 4,
    reason:
      'Test infrastructure: PATCHES cp.spawnSync/Bun.spawnSync inside the test runner ' +
      'to intercept hermeticity violations. Never loaded by the daemon.',
  },
  'services/epic-branch-status.ts': {
    count: 1,
    reason:
      'Daemon-resident git probe, bounded by design (28737b71 prefilter): probes run ' +
      'only for todos whose collab/epic/<id8> branch actually exists — ≤~25 spawns × ' +
      '~50ms of one-shot git plumbing, plus a 15s hard timeout per call. A parallel ' +
      'criterion owns this file’s probe machinery; do not convert it here.',
  },
  'services/tree-integrity.ts': {
    count: 2,
    reason:
      'Deliberately sync (see its header): shared by landEpic (async) AND ' +
      'requestSelfDeploy’s synchronous context. Each call is one-shot git plumbing ' +
      '(rev-parse/write-tree/diff/symbolic-ref/checkout) on a local repo — worst case ' +
      '~1-2s on this repo, far under 45s, and runs only around land/deploy events.',
  },
  'services/landed-epic-sweep.ts': {
    count: 1,
    reason:
      'Branch-GC one-shot git refs ops (rev-parse/branch -D/for-each-ref/rev-list), ' +
      'count bounded by the local collab/epic/* branch count (~tens), each ~50ms, on a ' +
      'periodic sweep. Worst case well under 45s.',
  },
  'services/project-digest.ts': {
    count: 1,
    reason:
      'A handful of one-shot git reads (ls-files/log) with a 15s hard timeout each, ' +
      'only when the digest regenerates (post-land). Typical <200ms; hard-capped 15s.',
  },
  'services/fleet-status.ts': {
    count: 2,
    reason:
      'One `ps -axo` + one `sysctl -n` per fleet-status call — ~30ms of kernel ' +
      'bookkeeping, no repo or network involvement.',
  },
  'services/leaf-executor.ts': {
    count: 2,
    reason:
      'import + citationLineExistsAtBase: one-shot `git show <sha>:<path>` of a single ' +
      'file (8MB buffer cap), memoized per path per run behind a sync deps interface. ' +
      '~50ms worst case. The suite-running sites in this file were converted to async.',
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
    count: 5,
    reason:
      'import + git status + per-leaked-path `git checkout HEAD --` restores — ' +
      'bounded by the (small) leak count, each ~50ms; runs on leak detection only.',
  },
  'services/epic-land-gate.ts': {
    count: 2,
    reason:
      'import + a shared git helper doing one-shot plumbing (ls-files/rev-parse/' +
      'merge-base/diff) plus ONE detached-worktree add/remove per gate run (~1-3s ' +
      'worst case on this repo). The gate’s SUITE runs go through the async ' +
      'defaultGateSpawn (418427a5), never this helper.',
  },
  'services/system-status.ts': {
    count: 3,
    reason:
      'import + `git rev-parse --short HEAD` + `git status --porcelain` per status ' +
      'call — two one-shot local reads, ~100ms worst case.',
  },
  'routes/supervisor-routes.ts': {
    count: 2,
    reason:
      'import + one `git status --porcelain --untracked-files=no` per request — a ' +
      'single one-shot index read, ~100ms worst case.',
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
