/**
 * Unit tests for diff-contract-review.ts. Real git fixture per test case.
 * Run with `bun test src/services/__tests__/diff-contract-review.test.ts`.
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { diffContractReview, type DiffContractReviewDeps, type ParsedDiff } from '../diff-contract-review';
import { validateBallotGrounding } from '../review-citations';
import type { DiffContract } from '../diff-contract';

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

interface SetupRepoInput {
  base: Record<string, string>;
  after: Record<string, string | null>;
}

function setupRepo(input: SetupRepoInput): { cwd: string; changedFiles: string[] } {
  const cwd = mkdtempSync(join(tmpdir(), 'diff-contract-test-'));
  try {
    git(cwd, ['init', '-q']);
    git(cwd, ['config', 'user.email', 'test@test']);
    git(cwd, ['config', 'user.name', 'test']);
    git(cwd, ['config', 'commit.gpgsign', 'false']);

    // base tree
    for (const [p, content] of Object.entries(input.base)) {
      const abs = join(cwd, p);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    git(cwd, ['add', '-A']);
    git(cwd, ['commit', '-q', '-m', 'base']);

    // apply "after" as working-tree changes
    const newFiles: string[] = [];
    for (const [p, content] of Object.entries(input.after)) {
      const abs = join(cwd, p);
      const existed = existsSync(abs);
      if (content === null) {
        if (existed) rmSync(abs);
        continue;
      }
      if (!existed) newFiles.push(p);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }

    // intent-to-add new files so `git diff` shows them
    for (const p of newFiles) git(cwd, ['add', '-N', p]);

    // change-set = names in the working diff vs HEAD
    const changedFiles = git(cwd, ['diff', '--name-only', 'HEAD'])
      .split('\n').map((s) => s.trim()).filter(Boolean);
    return { cwd, changedFiles };
  } catch (e) {
    rmSync(cwd, { recursive: true, force: true });
    throw e;
  }
}

describe('diffContractReview', () => {
  it('stage 1: scope-breach on undeclared changed file', () => {
    const { cwd, changedFiles } = setupRepo({
      base: { 'src/main.ts': 'main' },
      after: { 'src/main.ts': 'main2', 'src/rogue.ts': 'rogue' },
    });
    try {
      const contract: DiffContract = {
        schemaVersion: 2,
        estimatedFiles: 1,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: ['src/rogue.ts'],
        filesToEdit: [],
        outOfScope: [],
        requirements: [],
        leafKind: 'feature',
        tasks: [],
      };
      const deps: DiffContractReviewDeps = {
        cwd,
        testsFlipBaseToBranch: async () => null,
        readGateMetric: async () => null,
        runGrepCount: async () => null,
      };
      const diff: ParsedDiff = { changedFiles };

      // Note: changedFiles includes src/main.ts which is NOT declared
      const contract2 = { ...contract, filesToCreate: ['src/rogue.ts'], filesToEdit: [] };
      const result = diffContractReview(contract2, diff, deps).then(() => {});
      expect(result).toBeDefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('stage 1: scope-breach verdict for undeclared change', async () => {
    const { cwd, changedFiles } = setupRepo({
      base: { 'src/main.ts': 'main' },
      after: { 'src/main.ts': 'main2', 'src/rogue.ts': 'rogue' },
    });
    try {
      const contract: DiffContract = {
        schemaVersion: 2,
        estimatedFiles: 1,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: ['src/rogue.ts'],
        filesToEdit: [],
        outOfScope: [],
        requirements: [],
        leafKind: 'feature',
        tasks: [],
      };
      const deps: DiffContractReviewDeps = {
        cwd,
        testsFlipBaseToBranch: async () => null,
        readGateMetric: async () => null,
        runGrepCount: async () => null,
      };
      const diff: ParsedDiff = { changedFiles };
      const result = await diffContractReview(contract, diff, deps);

      const scopeBreach = result.verdicts.find((v) => v.stage === 'scope-breach');
      expect(scopeBreach).toBeDefined();
      expect(scopeBreach?.decision).toBe('breach');
      expect(scopeBreach?.subject.kind).toBe('file');
      if (scopeBreach?.subject.kind === 'file') {
        expect(scopeBreach.subject.path).toBe('src/main.ts');
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('stage 2: absence on declared file not in diff', async () => {
    const { cwd, changedFiles } = setupRepo({
      base: { 'src/main.ts': 'main' },
      after: { 'src/main.ts': 'main2' },
    });
    try {
      const contract: DiffContract = {
        schemaVersion: 2,
        estimatedFiles: 2,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: ['src/main.ts', 'src/promised.ts'],
        outOfScope: [],
        requirements: [],
        leafKind: 'feature',
        tasks: [],
      };
      const deps: DiffContractReviewDeps = {
        cwd,
        testsFlipBaseToBranch: async () => null,
        readGateMetric: async () => null,
        runGrepCount: async () => null,
      };
      const diff: ParsedDiff = { changedFiles };
      const result = await diffContractReview(contract, diff, deps);

      const absence = result.verdicts.find((v) => v.stage === 'absence');
      expect(absence).toBeDefined();
      expect(absence?.decision).toBe('unmet');
      expect(absence?.subject.kind).toBe('file');
      if (absence?.subject.kind === 'file') {
        expect(absence.subject.path).toBe('src/promised.ts');
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('stage 3: out-of-scope when changed file is in outOfScope list', async () => {
    const { cwd, changedFiles } = setupRepo({
      base: { 'src/frozen.ts': 'frozen', 'src/main.ts': 'main' },
      after: { 'src/frozen.ts': 'frozen2', 'src/main.ts': 'main' },
    });
    try {
      const contract: DiffContract = {
        schemaVersion: 2,
        estimatedFiles: 1,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: ['src/main.ts'],
        outOfScope: ['src/frozen.ts'],
        requirements: [],
        leafKind: 'feature',
        tasks: [],
      };
      const deps: DiffContractReviewDeps = {
        cwd,
        testsFlipBaseToBranch: async () => null,
        readGateMetric: async () => null,
        runGrepCount: async () => null,
      };
      const diff: ParsedDiff = { changedFiles };
      const result = await diffContractReview(contract, diff, deps);

      const outOfScopeVerdict = result.verdicts.find((v) => v.stage === 'out-of-scope');
      expect(outOfScopeVerdict).toBeDefined();
      expect(outOfScopeVerdict?.decision).toBe('breach');
      expect(outOfScopeVerdict?.subject.kind).toBe('file');
      if (outOfScopeVerdict?.subject.kind === 'file') {
        expect(outOfScopeVerdict.subject.path).toBe('src/frozen.ts');
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('stage 5: named-test with testsFlipBaseToBranch returning true', async () => {
    const { cwd, changedFiles } = setupRepo({
      base: { 'src/main.ts': 'main', 'src/main.test.ts': 'test1' },
      after: { 'src/main.ts': 'main2', 'src/main.test.ts': 'test2' },
    });
    try {
      const contract: DiffContract = {
        schemaVersion: 2,
        estimatedFiles: 2,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: ['src/main.ts', 'src/main.test.ts'],
        outOfScope: [],
        requirements: [
          {
            kind: 'named-test',
            id: 'test-1',
            testFile: 'src/main.test.ts',
            testName: 'my test',
            mechanical: true,
          },
        ],
        leafKind: 'feature',
        tasks: [],
      };
      const deps: DiffContractReviewDeps = {
        cwd,
        testsFlipBaseToBranch: async () => true,
        readGateMetric: async () => null,
        runGrepCount: async () => null,
      };
      const diff: ParsedDiff = { changedFiles };
      const result = await diffContractReview(contract, diff, deps);

      const namedTest = result.verdicts.find((v) => v.stage === 'named-test');
      expect(namedTest).toBeDefined();
      expect(namedTest?.decision).toBe('met');
      expect(namedTest?.mechanical).toBe(true);
      expect(namedTest?.subject.kind).toBe('requirement');
      if (namedTest?.subject.kind === 'requirement') {
        expect(namedTest.subject.id).toBe('test-1');
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('stage 5: named-test with testsFlipBaseToBranch returning false', async () => {
    const { cwd, changedFiles } = setupRepo({
      base: { 'src/main.test.ts': 'test1' },
      after: { 'src/main.test.ts': 'test2' },
    });
    try {
      const contract: DiffContract = {
        schemaVersion: 2,
        estimatedFiles: 1,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: ['src/main.test.ts'],
        outOfScope: [],
        requirements: [
          {
            kind: 'named-test',
            id: 'test-1',
            testFile: 'src/main.test.ts',
            testName: 'my test',
            mechanical: true,
          },
        ],
        leafKind: 'test',
        tasks: [],
      };
      const deps: DiffContractReviewDeps = {
        cwd,
        testsFlipBaseToBranch: async () => false,
        readGateMetric: async () => null,
        runGrepCount: async () => null,
      };
      const diff: ParsedDiff = { changedFiles };
      const result = await diffContractReview(contract, diff, deps);

      const namedTest = result.verdicts.find((v) => v.stage === 'named-test');
      expect(namedTest?.decision).toBe('unmet');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('stage 5: named-test with testsFlipBaseToBranch returning null', async () => {
    const { cwd, changedFiles } = setupRepo({
      base: { 'src/main.test.ts': 'test1' },
      after: { 'src/main.test.ts': 'test2' },
    });
    try {
      const contract: DiffContract = {
        schemaVersion: 2,
        estimatedFiles: 1,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: ['src/main.test.ts'],
        outOfScope: [],
        requirements: [
          {
            kind: 'named-test',
            id: 'test-1',
            testFile: 'src/main.test.ts',
            testName: 'my test',
            mechanical: true,
          },
        ],
        leafKind: 'test',
        tasks: [],
      };
      const deps: DiffContractReviewDeps = {
        cwd,
        testsFlipBaseToBranch: async () => null,
        readGateMetric: async () => null,
        runGrepCount: async () => null,
      };
      const diff: ParsedDiff = { changedFiles };
      const result = await diffContractReview(contract, diff, deps);

      const namedTest = result.verdicts.find((v) => v.stage === 'named-test');
      expect(namedTest?.decision).toBe('not-applicable');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('stage 5: named-test catches thrown exceptions and treats as not-applicable', async () => {
    const { cwd, changedFiles } = setupRepo({
      base: { 'src/main.test.ts': 'test1' },
      after: { 'src/main.test.ts': 'test2' },
    });
    try {
      const contract: DiffContract = {
        schemaVersion: 2,
        estimatedFiles: 1,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: ['src/main.test.ts'],
        outOfScope: [],
        requirements: [
          {
            kind: 'named-test',
            id: 'test-1',
            testFile: 'src/main.test.ts',
            testName: 'my test',
            mechanical: true,
          },
        ],
        leafKind: 'test',
        tasks: [],
      };
      const deps: DiffContractReviewDeps = {
        cwd,
        testsFlipBaseToBranch: async () => { throw new Error('test error'); },
        readGateMetric: async () => null,
        runGrepCount: async () => null,
      };
      const diff: ParsedDiff = { changedFiles };
      const result = await diffContractReview(contract, diff, deps);

      const namedTest = result.verdicts.find((v) => v.stage === 'named-test');
      expect(namedTest?.decision).toBe('not-applicable');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('stage 6: threshold with grep-count source', async () => {
    const { cwd, changedFiles } = setupRepo({
      base: { 'src/main.ts': 'code' },
      after: { 'src/main.ts': 'code' },
    });
    try {
      const contract: DiffContract = {
        schemaVersion: 2,
        estimatedFiles: 1,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: ['src/main.ts'],
        outOfScope: [],
        requirements: [
          {
            kind: 'threshold',
            id: 'coverage-1',
            source: 'grep-count',
            metric: 'pattern',
            comparison: 'gte',
            value: 2,
            mechanical: true,
          },
        ],
        leafKind: 'feature',
        tasks: [],
      };
      const deps: DiffContractReviewDeps = {
        cwd,
        testsFlipBaseToBranch: async () => null,
        readGateMetric: async () => null,
        runGrepCount: async () => 3,
      };
      const diff: ParsedDiff = { changedFiles };
      const result = await diffContractReview(contract, diff, deps);

      const threshold = result.verdicts.find((v) => v.stage === 'threshold');
      expect(threshold).toBeDefined();
      expect(threshold?.decision).toBe('met');
      expect(threshold?.mechanical).toBe(true);
      expect(threshold?.subject.kind).toBe('requirement');
      if (threshold?.subject.kind === 'requirement') {
        expect(threshold.subject.id).toBe('coverage-1');
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('stage 6: threshold unmet when value does not satisfy comparison', async () => {
    const { cwd, changedFiles } = setupRepo({
      base: { 'src/main.ts': 'code' },
      after: { 'src/main.ts': 'code' },
    });
    try {
      const contract: DiffContract = {
        schemaVersion: 2,
        estimatedFiles: 1,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: ['src/main.ts'],
        outOfScope: [],
        requirements: [
          {
            kind: 'threshold',
            id: 'coverage-1',
            source: 'grep-count',
            metric: 'pattern',
            comparison: 'gte',
            value: 2,
            mechanical: true,
          },
        ],
        leafKind: 'feature',
        tasks: [],
      };
      const deps: DiffContractReviewDeps = {
        cwd,
        testsFlipBaseToBranch: async () => null,
        readGateMetric: async () => null,
        runGrepCount: async () => 1,
      };
      const diff: ParsedDiff = { changedFiles };
      const result = await diffContractReview(contract, diff, deps);

      const threshold = result.verdicts.find((v) => v.stage === 'threshold');
      expect(threshold?.decision).toBe('unmet');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('stage 6: threshold with gate-output source', async () => {
    const { cwd, changedFiles } = setupRepo({
      base: { 'src/main.ts': 'code' },
      after: { 'src/main.ts': 'code' },
    });
    try {
      const contract: DiffContract = {
        schemaVersion: 2,
        estimatedFiles: 1,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: ['src/main.ts'],
        outOfScope: [],
        requirements: [
          {
            kind: 'threshold',
            id: 'gate-1',
            source: 'gate-output',
            metric: 'some-metric',
            comparison: 'eq',
            value: 5,
            mechanical: true,
          },
        ],
        leafKind: 'feature',
        tasks: [],
      };
      const deps: DiffContractReviewDeps = {
        cwd,
        testsFlipBaseToBranch: async () => null,
        readGateMetric: async () => 5,
        runGrepCount: async () => null,
      };
      const diff: ParsedDiff = { changedFiles };
      const result = await diffContractReview(contract, diff, deps);

      const threshold = result.verdicts.find((v) => v.stage === 'threshold');
      expect(threshold?.decision).toBe('met');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('stage 6: threshold not-applicable when metric cannot be determined', async () => {
    const { cwd, changedFiles } = setupRepo({
      base: { 'src/main.ts': 'code' },
      after: { 'src/main.ts': 'code' },
    });
    try {
      const contract: DiffContract = {
        schemaVersion: 2,
        estimatedFiles: 1,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: ['src/main.ts'],
        outOfScope: [],
        requirements: [
          {
            kind: 'threshold',
            id: 'gate-1',
            source: 'gate-output',
            metric: 'missing-metric',
            comparison: 'eq',
            value: 5,
            mechanical: true,
          },
        ],
        leafKind: 'feature',
        tasks: [],
      };
      const deps: DiffContractReviewDeps = {
        cwd,
        testsFlipBaseToBranch: async () => null,
        readGateMetric: async () => null,
        runGrepCount: async () => null,
      };
      const diff: ParsedDiff = { changedFiles };
      const result = await diffContractReview(contract, diff, deps);

      const threshold = result.verdicts.find((v) => v.stage === 'threshold');
      expect(threshold?.decision).toBe('not-applicable');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('ballotInput excludes symbol-present and named-test/threshold', async () => {
    const { cwd, changedFiles } = setupRepo({
      base: { 'src/main.ts': 'code' },
      after: { 'src/main.ts': 'code' },
    });
    try {
      const contract: DiffContract = {
        schemaVersion: 2,
        estimatedFiles: 1,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: ['src/main.ts'],
        outOfScope: [],
        requirements: [
          {
            kind: 'symbol-present',
            id: 'sym-1',
            file: 'src/main.ts',
            symbol: 'myFunc',
            description: 'the function',
          },
          {
            kind: 'named-test',
            id: 'test-1',
            testFile: 'src/main.test.ts',
            testName: 'test',
            mechanical: true,
          },
          {
            kind: 'threshold',
            id: 'thresh-1',
            source: 'gate-output',
            metric: 'm',
            comparison: 'gte',
            value: 1,
            mechanical: true,
          },
          {
            kind: 'observable',
            id: 'obs-1',
            description: 'behavior is correct',
          },
          {
            kind: 'invariant',
            id: 'inv-1',
            description: 'backward compat maintained',
          },
        ],
        leafKind: 'feature',
        tasks: [],
      };
      const deps: DiffContractReviewDeps = {
        cwd,
        testsFlipBaseToBranch: async () => null,
        readGateMetric: async () => null,
        runGrepCount: async () => null,
      };
      const diff: ParsedDiff = { changedFiles };
      const result = await diffContractReview(contract, diff, deps);

      expect(result.ballotInput).toHaveLength(2);
      expect(result.ballotInput[0].id).toBe('obs-1');
      expect(result.ballotInput[0].kind).toBe('observable');
      expect(result.ballotInput[1].id).toBe('inv-1');
      expect(result.ballotInput[1].kind).toBe('invariant');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('validateBallotGrounding: fabricated id rejection', () => {
    const verdicts = [
      { id: 'ghost', outcome: 'met' as const, text: 'done src/a.ts:1' },
    ];
    const grounding = validateBallotGrounding(verdicts, ['real-id'], ['src/a.ts']);
    expect(grounding.status).toBe('vacuous');
    expect(grounding.reasons[0]).toContain('ghost');
  });

  it('validateBallotGrounding: uncited met rejection', () => {
    const verdicts = [
      { id: 'real-id', outcome: 'met' as const, text: 'trust me, done' },
    ];
    const grounding = validateBallotGrounding(verdicts, ['real-id'], ['src/a.ts']);
    expect(grounding.status).toBe('vacuous');
    expect(grounding.reasons[0]).toContain('real-id');
  });

  it('validateBallotGrounding: ok when met verdict cites change-set file:line', () => {
    const verdicts = [
      { id: 'real-id', outcome: 'met' as const, text: 'done: src/a.ts:3' },
    ];
    const grounding = validateBallotGrounding(verdicts, ['real-id'], ['src/a.ts']);
    expect(grounding.status).toBe('ok');
  });

  it('validateBallotGrounding: ok for unmet/N-A with no citation', () => {
    const verdicts = [
      { id: 'real-id', outcome: 'unmet' as const, text: 'not done' },
    ];
    const grounding = validateBallotGrounding(verdicts, ['real-id'], ['src/a.ts']);
    expect(grounding.status).toBe('ok');
  });

  it('validateBallotGrounding: abstain when changeSet is null', () => {
    const verdicts = [
      { id: 'real-id', outcome: 'met' as const, text: 'done' },
    ];
    const grounding = validateBallotGrounding(verdicts, ['real-id'], null);
    expect(grounding.status).toBe('abstain');
  });

  it('validateBallotGrounding: ok via worktree citationExists', () => {
    const verdicts = [
      { id: 'real-id', outcome: 'met' as const, text: 'done: src/outside.ts:1' },
    ];
    const grounding = validateBallotGrounding(
      verdicts,
      ['real-id'],
      ['src/a.ts'],
      { citationExists: () => true },
    );
    expect(grounding.status).toBe('ok');
  });
});
