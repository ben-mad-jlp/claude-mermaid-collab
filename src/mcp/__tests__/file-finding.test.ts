/**
 * @nested-test-runner: drives handleWorkgraphTool against a project.json with gate command `bun test {file}`
 */
// Tests for file_finding verb: zero-row refusal gate, typed round-trip, explore allowlist.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { handleWorkgraphTool } from '../workgraph-tools';
import { getTodo, listTodos, _closeProject } from '../../services/todo-store';
import { _closeProject as _closeFindingProject, listFindings, getFindingByTodoId } from '../../services/finding-store';
import { EXPLORE_NODE_ALLOWED_TOOLS } from '../../services/leaf-executor';

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'file-finding-'));
  // Initialize a git repo for quarantine-runner to use
  execSync('git init', { cwd: project });
  execSync('git config user.email "test@example.com"', { cwd: project });
  execSync('git config user.name "Test User"', { cwd: project });

  // Create a minimal project.json with a gate config that includes a bun test lane
  // This allows quarantine-runner to find and execute quarantine spec files
  mkdirSync(join(project, '.collab'), { recursive: true });
  writeFileSync(
    join(project, '.collab', 'project.json'),
    JSON.stringify({
      version: 1,
      gate: {
        tests: [
          {
            match: '__quarantine__/.+\\.spec\\.ts$',
            command: 'bun test {file}',
          },
        ],
      },
    }),
    'utf-8'
  );
});
afterEach(() => {
  _closeProject(project);
  _closeFindingProject(project);
  rmSync(project, { recursive: true, force: true });
});

const S = 's1';

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const out = await handleWorkgraphTool(name, { project, session: S, ...args });
  expect(out).not.toBeNull();
  return JSON.parse(out!);
}

