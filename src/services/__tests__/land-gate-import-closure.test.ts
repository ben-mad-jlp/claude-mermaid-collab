import { describe, it, afterAll, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  planImpactedFloor,
  computeImpactedTests,
  BACKEND_CANDIDATE_ROOT_RE,
  touchesBackendSurface,
} from '../impacted-tests';

describe('land-gate-import-closure', () => {
  const tempDirs: string[] = [];

  afterAll(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true });
      } catch {
        /* cleanup is best-effort */
      }
    }
  });

  it("a ui-only diff selects zero backend test files", () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'impacted-tests-ui-only-'));
    tempDirs.push(repoRoot);

    // Set up a minimal fixture repo: src/a.ts, src/a.test.ts (imports ./a), ui/src/widget.tsx
    mkdirSync(resolve(repoRoot, 'src'), { recursive: true });
    mkdirSync(resolve(repoRoot, 'ui', 'src'), { recursive: true });
    writeFileSync(resolve(repoRoot, 'src', 'a.ts'), "export const a = 42;");
    writeFileSync(
      resolve(repoRoot, 'src', 'a.test.ts'),
      "import { test } from 'bun:test';\nimport { a } from './a';\ntest('a', () => {});"
    );
    writeFileSync(
      resolve(repoRoot, 'ui', 'src', 'widget.tsx'),
      "export const Widget = () => null;"
    );

    const plan = planImpactedFloor({
      repoRoot,
      changedFiles: ['ui/src/widget.tsx'],
      candidateTests: ['src/a.test.ts'],
    });

    expect(plan.mode).toBe('impacted');
    expect(plan.tests).toEqual([]);
    expect(plan.trigger).toBeNull();
  });

  it('a diff touching campaign-pass.ts selects campaign-end-to-end.test.ts through the transitive chain', () => {
    const repoRoot = resolve(import.meta.dir, '../../..');

    const result = computeImpactedTests(
      {
        repoRoot,
        changedFiles: ['src/services/campaign-pass.ts'],
        candidateTests: ['src/services/__tests__/campaign-end-to-end.test.ts'],
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tests).toContain('src/services/__tests__/campaign-end-to-end.test.ts');
    }
  });

  it('a closure computation error selects the full-surface set', () => {
    const nonexistentRoot = resolve(tmpdir(), 'nonexistent-impacted-repo-' + Date.now());

    const plan = planImpactedFloor({
      repoRoot: nonexistentRoot,
      changedFiles: ['src/app.ts'],
      candidateTests: ['src/app.test.ts'],
    });

    expect(plan.mode).toBe('full');
    expect(plan.trigger).not.toBeNull();
  });

  it('BACKEND_CANDIDATE_ROOT_RE matches only backend roots', () => {
    expect(BACKEND_CANDIDATE_ROOT_RE.test('src/app.ts')).toBe(true);
    expect(BACKEND_CANDIDATE_ROOT_RE.test('scripts/build.ts')).toBe(true);
    expect(BACKEND_CANDIDATE_ROOT_RE.test('desktop/src/main.ts')).toBe(true);
    expect(BACKEND_CANDIDATE_ROOT_RE.test('ui/src/app.tsx')).toBe(false);
    expect(BACKEND_CANDIDATE_ROOT_RE.test('.collab/config.ts')).toBe(false);
  });

  it('touchesBackendSurface returns true iff any changed path is under a backend root', () => {
    expect(touchesBackendSurface(['src/app.ts'])).toBe(true);
    expect(touchesBackendSurface(['ui/src/widget.tsx'])).toBe(false);
    expect(touchesBackendSurface(['ui/src/widget.tsx', 'src/app.ts'])).toBe(true);
    expect(touchesBackendSurface(['ui/src/widget.tsx', 'ui/src/button.tsx'])).toBe(false);
    expect(touchesBackendSurface([])).toBe(false);
  });
});
