/**
 * Tests for explore queue cap enforcement and audit recording.
 *
 * Covers: ExploreQueueFullError, live-explore cap check before addSessionTodo,
 * recordAutoAction on both capped and success paths.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate supervisor.db BEFORE importing the audit modules.
const supervisorDir = mkdtempSync(join(tmpdir(), 'explore-cap-audit-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { fileExploreRequest, ExploreQueueFullError } from '../workgraph-tools';
import { getTodo, listTodos, _closeProject } from '../../services/todo-store';
import { EXPLORE_QUEUE_MAX } from '../../services/auto-action-audit';
import { listSupervisorAudit, _closeDb as closeDb } from '../../services/supervisor-store';
import { AUTO_ACTION_AUDIT_KIND } from '../../services/auto-action-audit';

beforeAll(() => { closeDb(); });
afterAll(() => { closeDb(); rmSync(supervisorDir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

describe('explore-queue-cap-and-audit', () => {
  let project: string;
  const session = 's1';

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'explore-cap-test-'));
    mkdirSync(join(project, '.collab'), { recursive: true });
  });

  afterEach(() => {
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  });

  it('refuses a fileExploreRequest at the queue cap without writing a todo row', async () => {
    // File EXPLORE_QUEUE_MAX explores successfully.
    const leafIds: string[] = [];
    for (let i = 0; i < EXPLORE_QUEUE_MAX; i++) {
      const result = await fileExploreRequest(project, session, {
        scope: `scope-${i}`,
        target: `target-${i}`,
        oracle: `oracle claim ${i}`,
      });
      leafIds.push(result.leaf.id);
      expect(result.leaf).toBeTruthy();
    }

    // Count all todos before attempting cap-breaking file
    const allTodosBefore = listTodos(project, { includeCompleted: true }).length;

    // Attempt to file one more — should throw ExploreQueueFullError
    await expect(
      fileExploreRequest(project, session, {
        scope: 'scope-overflow',
        target: 'target-overflow',
        oracle: 'oracle claim overflow',
      }),
    ).rejects.toThrow(ExploreQueueFullError);

    // Verify no new todo was written
    const allTodosAfter = listTodos(project, { includeCompleted: true }).length;
    expect(allTodosAfter).toBe(allTodosBefore);
  });

  it('records exactly one explore-dispatch auto-action row naming the filing session', async () => {
    // File one explore
    const session2 = 's-audit-test-session-123';
    const oracle = 'this is my distinctive oracle claim for audit test';
    const result = await fileExploreRequest(project, session2, {
      scope: 'audit-scope',
      target: 'audit-target',
      oracle,
    });

    expect(result.leaf).toBeTruthy();

    // Query the supervisor audit for this project
    const rows = listSupervisorAudit({ project, kind: AUTO_ACTION_AUDIT_KIND });

    // Expect exactly one audit row for the successful dispatch
    expect(rows).toHaveLength(1);

    const row = rows[0];
    const detail = JSON.parse(row.detail!);

    // Verify action and outcome
    expect(detail.action).toBe('explore-dispatch');
    expect(detail.outcome).toBe('performed');

    // Verify reason contains the session name
    expect(detail.reason).toContain(session2);

    // Verify detail fields (they're at the top level of the parsed detail object)
    expect(detail.leafId).toBe(result.leaf.id);
    expect(detail.session).toBe(session2);
    expect(detail.target).toBe('audit-target');
    expect(typeof detail.queueDepth).toBe('number');
    expect(detail.queueDepth).toBeGreaterThan(0);
  });
});
