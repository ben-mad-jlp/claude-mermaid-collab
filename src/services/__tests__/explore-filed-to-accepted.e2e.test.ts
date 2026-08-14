import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleWorkgraphTool } from '../../mcp/workgraph-tools';
import { getTodo, listTodos, claimTodo, completeTodo, openDb, _closeProject } from '../todo-store';
import { planCoordinatorTick } from '../coordinator-core';
import { isBucketEpic } from '../bucket-registry';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'explore-filed-'));
  mkdirSync(join(project, '.collab'), { recursive: true });
  openDb(project);
});

afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

const SESSION = 's1';

describe('explore filed → done:accepted e2e', () => {
  test('a file_explore leaf appears in planCoordinatorTick toClaim with its persisted updatedAt unchanged', async () => {
    // File explore via handleWorkgraphTool (shipped verb)
    const filingResult = await handleWorkgraphTool('file_explore', {
      project,
      session: SESSION,
      scope: 'getTodo',
      target: 'leaf parameter',
      oracle: 'getTodo accepts a leaf id and returns its stored row',
    });

    expect(filingResult).not.toBeNull();
    const parsed = JSON.parse(filingResult!);
    expect(parsed.leaf).toBeTruthy();
    const leafId = parsed.leaf.id;

    // Immediately read the filed leaf to capture baseline
    const baseline = getTodo(project, leafId)!;
    expect(baseline).toBeTruthy();
    const baselineUpdatedAt = baseline.updatedAt;

    // Run planner without intervening writes
    const todos = listTodos(project, { includeCompleted: true });
    const plan = planCoordinatorTick(todos, new Date().toISOString());

    // Leaf must appear in toClaim
    expect(plan.toClaim).toContain(leafId);

    // Re-read and verify updatedAt is unchanged (no store writes occurred)
    const reread = getTodo(project, leafId)!;
    expect(reread.updatedAt).toBe(baselineUpdatedAt);

    // Verify parent is the Explore runs epic (not a bucket)
    const parentId = reread.parentId;
    expect(parentId).toBeTruthy();
    const parent = getTodo(project, parentId!)!;
    expect(isBucketEpic(parent)).toBe(false);
    expect(parent.title).toMatch(/Explore runs/i);
  });

  test('claim + completeTodo drive the filed explore to done/accepted under a non-bucket parent epic', async () => {
    // File explore via handleWorkgraphTool (shipped verb)
    const filingResult = await handleWorkgraphTool('file_explore', {
      project,
      session: SESSION,
      scope: 'claimTodo',
      target: 'ownership guard',
      oracle: 'claimTodo enforces a CAS guard so only one worker claims a todo at a time',
    });

    expect(filingResult).not.toBeNull();
    const parsed = JSON.parse(filingResult!);
    expect(parsed.leaf).toBeTruthy();
    const leafId = parsed.leaf.id;

    // Daemon-side claim
    const claimed = await claimTodo(project, leafId, 'coordinator-test', 60_000);
    expect(claimed).toBeTruthy();
    const claimToken = claimed!.claim!.token;

    // Daemon-side completion with ownership-CAS
    const result = await completeTodo(project, leafId, 'accepted', 'coordinator-test', {
      requireInProgress: true,
      claimToken,
    });

    // Verify completion succeeded (not skipped by ownership-CAS)
    expect(result.skipped).toBeFalsy();

    // Re-read from store to verify terminal state
    const terminal = getTodo(project, leafId)!;
    expect(terminal.status).toBe('done');
    expect(terminal.acceptanceStatus).toBe('accepted');

    // Verify parent is non-bucket Explore runs epic
    const parentId = terminal.parentId;
    expect(parentId).toBeTruthy();
    const parent = getTodo(project, parentId!)!;
    expect(isBucketEpic(parent)).toBe(false);
    expect(parent.title).toMatch(/Explore runs/i);
  });
});
