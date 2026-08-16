/**
 * Tree-keyed import-graph memo (audit item 10) — impacted-tests.ts.
 *
 * MASTER-FAILS EVIDENCE: on master, `planImpactedFloor` had no memo — every call
 * re-ran walkSources + readFileSync over the whole repo (and collectFloorCandidates
 * re-walked src/ + desktop/src). Two plans on one clean tree therefore performed
 * 2 graph sweeps and 2 candidate walks; the "two plans on one clean tree → ONE
 * filesystem sweep" assertions below fail there at 2 (the `_impactedSweepStats`
 * counter seam lands with the memo — master has neither, so the delta this test
 * pins to 1 was structurally 2 per 2 calls).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  planImpactedFloor,
  computeImpactedTests,
  _impactedSweepStats,
  _resetImpactedGraphMemo,
} from '../impacted-tests';

let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const CANDIDATES = ['src/a.test.ts', 'src/z.test.ts'];

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'impacted-memo-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  const w = (rel: string, content: string) => writeFileSync(join(repo, rel), content);
  w('src/a.ts', `export const a = 1;\n`);
  w('src/z.ts', `export const z = 9;\n`);
  w('src/a.test.ts', `import { it } from 'bun:test';\nimport { a } from './a';\nit('a', () => void a);\n`);
  w('src/z.test.ts', `import { it } from 'bun:test';\nimport { z } from './z';\nit('z', () => void z);\n`);
  git('init', '-q');
  git('config', 'user.email', 'memo@test');
  git('config', 'user.name', 'memo');
  git('add', '-A');
  git('commit', '-qm', 'init');
  _resetImpactedGraphMemo();
});

afterEach(() => {
  _resetImpactedGraphMemo();
  try {
    rmSync(repo, { recursive: true, force: true });
  } catch {}
});

describe('tree-keyed import-graph memo', () => {
  it('two plans on one clean tree → one filesystem sweep, byte-identical plans (parity pin)', () => {
    const before = _impactedSweepStats();
    const cold = planImpactedFloor({ repoRoot: repo, changedFiles: ['src/a.ts'] });
    const warm = planImpactedFloor({ repoRoot: repo, changedFiles: ['src/a.ts'] });
    const after = _impactedSweepStats();
    // On master this delta is 2/2 (see header) — the memo pins it to 1/1.
    expect(after.graphBuilds - before.graphBuilds).toBe(1);
    expect(after.candidateWalks - before.candidateWalks).toBe(1);
    expect(cold.mode).toBe('impacted');
    expect(JSON.stringify(warm)).toBe(JSON.stringify(cold));
  });

  it('different tree (new commit) → rebuild', () => {
    planImpactedFloor({ repoRoot: repo, changedFiles: ['src/a.ts'] });
    const mid = _impactedSweepStats();
    // z.ts now imports a.ts — different tree sha, and a genuinely different graph.
    writeFileSync(join(repo, 'src/z.ts'), `import { a } from './a';\nexport const z = a + 8;\n`);
    git('add', '-A');
    git('commit', '-qm', 'edge z->a');
    const p = planImpactedFloor({ repoRoot: repo, changedFiles: ['src/a.ts'] });
    const after = _impactedSweepStats();
    expect(after.graphBuilds - mid.graphBuilds).toBe(1);
    expect(after.candidateWalks - mid.candidateWalks).toBe(1);
    // The rebuilt graph sees the new edge — z.test.ts is now impacted by a.ts.
    expect(p.mode).toBe('full'); // 2/2 impacted exceeds the 60% cap
    expect(p.trigger).toContain('exceeds 60%');
  });

  it('dirty tree → no reuse and no stale serve', () => {
    // Warm the memo on the clean tree.
    const clean = planImpactedFloor({ repoRoot: repo, changedFiles: ['src/a.ts'] });
    expect(clean.tests).toEqual(['src/a.test.ts']);
    const mid = _impactedSweepStats();
    // UNCOMMITTED edge z->a: porcelain is dirty, so the memo must not serve the
    // stale clean-tree graph — the fresh build must see the new edge.
    appendFileSync(join(repo, 'src/z.ts'), `import './a';\n`);
    const dirty1 = computeImpactedTests({ repoRoot: repo, changedFiles: ['src/a.ts'], candidateTests: CANDIDATES });
    const dirty2 = computeImpactedTests({ repoRoot: repo, changedFiles: ['src/a.ts'], candidateTests: CANDIDATES });
    const after = _impactedSweepStats();
    expect(after.graphBuilds - mid.graphBuilds).toBe(2); // dirty: fresh build EVERY call, nothing cached
    if (!dirty1.ok || !dirty2.ok) throw new Error('expected ok');
    expect(dirty1.tests).toEqual(['src/a.test.ts', 'src/z.test.ts']);
    expect(dirty2.tests).toEqual(dirty1.tests);
  });

  it('git errors fail open: plans still work, nothing is cached', () => {
    const bomb = { gitExec: () => { throw new Error('no git here'); } };
    const before = _impactedSweepStats();
    const p1 = planImpactedFloor({ repoRoot: repo, changedFiles: ['src/a.ts'], deps: bomb });
    const p2 = planImpactedFloor({ repoRoot: repo, changedFiles: ['src/a.ts'], deps: bomb });
    const after = _impactedSweepStats();
    expect(p1.mode).toBe('impacted');
    expect(JSON.stringify(p2)).toBe(JSON.stringify(p1));
    expect(after.graphBuilds - before.graphBuilds).toBe(2);
    expect(after.candidateWalks - before.candidateWalks).toBe(2);
  });

  it('memo keys on the scanned repo root — a second worktree with its own tree gets its own entry', () => {
    // Simulate the epic-worktree case: same content lineage, separate checkout with a
    // DIFFERENT HEAD tree. The memo must key on THAT worktree's tree, not the main repo's.
    planImpactedFloor({ repoRoot: repo, changedFiles: ['src/a.ts'] });
    const wt = join(mkdtempSync(join(tmpdir(), 'impacted-memo-wt-')), 'wt');
    git('worktree', 'add', '-q', '--detach', wt, 'HEAD');
    writeFileSync(join(wt, 'src', 'z.ts'), `import { a } from './a';\nexport const z = a;\n`);
    execFileSync('git', ['add', '-A'], { cwd: wt });
    execFileSync('git', ['commit', '-qm', 'wt-only edge'], { cwd: wt });
    const mid = _impactedSweepStats();
    const wtPlan = planImpactedFloor({ repoRoot: wt, changedFiles: ['src/a.ts'], candidateTests: CANDIDATES });
    const mainPlan = planImpactedFloor({ repoRoot: repo, changedFiles: ['src/a.ts'] });
    const after = _impactedSweepStats();
    expect(after.graphBuilds - mid.graphBuilds).toBe(1); // worktree built fresh; main repo served from memo
    expect(wtPlan.mode).toBe('full'); // worktree's graph has the extra edge → 2/2 impacted
    expect(mainPlan.tests).toEqual(['src/a.test.ts']); // main repo's cached graph unaffected
  });
});
