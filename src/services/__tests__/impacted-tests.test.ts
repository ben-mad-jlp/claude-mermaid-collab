import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeImpactedTests, planImpactedFloor } from '../impacted-tests';

/** Fixture repo:
 *    a.ts ← b.ts ← barrel.ts (export *) ← c.ts
 *    a.ts ← dyn.ts (await import)
 *    direct.test.ts → a.ts
 *    trans.test.ts  → c.ts   (transitive chain through the barrel)
 *    dyn.test.ts    → dyn.ts
 *    self.test.ts   → bare packages only
 *    other.test.ts  → z.ts   (disjoint island)
 *    orphan.ts      → imported by nothing
 */
const CANDIDATES = [
  'src/direct.test.ts',
  'src/trans.test.ts',
  'src/dyn.test.ts',
  'src/self.test.ts',
  'src/other.test.ts',
];

let repo: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'impacted-tests-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  const w = (rel: string, content: string) => writeFileSync(join(repo, rel), content);
  w('src/a.ts', `export const a = 1;\n`);
  w('src/b.ts', `import { a } from './a';\nexport const b = a;\n`);
  w('src/barrel.ts', `export * from './b';\n`);
  w('src/c.ts', `import { b } from './barrel';\nexport const c = b;\n`);
  w('src/dyn.ts', `export async function d() {\n  const m = await import('./a');\n  return m.a;\n}\n`);
  w('src/z.ts', `export const z = 9;\n`);
  w('src/orphan.ts', `export const orphan = 0;\n`);
  w('src/direct.test.ts', `import { it } from 'bun:test';\nimport { a } from './a';\nit('a', () => void a);\n`);
  w('src/trans.test.ts', `import { it } from 'bun:test';\nimport { c } from './c';\nit('c', () => void c);\n`);
  w('src/dyn.test.ts', `import { it } from 'bun:test';\nimport { d } from './dyn';\nit('d', () => void d);\n`);
  w('src/self.test.ts', `import { it } from 'bun:test';\nimport fs from 'node:fs';\nit('s', () => void fs);\n`);
  w('src/other.test.ts', `import { it } from 'bun:test';\nimport { z } from './z';\nit('z', () => void z);\n`);
});

afterAll(() => {
  try {
    rmSync(repo, { recursive: true, force: true });
  } catch {}
});

describe('computeImpactedTests', () => {
  it('selects direct, transitive (barrel), and dynamic importers of a changed file', () => {
    const r = computeImpactedTests({ repoRoot: repo, changedFiles: ['src/a.ts'], candidateTests: CANDIDATES });
    if (!r.ok) throw new Error(r.reason);
    expect(r.tests).toEqual(['src/direct.test.ts', 'src/dyn.test.ts', 'src/trans.test.ts']);
    expect(r.unresolvedChanged).toEqual([]);
  });

  it('a changed test file selects itself; bare-package imports never resolve', () => {
    const r = computeImpactedTests({ repoRoot: repo, changedFiles: ['src/self.test.ts'], candidateTests: CANDIDATES });
    if (!r.ok) throw new Error(r.reason);
    expect(r.tests).toEqual(['src/self.test.ts']);
  });

  it('reports a changed .ts file that is not in the graph as unresolved', () => {
    const r = computeImpactedTests({ repoRoot: repo, changedFiles: ['src/ghost.ts'], candidateTests: CANDIDATES });
    if (!r.ok) throw new Error(r.reason);
    expect(r.unresolvedChanged).toEqual(['src/ghost.ts']);
  });

  it('returns ok:false when the source walk fails', () => {
    const r = computeImpactedTests({
      repoRoot: join(repo, 'does-not-exist'),
      changedFiles: ['src/a.ts'],
      candidateTests: CANDIDATES,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('source walk failed');
  });
});

describe('planImpactedFloor fallback triggers', () => {
  it('runs impacted when no trigger fires', () => {
    const p = planImpactedFloor({ repoRoot: repo, changedFiles: ['src/a.ts'], candidateTests: CANDIDATES });
    expect(p.mode).toBe('impacted');
    expect(p.tests).toEqual(['src/direct.test.ts', 'src/dyn.test.ts', 'src/trans.test.ts']);
    expect(p.candidateCount).toBe(5);
    expect(p.trigger).toBeNull();
  });

  it('infra path changed → full', () => {
    for (const infra of ['package.json', 'scripts/test-backend.ts', 'tsconfig.json', '.collab/project.json']) {
      const p = planImpactedFloor({ repoRoot: repo, changedFiles: [infra], candidateTests: CANDIDATES });
      expect(p.mode).toBe('full');
      expect(p.trigger).toContain('infra path changed');
    }
  });

  it('unresolvable changed file → full', () => {
    const p = planImpactedFloor({ repoRoot: repo, changedFiles: ['src/ghost.ts'], candidateTests: CANDIDATES });
    expect(p.mode).toBe('full');
    expect(p.trigger).toContain('not resolvable');
  });

  it('empty impacted set on a non-test .ts change → full', () => {
    const p = planImpactedFloor({ repoRoot: repo, changedFiles: ['src/orphan.ts'], candidateTests: CANDIDATES });
    expect(p.mode).toBe('full');
    expect(p.trigger).toContain('empty impacted set');
  });

  it('impacted set exceeding 60% of candidates → full', () => {
    // 3 impacted of 4 candidates = 75%
    const four = CANDIDATES.filter((c) => c !== 'src/other.test.ts');
    const p = planImpactedFloor({ repoRoot: repo, changedFiles: ['src/a.ts'], candidateTests: four });
    expect(p.mode).toBe('full');
    expect(p.trigger).toContain('exceeds 60%');
  });

  it('computeImpactedTests ok:false propagates as a full-suite trigger', () => {
    const p = planImpactedFloor({
      repoRoot: join(repo, 'does-not-exist'),
      changedFiles: ['src/a.ts'],
      candidateTests: CANDIDATES,
    });
    expect(p.mode).toBe('full');
    expect(p.trigger).toContain('source walk failed');
  });
});
