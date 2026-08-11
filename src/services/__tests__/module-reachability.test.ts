/**
 * Test module-reachability end-to-end: classify serving epic reachability,
 * identify unreachable modules (added but no non-test importers).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'module-reachability-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import {
  addedSourceFilesForLand,
  hasNonTestImporter,
  classifyServingEpicReachability,
  assertServingEpicModulesReachable,
  isScannableSourcePath,
} from '../module-reachability.js';
import { getTodo, _closeProject } from '../todo-store.js';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store.js';

beforeAll(() => {
  _closeSupervisorDb();
});
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('module-reachability', () => {
  let project: string;

  beforeEach(async () => {
    project = mkdtempSync(join(tmpdir(), 'module-reachability-repo-'));
    execFileSync('git', ['init'], { cwd: project });
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/master'], {
      cwd: project,
    });
    _closeProject(project);
  });

  afterEach(() => {
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  });

  it('reports a landed module with only a test importer as unreachable', async () => {
    // Setup: initial commit on master
    writeFileSync(join(project, 'initial.txt'), 'initial content\n');
    execFileSync('git', ['add', 'initial.txt'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: project });

    // Create src directory
    mkdirSync(join(project, 'src'), { recursive: true });

    // Create scratch branch
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });

    // Add a new module only imported by test
    mkdirSync(join(project, 'src', '__tests__'), { recursive: true });
    writeFileSync(join(project, 'src', 'foo.ts'), 'export function foo() { return 42; }\n');
    writeFileSync(
      join(project, 'src', '__tests__', 'foo.test.ts'),
      "import { foo } from '../foo';\ntest('foo', () => { expect(foo()).toBe(42); });\n",
    );

    execFileSync('git', ['add', 'src/foo.ts', 'src/__tests__/foo.test.ts'], {
      cwd: project,
    });
    execFileSync('git', ['commit', '-m', 'add foo'], { cwd: project });

    // Record the merge sha
    const masterTip = execFileSync('git', ['rev-parse', 'master'], { cwd: project })
      .toString('utf8')
      .trim();
    execFileSync('git', ['checkout', 'master'], { cwd: project });
    execFileSync('git', ['merge', '--no-ff', 'scratch', '-m', 'merge foo'], {
      cwd: project,
    });
    const mergeSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project })
      .toString('utf8')
      .trim();

    // Classify reachability
    const result = await classifyServingEpicReachability({
      repoRoot: project,
      landShas: [mergeSha],
    });

    expect(result.scanned).toContain('src/foo.ts');
    expect(result.unreachable).toContain('src/foo.ts');
  });

  it('a .js ESM specifier importing a .ts file counts as reachable', async () => {
    // Setup: initial commit
    writeFileSync(join(project, 'initial.txt'), 'initial\n');
    execFileSync('git', ['add', 'initial.txt'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: project });

    mkdirSync(join(project, 'src'), { recursive: true });

    // Branch and add modules
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });

    // Production file that imports with .js specifier
    writeFileSync(
      join(project, 'src', 'bar.ts'),
      "import { baz } from './baz.js';\nexport function bar() { return baz(); }\n",
    );

    // Module being imported (as .ts)
    writeFileSync(join(project, 'src', 'baz.ts'), "export function baz() { return 99; }\n");

    execFileSync('git', ['add', 'src/bar.ts', 'src/baz.ts'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'add bar and baz'], { cwd: project });

    // Back to master, merge
    execFileSync('git', ['checkout', 'master'], { cwd: project });
    execFileSync('git', ['merge', '--no-ff', 'scratch', '-m', 'merge'], {
      cwd: project,
    });
    const mergeSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project })
      .toString('utf8')
      .trim();

    const result = await classifyServingEpicReachability({
      repoRoot: project,
      landShas: [mergeSha],
    });

    // baz.ts should NOT be in unreachable (it's imported by bar.ts with .js specifier)
    expect(result.scanned).toContain('src/baz.ts');
    expect(result.unreachable).not.toContain('src/baz.ts');
  });

  it('an export * from re-export counts as reachable', async () => {
    // Setup: initial commit
    writeFileSync(join(project, 'initial.txt'), 'initial\n');
    execFileSync('git', ['add', 'initial.txt'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: project });

    mkdirSync(join(project, 'src'), { recursive: true });

    // Branch
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });

    // Re-export file
    writeFileSync(
      join(project, 'src', 'index.ts'),
      "export * from './impl';\n",
    );

    // Implementation file
    writeFileSync(
      join(project, 'src', 'impl.ts'),
      'export function impl() { return 1; }\n',
    );

    execFileSync('git', ['add', 'src/index.ts', 'src/impl.ts'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'add re-export'], { cwd: project });

    // Back to master, merge
    execFileSync('git', ['checkout', 'master'], { cwd: project });
    execFileSync('git', ['merge', '--no-ff', 'scratch', '-m', 'merge'], {
      cwd: project,
    });
    const mergeSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project })
      .toString('utf8')
      .trim();

    const result = await classifyServingEpicReachability({
      repoRoot: project,
      landShas: [mergeSha],
    });

    // impl.ts should be reachable via export * from
    expect(result.scanned).toContain('src/impl.ts');
    expect(result.unreachable).not.toContain('src/impl.ts');
  });

  it('a bin/ entrypoint with zero importers is not reported', async () => {
    // Setup: initial commit
    writeFileSync(join(project, 'initial.txt'), 'initial\n');
    execFileSync('git', ['add', 'initial.txt'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: project });

    mkdirSync(join(project, 'bin'), { recursive: true });

    // Branch
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });

    // Add a bin tool with no importers
    writeFileSync(
      join(project, 'bin', 'cli.ts'),
      "console.log('hello');\n",
    );

    execFileSync('git', ['add', 'bin/cli.ts'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'add cli'], { cwd: project });

    // Back to master, merge
    execFileSync('git', ['checkout', 'master'], { cwd: project });
    execFileSync('git', ['merge', '--no-ff', 'scratch', '-m', 'merge'], {
      cwd: project,
    });
    const mergeSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project })
      .toString('utf8')
      .trim();

    const result = await classifyServingEpicReachability({
      repoRoot: project,
      landShas: [mergeSha],
    });

    // bin/cli.ts should not be in scanned (filtered by isScannableSourcePath)
    expect(result.scanned).not.toContain('bin/cli.ts');
    expect(result.unreachable).not.toContain('bin/cli.ts');
  });

  it('a mixed land with prod, test, fixture, .d.ts, .json, .md and scripts files scans only the prod module', async () => {
    // Setup: initial commit with an existing prod file on master
    mkdirSync(join(project, 'src'), { recursive: true });
    writeFileSync(join(project, 'src', 'existing.ts'), 'export const x = 1;\n');
    execFileSync('git', ['add', 'src/existing.ts'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: project });

    // Branch and add mixed files
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });

    // Edit existing.ts to import the new prod module
    writeFileSync(
      join(project, 'src', 'existing.ts'),
      "import './prod-module.js';\nexport const x = 1;\n",
    );

    // Add prod module
    writeFileSync(join(project, 'src', 'prod-module.ts'), 'export function prodFn() { return 1; }\n');

    // Add test files
    mkdirSync(join(project, 'src', '__tests__'), { recursive: true });
    writeFileSync(
      join(project, 'src', '__tests__', 'prod-module.test.ts'),
      "import { prodFn } from '../prod-module';\ntest('prod', () => { expect(prodFn()).toBe(1); });\n",
    );
    writeFileSync(join(project, 'src', 'thing.spec.ts'), "test('thing', () => {});\n");

    // Add fixture
    mkdirSync(join(project, 'src', '__fixtures__'), { recursive: true });
    writeFileSync(join(project, 'src', '__fixtures__', 'sample.ts'), 'export const sample = {};\n');

    // Add type definitions
    writeFileSync(join(project, 'src', 'types.d.ts'), 'export interface Thing {}\n');

    // Add data file
    writeFileSync(join(project, 'src', 'data.json'), '{"key": "value"}\n');

    // Add docs and scripts (should be filtered)
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs', 'notes.md'), '# Notes\n');
    mkdirSync(join(project, 'scripts'), { recursive: true });
    writeFileSync(join(project, 'scripts', 'tool.ts'), "console.log('tool');\n");

    // Add all files and commit
    execFileSync(
      'git',
      [
        'add',
        'src/existing.ts',
        'src/prod-module.ts',
        'src/__tests__/prod-module.test.ts',
        'src/thing.spec.ts',
        'src/__fixtures__/sample.ts',
        'src/types.d.ts',
        'src/data.json',
        'docs/notes.md',
        'scripts/tool.ts',
      ],
      { cwd: project },
    );
    execFileSync('git', ['commit', '-m', 'add mixed files'], { cwd: project });

    // Back to master, merge
    execFileSync('git', ['checkout', 'master'], { cwd: project });
    execFileSync('git', ['merge', '--no-ff', 'scratch', '-m', 'merge'], {
      cwd: project,
    });
    const mergeSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project })
      .toString('utf8')
      .trim();

    // Classify reachability
    const result = await classifyServingEpicReachability({
      repoRoot: project,
      landShas: [mergeSha],
    });

    // Only prod-module.ts should be in scanned
    expect(result.unreachable).toHaveLength(0);
    expect(result.scanned).toContain('src/prod-module.ts');
    expect(result.scanned).not.toContain('src/__tests__/prod-module.test.ts');
    expect(result.scanned).not.toContain('src/thing.spec.ts');
    expect(result.scanned).not.toContain('src/__fixtures__/sample.ts');
    expect(result.scanned).not.toContain('src/types.d.ts');
    expect(result.scanned).not.toContain('src/data.json');
    expect(result.scanned).not.toContain('docs/notes.md');
    expect(result.scanned).not.toContain('scripts/tool.ts');
  });

  it('addedSourceFilesForLand and classifyServingEpicReachability agree on scanned files for a mixed land', async () => {
    // Setup: initial commit
    mkdirSync(join(project, 'src'), { recursive: true });
    writeFileSync(join(project, 'src', 'existing.ts'), 'export const x = 1;\n');
    execFileSync('git', ['add', 'src/existing.ts'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: project });

    // Branch
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });

    // Add mixed files (same as above)
    writeFileSync(
      join(project, 'src', 'existing.ts'),
      "import './prod-module.js';\nexport const x = 1;\n",
    );
    writeFileSync(join(project, 'src', 'prod-module.ts'), 'export function prodFn() { return 1; }\n');

    mkdirSync(join(project, 'src', '__tests__'), { recursive: true });
    writeFileSync(
      join(project, 'src', '__tests__', 'prod-module.test.ts'),
      "import { prodFn } from '../prod-module';\ntest('prod', () => {});\n",
    );

    mkdirSync(join(project, 'src', '__fixtures__'), { recursive: true });
    writeFileSync(join(project, 'src', '__fixtures__', 'sample.ts'), 'export const sample = {};\n');

    writeFileSync(join(project, 'src', 'types.d.ts'), 'export interface Thing {}\n');

    execFileSync(
      'git',
      [
        'add',
        'src/existing.ts',
        'src/prod-module.ts',
        'src/__tests__/prod-module.test.ts',
        'src/__fixtures__/sample.ts',
        'src/types.d.ts',
      ],
      { cwd: project },
    );
    execFileSync('git', ['commit', '-m', 'add mixed'], { cwd: project });

    // Back to master, merge
    execFileSync('git', ['checkout', 'master'], { cwd: project });
    execFileSync('git', ['merge', '--no-ff', 'scratch', '-m', 'merge'], {
      cwd: project,
    });
    const mergeSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project })
      .toString('utf8')
      .trim();

    // Compare results from both collectors
    const viaLand = (await addedSourceFilesForLand(project, mergeSha)).sort();
    const viaClassify = (
      await classifyServingEpicReachability({ repoRoot: project, landShas: [mergeSha] })
    ).scanned.sort();

    expect(viaLand).toEqual(viaClassify);
  });

  it('isScannableSourcePath accepts src and ui/src ts/tsx files and rejects test, fixture, d.ts, json, md and non-src paths', async () => {
    // Test cases: path -> expected result
    const cases: Array<[string, boolean]> = [
      // Accepted: src/ and ui/src/ .ts/.tsx files
      ['src/prod-module.ts', true],
      ['src/component.tsx', true],
      ['ui/src/hooks.ts', true],
      ['ui/src/utils.tsx', true],

      // Rejected: test files
      ['src/__tests__/test.ts', false],
      ['src/module.test.ts', false],
      ['src/module.spec.ts', false],

      // Rejected: fixtures
      ['src/__fixtures__/data.ts', false],

      // Rejected: type definitions
      ['src/types.d.ts', false],

      // Rejected: non-.ts/.tsx files
      ['src/data.json', false],
      ['docs/readme.md', false],

      // Rejected: non-src/ paths
      ['scripts/tool.ts', false],
      ['bin/cli.ts', false],
      ['lib/util.ts', false],
    ];

    for (const [path, expected] of cases) {
      expect(isScannableSourcePath(path)).toBe(expected);
    }
  });

  it('a missing or garbage land sha yields indeterminate with no unreachable paths', async () => {
    const result = await classifyServingEpicReachability({
      repoRoot: project,
      landShas: ['0000000000000000000000000000000000000000'],
    });

    expect(result.indeterminate).toBe(true);
    expect(result.unreachable).toHaveLength(0);
  });
});