describe('file_finding', () => {
  test('refuses with zero rows when repro is missing', async () => {
    const todosBefore = listTodos(project, { includeCompleted: true }).length;
    const findingsBefore = await listFindings(project).then((f) => f.length);

    await expect(
      call('file_finding', {
        violatedClaim: 'Test claim',
        repro: '',
      }),
    ).rejects.toThrow(/repro is required/);

    const todosAfter = listTodos(project, { includeCompleted: true }).length;
    const findingsAfter = await listFindings(project).then((f) => f.length);

    expect(todosAfter).toBe(todosBefore);
    expect(findingsAfter).toBe(findingsBefore);
  });

  test('refuses with zero rows when repro path is not committed', async () => {
    const specPath = '__quarantine__/test.spec.ts';
    mkdirSync(join(project, '__quarantine__'), { recursive: true });
    const specFullPath = join(project, specPath);
    writeFileSync(specFullPath, 'describe("test", () => { it("fails", () => { throw new Error("fail"); }); });', 'utf-8');

    const todosBefore = listTodos(project, { includeCompleted: true }).length;
    const findingsBefore = await listFindings(project).then((f) => f.length);

    await expect(
      call('file_finding', {
        violatedClaim: 'Test claim',
        repro: specPath,
      }),
    ).rejects.toThrow(/not committed to HEAD/);

    const todosAfter = listTodos(project, { includeCompleted: true }).length;
    const findingsAfter = await listFindings(project).then((f) => f.length);

    expect(todosAfter).toBe(todosBefore);
    expect(findingsAfter).toBe(findingsBefore);
  });

  test('refuses with zero rows when repro has no __quarantine__ segment', async () => {
    const specPath = 'test.spec.ts';
    const specFullPath = join(project, specPath);
    writeFileSync(specFullPath, 'describe("test", () => { it("fails", () => { throw new Error("fail"); }); });', 'utf-8');

    execSync(`git add '${specPath}'`, { cwd: project });
    execSync('git commit -m "Add test"', { cwd: project });

    const todosBefore = listTodos(project, { includeCompleted: true }).length;
    const findingsBefore = await listFindings(project).then((f) => f.length);

    await expect(
      call('file_finding', {
        violatedClaim: 'Test claim',
        repro: specPath,
      }),
    ).rejects.toThrow(/no __quarantine__ segment/);

    const todosAfter = listTodos(project, { includeCompleted: true }).length;
    const findingsAfter = await listFindings(project).then((f) => f.length);

    expect(todosAfter).toBe(todosBefore);
    expect(findingsAfter).toBe(findingsBefore);
  });

  test('refuses with zero rows when repro runs green', async () => {
    const specPath = '__quarantine__/passing.spec.ts';
    mkdirSync(join(project, '__quarantine__'), { recursive: true });
    const specFullPath = join(project, specPath);
    // Note: The test passes because exit code is 0 (bun test returns 0 for passing tests)
    writeFileSync(
      specFullPath,
      `import { describe, test, expect } from 'bun:test';
describe('test', () => {
  test('passes', () => {
    expect(true).toBe(true);
  });
});`,
      'utf-8'
    );

    execSync(`git add '${specPath}'`, { cwd: project });
    execSync('git commit -m "Add passing quarantine spec"', { cwd: project });

    const todosBefore = listTodos(project, { includeCompleted: true }).length;
    const findingsBefore = await listFindings(project).then((f) => f.length);

    await expect(
      call('file_finding', {
        violatedClaim: 'Test claim',
        repro: specPath,
      }),
    ).rejects.toThrow(/runs GREEN/);

    const todosAfter = listTodos(project, { includeCompleted: true }).length;
    const findingsAfter = await listFindings(project).then((f) => f.length);

    expect(todosAfter).toBe(todosBefore);
    expect(findingsAfter).toBe(findingsBefore);
  });

  test('files the leaf and round-trips violatedClaim, implicatedFiles, ruledOut on red', async () => {
    const specPath = '__quarantine__/failing.spec.ts';
    mkdirSync(join(project, '__quarantine__'), { recursive: true });
    const specFullPath = join(project, specPath);
    writeFileSync(
      specFullPath,
      `import { describe, test, expect } from 'bun:test';
describe('test', () => {
  test('fails', () => {
    throw new Error('test failure');
  });
});`,
      'utf-8'
    );

    execSync(`git add '${specPath}'`, { cwd: project });
    execSync('git commit -m "Add failing quarantine spec"', { cwd: project });

    const todosBefore = listTodos(project, { includeCompleted: true }).length;
    const findingsBefore = await listFindings(project).then((f) => f.length);

    const claim = 'The API returns invalid JSON';
    const implicated = ['/src/api.ts', '/src/serializer.ts'];
    const ruledOut = ['/src/cache.ts'];
    const surface = 'backend';
    const title = 'API JSON serialization broken';

    const res = await call('file_finding', {
      violatedClaim: claim,
      repro: specPath,
      implicatedFiles: implicated,
      ruledOut,
      surface,
      title,
    });

    expect(res.leaf).toBeTruthy();
    expect(res.leaf.id).toBeTruthy();
    expect(res.finding).toBeTruthy();
    expect(res.finding.id).toBeTruthy();
    expect(res.finding.todoId).toBe(res.leaf.id);

    // Verify leaf was created under bugfix bucket
    const leaf = getTodo(project, res.leaf.id)!;
    expect(leaf).toBeTruthy();
    expect(leaf.title).toBe(title);
    expect(leaf.description).toBe(claim);
    expect(leaf.kind).toBe('leaf');
    expect(leaf.status).toBe('backlog');

    // Verify finding round-trips typed fields
    const finding = await getFindingByTodoId(project, res.leaf.id);
    expect(finding).toBeTruthy();
    expect(finding!.violatedClaim).toBe(claim);
    expect(finding!.implicatedFiles).toEqual(implicated);
    expect(finding!.ruledOut).toEqual(ruledOut);
    expect(finding!.surface).toBe(surface);
    expect(finding!.reproPath).toBe(specPath);
    expect(finding!.failureIdentity).toBeTruthy();

    // Verify typed fields are persisted independently in the finding row
    // (not merged/lost with the leaf's description)
    expect(finding!.violatedClaim).toBe(claim);
    expect(finding!.implicatedFiles).toHaveLength(2);
    expect(finding!.ruledOut).toHaveLength(1);

    // Verify row counts changed: bucket epic (if first call) + leaf + finding
    const todosAfter = listTodos(project, { includeCompleted: true }).length;
    const findingsAfter = await listFindings(project).then((f) => f.length);
    // First call to ensureBucket creates the bucket epic, so +2 (bucket + leaf)
    expect(todosAfter).toBe(todosBefore + 2);
    expect(findingsAfter).toBe(findingsBefore + 1);
  });

  test('EXPLORE_NODE_ALLOWED_TOOLS includes file_finding and excludes file_to_bucket', () => {
    expect(EXPLORE_NODE_ALLOWED_TOOLS.includes('mcp__mermaid__file_finding')).toBe(true);
    expect(EXPLORE_NODE_ALLOWED_TOOLS.includes('file_to_bucket')).toBe(false);
  });

  test('same observation filed twice collapses to one finding row with recurrenceCount 2', async () => {
    const specPath = '__quarantine__/test.spec.ts';
    mkdirSync(join(project, '__quarantine__'), { recursive: true });
    const specFullPath = join(project, specPath);
    writeFileSync(
      specFullPath,
      `import { describe, test, expect } from 'bun:test';
describe('test', () => {
  test('fails', () => {
    throw new Error('test failure');
  });
});`,
      'utf-8'
    );

    execSync(`git add '${specPath}'`, { cwd: project });
    execSync('git commit -m "Add failing quarantine spec"', { cwd: project });

    const todosBefore = listTodos(project, { includeCompleted: true }).length;
    const findingsBefore = await listFindings(project).then((f) => f.length);

    // First call: creates leaf and finding
    const res1 = await call('file_finding', {
      violatedClaim: 'Test failure',
      repro: specPath,
    });

    expect(res1.leaf).toBeTruthy();
    expect(res1.finding).toBeTruthy();
    expect(res1.recurrence).toBe(false);
    expect(res1.finding.recurrenceCount).toBe(1);

    const todosAfter1 = listTodos(project, { includeCompleted: true }).length;
    const findingsAfter1 = await listFindings(project).then((f) => f.length);
    expect(todosAfter1).toBe(todosBefore + 2); // bucket + leaf
    expect(findingsAfter1).toBe(findingsBefore + 1);

    // Second call with same repro: should collapse and bump recurrence
    const res2 = await call('file_finding', {
      violatedClaim: 'Test failure',
      repro: specPath,
    });

    expect(res2.leaf).toBeTruthy();
    expect(res2.finding).toBeTruthy();
    expect(res2.recurrence).toBe(true);
    expect(res2.finding.recurrenceCount).toBe(2);
    expect(res2.finding.id).toBe(res1.finding.id);
    expect(res2.leaf.id).toBe(res1.leaf.id);

    // Verify row counts unchanged (no new rows)
    const todosAfter2 = listTodos(project, { includeCompleted: true }).length;
    const findingsAfter2 = await listFindings(project).then((f) => f.length);
    expect(todosAfter2).toBe(todosAfter1);
    expect(findingsAfter2).toBe(findingsAfter1);
  });

  test('falsifier: repro moved to a new quarantine path still collapses by failure identity', async () => {
    const specPath1 = '__quarantine__/test1.spec.ts';
    const specPath2 = '__quarantine__/test2.spec.ts';
    mkdirSync(join(project, '__quarantine__'), { recursive: true });
    const specFullPath1 = join(project, specPath1);
    writeFileSync(
      specFullPath1,
      `import { describe, test, expect } from 'bun:test';
describe('test', () => {
  test('fails', () => {
    throw new Error('test failure');
  });
});`,
      'utf-8'
    );

    execSync(`git add '${specPath1}'`, { cwd: project });
    execSync('git commit -m "Add failing quarantine spec"', { cwd: project });

    // First call: creates leaf and finding
    const res1 = await call('file_finding', {
      violatedClaim: 'Test failure',
      repro: specPath1,
    });

    expect(res1.finding).toBeTruthy();
    expect(res1.recurrence).toBe(false);
    const failureIdentity = res1.finding.failureIdentity;
    expect(failureIdentity).toBeTruthy();

    // Move the spec file to a new path (simulates repro path change)
    execSync(`git mv '${specPath1}' '${specPath2}'`, { cwd: project });
    execSync('git commit -m "Move failing spec"', { cwd: project });

    // Second call with different path but same failure identity: should still collapse
    const res2 = await call('file_finding', {
      violatedClaim: 'Test failure',
      repro: specPath2,
    });

    expect(res2.recurrence).toBe(true);
    expect(res2.finding.recurrenceCount).toBe(2);
    expect(res2.finding.id).toBe(res1.finding.id);
    expect(res2.finding.failureIdentity).toBe(failureIdentity);
  });

  test('falsifier: reworded claim/title/surface still collapses by failure identity', async () => {
    const specPath = '__quarantine__/test.spec.ts';
    mkdirSync(join(project, '__quarantine__'), { recursive: true });
    const specFullPath = join(project, specPath);
    writeFileSync(
      specFullPath,
      `import { describe, test, expect } from 'bun:test';
describe('test', () => {
  test('fails', () => {
    throw new Error('test failure');
  });
});`,
      'utf-8'
    );

    execSync(`git add '${specPath}'`, { cwd: project });
    execSync('git commit -m "Add failing quarantine spec"', { cwd: project });

    // First call
    const res1 = await call('file_finding', {
      violatedClaim: 'Original claim',
      repro: specPath,
      surface: 'backend',
      title: 'Original title',
    });

    expect(res1.recurrence).toBe(false);
    const failureIdentity = res1.finding.failureIdentity;

    // Second call with different claim/title/surface: should still collapse by identity
    const res2 = await call('file_finding', {
      violatedClaim: 'Reworded claim',
      repro: specPath,
      surface: 'integration',
      title: 'New title',
    });

    expect(res2.recurrence).toBe(true);
    expect(res2.finding.recurrenceCount).toBe(2);
    expect(res2.finding.id).toBe(res1.finding.id);
    expect(res2.finding.failureIdentity).toBe(failureIdentity);
    // Verify first-write fields were not overwritten
    expect(res2.finding.violatedClaim).toBe('Original claim');
  });

  test('negative control: a genuinely different failing spec creates a second finding and leaf', async () => {
    const specPath1 = '__quarantine__/test1.spec.ts';
    const specPath2 = '__quarantine__/test2.spec.ts';
    mkdirSync(join(project, '__quarantine__'), { recursive: true });

    // First spec
    writeFileSync(
      join(project, specPath1),
      `import { describe, test, expect } from 'bun:test';
describe('test1', () => {
  test('fails with error 1', () => {
    throw new Error('failure 1');
  });
});`,
      'utf-8'
    );

    execSync(`git add '${specPath1}'`, { cwd: project });
    execSync('git commit -m "Add first failing spec"', { cwd: project });

    // Second spec (genuinely different)
    writeFileSync(
      join(project, specPath2),
      `import { describe, test, expect } from 'bun:test';
describe('test2', () => {
  test('fails with error 2', () => {
    throw new Error('failure 2');
  });
});`,
      'utf-8'
    );

    execSync(`git add '${specPath2}'`, { cwd: project });
    execSync('git commit -m "Add second failing spec"', { cwd: project });

    const todosBefore = listTodos(project, { includeCompleted: true }).length;
    const findingsBefore = await listFindings(project).then((f) => f.length);

    // File first spec
    const res1 = await call('file_finding', {
      violatedClaim: 'Failure 1',
      repro: specPath1,
    });

    expect(res1.recurrence).toBe(false);
    const todosAfter1 = listTodos(project, { includeCompleted: true }).length;
    const findingsAfter1 = await listFindings(project).then((f) => f.length);

    // File second spec
    const res2 = await call('file_finding', {
      violatedClaim: 'Failure 2',
      repro: specPath2,
    });

    expect(res2.recurrence).toBe(false);
    expect(res2.finding.id).not.toBe(res1.finding.id);
    expect(res2.leaf.id).not.toBe(res1.leaf.id);

    // Verify counts: each adds a leaf (second may reuse bucket)
    const todosAfter2 = listTodos(project, { includeCompleted: true }).length;
    const findingsAfter2 = await listFindings(project).then((f) => f.length);
    // First call: bucket + leaf = +2; second call: just leaf = +1
    expect(todosAfter2).toBe(todosBefore + 3);
    expect(findingsAfter2).toBe(findingsBefore + 2);
  });
});
