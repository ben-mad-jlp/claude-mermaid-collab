// Tests for file_explore verb: oracle refusal, vacuity warnings, round-trip, null fields.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleWorkgraphTool } from '../workgraph-tools';
import { fileExploreRequest, ExploreOracleRefusedError } from '../workgraph-tools';
import { getTodo, listTodos, deriveTodoViews, _closeProject } from '../../services/todo-store';
import { claimReason, derivedStatus } from '../../services/claimability';
import { EXPLORE_STOPWORDS } from '../../services/explore-request';

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'file-explore-'));
  mkdirSync(join(project, '.collab'), { recursive: true });
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

const S = 's1';

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const out = await handleWorkgraphTool(name, { project, session: S, ...args });
  expect(out).not.toBeNull();
  return JSON.parse(out!);
}

describe('file_explore', () => {
  test('refuses with zero rows written for undefined, empty, and whitespace oracle', async () => {
    const testCases = [undefined, '', '   '];

    for (const oracle of testCases) {
      const beforeCount = listTodos(project, { includeCompleted: true }).length;

      // Test direct function call
      await expect(
        fileExploreRequest(project, S, {
          scope: 'x',
          target: 'y',
          oracle: oracle as any,
        }),
      ).rejects.toThrow(ExploreOracleRefusedError);

      // Verify no rows were written and no Explore runs epic was created
      const afterCount = listTodos(project, { includeCompleted: true }).length;
      expect(afterCount).toBe(beforeCount);

      const hasExploreRunsEpic = listTodos(project, { includeCompleted: true }).some(
        (t) => t.kind === 'epic' && /explore runs/i.test(t.title),
      );
      expect(hasExploreRunsEpic).toBe(false);
    }
  });

  test('file_explore dispatch rejects on missing oracle with unchanged row count', async () => {
    const beforeCount = listTodos(project, { includeCompleted: true }).length;

    // Test MCP dispatch guard with empty oracle
    await expect(
      call('file_explore', {
        scope: 'x',
        target: 'y',
        oracle: '',
      }),
    ).rejects.toThrow(/Missing required/);

    const afterCount = listTodos(project, { includeCompleted: true }).length;
    expect(afterCount).toBe(beforeCount);
  });

  test('accepted requests surface no-named-anchor, oracle-subsumed-by-scope, and no-falsifiable-predicate warnings', async () => {
    // Test (a): no-named-anchor
    {
      const beforeCount = listTodos(project, { includeCompleted: true }).length;
      const result = await fileExploreRequest(project, S, {
        scope: 'counter',
        target: 'increment',
        oracle: 'the counter must never go down',
      });

      expect(result.warnings.map((w) => w.code)).toContain('no-named-anchor');
      expect(result.leaf).toBeTruthy();

      const afterCount = listTodos(project, { includeCompleted: true }).length;
      expect(afterCount).toBe(beforeCount + 2); // Bucket + leaf
    }

    // Test (b): oracle-subsumed-by-scope
    {
      const beforeCount = listTodos(project, { includeCompleted: true }).length;
      const result = await fileExploreRequest(project, S, {
        scope: 'fileExploreRequest',
        target: 'oracle',
        oracle: 'the fileExploreRequest oracle',
      });

      expect(result.warnings.map((w) => w.code)).toContain('oracle-subsumed-by-scope');
      expect(result.leaf).toBeTruthy();

      const afterCount = listTodos(project, { includeCompleted: true }).length;
      expect(afterCount).toBe(beforeCount + 1); // Bucket already exists from test (a), so just leaf
    }

    // Test (c): no-falsifiable-predicate
    {
      const beforeCount = listTodos(project, { includeCompleted: true }).length;
      const result = await fileExploreRequest(project, S, {
        scope: 'validator',
        target: 'predicate',
        oracle: 'fileExploreRequest handles the oracle argument',
      });

      expect(result.warnings.map((w) => w.code)).toContain('no-falsifiable-predicate');
      expect(result.leaf).toBeTruthy();

      const afterCount = listTodos(project, { includeCompleted: true }).length;
      expect(afterCount).toBe(beforeCount + 1); // Just leaf
    }
  });

  test('accepted requests surface warnings via MCP dispatch', async () => {
    // Test via MCP call for no-named-anchor
    {
      const result = await call('file_explore', {
        scope: 'counter',
        target: 'value',
        oracle: 'the value should be positive',
      });

      expect(result.warnings.some((w: any) => w.code === 'no-named-anchor')).toBe(true);
      expect(result.leaf).toBeTruthy();
    }

    // Test via MCP call for oracle-subsumed-by-scope
    {
      const result = await call('file_explore', {
        scope: 'handleWorkgraphTool',
        target: 'dispatch',
        oracle: 'handleWorkgraphTool dispatch',
      });

      expect(result.warnings.some((w: any) => w.code === 'oracle-subsumed-by-scope')).toBe(true);
      expect(result.leaf).toBeTruthy();
    }

    // Test via MCP call for no-falsifiable-predicate
    {
      const result = await call('file_explore', {
        scope: 'deriveTodoViews',
        target: 'fields',
        oracle: 'deriveTodoViews passes through fields',
      });

      expect(result.warnings.some((w: any) => w.code === 'no-falsifiable-predicate')).toBe(true);
      expect(result.leaf).toBeTruthy();
    }
  });

  test('round-trips scope, target, oracle, not, reach and parents under the explore bucket', async () => {
    const scope = 'fileExploreRequest';
    const target = 'oracle validation';
    const oracle = 'fileExploreRequest must validate the oracle argument';
    const not = 'empty string';
    const reach = 'any caller';

    const result = await fileExploreRequest(project, S, {
      scope,
      target,
      oracle,
      not,
      reach,
    });

    const leaf = result.leaf;
    expect(leaf.type).toBe('explore');
    expect(leaf.exploreSpec).toBeTruthy();

    // Re-read via getTodo
    const retrieved = getTodo(project, leaf.id)!;
    expect(retrieved).toBeTruthy();
    expect(retrieved.type).toBe('explore');
    expect(retrieved.exploreSpec!.scope).toBe(scope);
    expect(retrieved.exploreSpec!.target).toBe(target);
    expect(retrieved.exploreSpec!.oracle).toBe(oracle);
    expect(retrieved.exploreSpec!.not).toBe(not);
    expect(retrieved.exploreSpec!.reach).toBe(reach);

    // Verify parent is the non-bucket Explore runs epic
    const parentId = retrieved.parentId;
    expect(parentId).toBeTruthy();
    const parent = getTodo(project, parentId!)!;
    expect(parent.bucketType).toBeNull();
    expect(parent.isBucket).toBe(false);
    expect(parent.title).toMatch(/Explore runs/i);
    expect(parent.parentId).toBeNull(); // Root epic

    // Verify deriveTodoViews carries the spec
    const views = deriveTodoViews(project, [retrieved]);
    expect(views).toHaveLength(1);
    expect(views[0].type).toBe('explore');
    expect(views[0].exploreSpec).toEqual({
      scope,
      target,
      oracle,
      not,
      reach,
    });
  });

  test('omitted not and reach persist as explicit null', async () => {
    const result = await fileExploreRequest(project, S, {
      scope: 'validation',
      target: 'oracle',
      oracle: 'validation must check oracle',
      // not and reach are omitted
    });

    const leaf = result.leaf;
    const retrieved = getTodo(project, leaf.id)!;

    expect(retrieved.exploreSpec!.not).toBeNull();
    expect(retrieved.exploreSpec!.reach).toBeNull();

    // Verify through deriveTodoViews as well
    const views = deriveTodoViews(project, [retrieved]);
    expect(views[0].exploreSpec!.not).toBeNull();
    expect(views[0].exploreSpec!.reach).toBeNull();
  });

  test('a filed explore read back from the store is claimable and derives ready', async () => {
    const result = await fileExploreRequest(project, S, {
      scope: 'testScope',
      target: 'testTarget',
      oracle: 'testOracle must pass',
    });

    const leaf = result.leaf;
    const retrieved = getTodo(project, leaf.id)!;
    expect(retrieved).toBeTruthy();

    // Build the byId map for claimability check
    const allTodos = listTodos(project, { includeCompleted: true });
    const byId = new Map(allTodos.map((t) => [t.id, t]));

    // Verify claimability: should be 'claimable' (no blockers)
    const claim = claimReason(retrieved, byId);
    expect(claim).toBe('claimable');

    // Verify derivedStatus: should be 'ready' (approved and no dependencies)
    const status = derivedStatus(retrieved, byId);
    expect(status).toBe('ready');
  });
});
