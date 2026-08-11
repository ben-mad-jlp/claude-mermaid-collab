import { describe, test, expect, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEpicLandGate } from '../epic-land-gate';
import { landReadiness } from '../land-authority';
import { SPEC_FILE_RE } from '../gate-runner';
import { epicBranchName } from '../epic-branch-status';
import type { LandBlocker } from '../land-authority';

const dirs: string[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'land-e2e-'));
  dirs.push(d);
  return d;
}

function gitCmd(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

afterEach(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
  }
  dirs.length = 0;
});

describe('land-gate E2E: production-only change breaks untouched spec', () => {
  test('production-only change breaking an untouched spec is refused end-to-end', async () => {
    const repo = tmp();

    // Initialize git repo
    gitCmd(repo, ['init', '-b', 'master']);
    gitCmd(repo, ['config', 'user.email', 'test@example.com']);
    gitCmd(repo, ['config', 'user.name', 'Test User']);

    // Create the implementation file: src/lib/calc.js
    mkdirSync(join(repo, 'src', 'lib'), { recursive: true });
    writeFileSync(
      join(repo, 'src', 'lib', 'calc.js'),
      'export function add(a, b) { return a + b; }',
      'utf8'
    );

    // Create the spec file: src/lib/calc.floor.test.ts
    writeFileSync(
      join(repo, 'src', 'lib', 'calc.floor.test.ts'),
      `import { describe, test, expect } from 'bun:test';
import { add } from './calc.js';

describe('calc.floor', () => {
  test('add(2, 3) === 5', () => {
    expect(add(2, 3)).toBe(5);
  });
});
`,
      'utf8'
    );

    // Create .collab/project.json with floor lane
    mkdirSync(join(repo, '.collab'), { recursive: true });
    writeFileSync(
      join(repo, '.collab', 'project.json'),
      JSON.stringify({
        gate: {
          floors: [
            {
              match: '^(src|scripts)/',
              command: 'bun test src/lib/calc.floor.test.ts',
            },
          ],
        },
      }),
      'utf8'
    );

    // Commit to master
    gitCmd(repo, ['add', '-A']);
    gitCmd(repo, ['commit', '-m', 'Initial commit']);
    const masterSha = gitCmd(repo, ['rev-parse', 'HEAD']);

    // Create epic branch and break the implementation
    const epicId = 'e2e-production-break';
    const epicBranch = epicBranchName(epicId);
    gitCmd(repo, ['checkout', '-b', epicBranch]);
    writeFileSync(
      join(repo, 'src', 'lib', 'calc.js'),
      'export function add(a, b) { return a - b; }',
      'utf8'
    );
    gitCmd(repo, ['add', 'src/lib/calc.js']);
    gitCmd(repo, ['commit', '-m', 'Break add: change to subtract']);
    const epicTipSha = gitCmd(repo, ['rev-parse', 'HEAD']);

    // Verify preconditions: check diff
    const diffNames = gitCmd(repo, ['diff', '--name-only', `${masterSha}..${epicTipSha}`])
      .split('\n')
      .filter((s) => s.length > 0);

    // At least one path matches /^src\//
    expect(diffNames.some((p) => /^src\//.test(p))).toBe(true);

    // Zero paths match SPEC_FILE_RE (the spec file itself is not modified)
    expect(diffNames.filter((p) => SPEC_FILE_RE.test(p)).length).toBe(0);

    // Specifically: calc.floor.test.ts is NOT in the diff
    expect(diffNames.includes('src/lib/calc.floor.test.ts')).toBe(false);

    // Call runEpicLandGate with real spawning
    const gateResult = await runEpicLandGate({
      project: repo,
      repo,
      epicId,
      epicBranch,
      epicWorktreeCwd: repo,
      snapshot: { baseSha: masterSha, epicTipSha },
      skipCache: true,
    });

    // The floor should have failed
    expect(gateResult.floor).toBeDefined();
    expect(gateResult.floor!.status).toBe('fail');

    // The broken spec file name should appear in failing or reasons
    const failingFileMatch =
      gateResult.floor!.failing.some((name: string) => name.includes('calc.floor')) ||
      gateResult.reasons.some((reason: string) => reason.includes('calc.floor'));
    expect(failingFileMatch).toBe(true);

    // Overall gate status should be fail
    expect(gateResult.status).toBe('fail');

    // Now test landReadiness
    const readiness = await landReadiness(repo, epicId, {
      probes: {
        worktreeCwd: async () => repo,
        merge: async () => ({ tscClean: true, mergeClean: true }),
        presence: async () => ({
          project: repo,
          epicId,
          epicBranch,
          blocking: false,
          findings: [],
          exemptions: [],
          duplicateCommits: [],
          checked: 0,
        }),
        todos: () => [],
        // gate probe left unset so it re-derives the SAME real gate
      },
      snapshot: { baseSha: masterSha, epicTipSha },
    });

    // Readiness should be green=false with a gate-failed blocker
    expect(readiness.green).toBe(false);
    expect(readiness.blockers.some((b: LandBlocker) => b.code === 'gate-failed')).toBe(true);
  });
});
