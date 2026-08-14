import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'daemon-status-bucket-planning-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import { handleSystemTool } from '../../mcp/system-tools.js';
import { addWatchedProject, _closeDb } from '../supervisor-store.js';
import { createTodo, _closeProject } from '../todo-store.js';
import { ensureBucket } from '../bucket-registry.js';

function freshProject(): string {
  const projectDir = mkdtempSync(join(tmpdir(), 'bucket-planning-leaf-'));
  mkdirSync(join(projectDir, '.collab'), { recursive: true });
  return projectDir;
}

const projects: string[] = [];

beforeAll(() => {
  _closeDb();
});

afterAll(() => {
  for (const p of projects.splice(0)) {
    _closeProject(p);
    rmSync(p, { recursive: true, force: true });
  }
  _closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('daemon_status bucket-planning visibility', () => {
  it('lists a bucket-planning leaf with its reason in the daemon_status response body', async () => {
    const project = freshProject();
    projects.push(project);
    addWatchedProject(project);

    const bucketId = await ensureBucket(project, 'inbox');
    const leafId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'leaf',
      title: 'Task in bucket',
      parentId: bucketId,
    })).id;

    const result = await handleSystemTool('daemon_status', { project });
    expect(result).toBeDefined();
    const parsed = JSON.parse(result!);

    // Verify the bucket-planning leaf appears in suppressed
    expect(parsed.claimSuppression.suppressed).toContainEqual(
      expect.objectContaining({
        todoId: leafId,
        reason: expect.stringContaining('bucket-planning'),
      }),
    );

    // Verify it contains the remediation phrase
    const bucketSuppressionEntry = parsed.claimSuppression.suppressed.find(
      (s: any) => s.todoId === leafId,
    );
    expect(bucketSuppressionEntry.reason).toContain('re-home to a real epic to run');

    // Verify it's NOT in claimableIds
    expect(parsed.claimSuppression.claimableIds).not.toContain(leafId);

    // Verify claimable count is 0
    expect(parsed.claimSuppression.claimable).toBe(0);
  });
});
