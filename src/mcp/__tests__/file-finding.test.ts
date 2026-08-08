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
});
