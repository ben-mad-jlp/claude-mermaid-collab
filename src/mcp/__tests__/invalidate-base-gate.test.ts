import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEpicBaseGate, getEpicBaseGate, invalidateEpicBaseGate, _closeLedgerDb } from '../../services/worker-ledger.js';
import { listSupervisorAudit, _closeDb } from '../../services/supervisor-store.js';
import { handleEpicTool } from '../epic-tools.js';
import { _closeProject } from '../../services/todo-store.js';

let project: string;
const session = 'test-session-123';
const epicId = 'epic-abc-def';

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'invalidate-base-gate-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _closeDb();
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('invalidate_base_gate', () => {
  test('clears the cached base-gate row so the next read re-measures', () => {
    const baseSha = 'abc1234def5678';

    // Record a cached base-gate verdict
    recordEpicBaseGate({ epicId, project, baseSha, status: 'fail', command: 'npm test', output: 'test output' });

    // Verify the row exists
    const beforeInvalidate = getEpicBaseGate(epicId, baseSha);
    expect(beforeInvalidate).not.toBeNull();
    expect(beforeInvalidate?.status).toBe('fail');

    // Invalidate the cached row
    const { deleted, row } = invalidateEpicBaseGate(epicId);
    expect(deleted).toBe(true);
    expect(row).not.toBeNull();
    expect(row?.baseSha).toBe(baseSha);
    expect(row?.status).toBe('fail');

    // Verify the row is gone
    const afterInvalidate = getEpicBaseGate(epicId, baseSha);
    expect(afterInvalidate).toBeNull();
  });

  test('records exactly one override audit entry naming actor and reason', async () => {
    const baseSha = 'abc1234def5678';
    const reason = 'contention flake false red';
    const actor = 'steward';

    // Record a cached base-gate verdict
    recordEpicBaseGate({ epicId, project, baseSha, status: 'fail', command: 'npm test', output: 'test output' });

    // Call the verb
    const result = await handleEpicTool('invalidate_base_gate', {
      project,
      session,
      epicId,
      reason,
      actor,
    });

    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.ok).toBe(true);
    expect(parsed.deleted).toBe(true);
    expect(parsed.epicId).toBe(epicId);

    // Assert exactly one audit entry exists
    const auditEntries = listSupervisorAudit({ project });
    expect(auditEntries).toHaveLength(1);

    const entry = auditEntries[0];
    expect(entry.kind).toBe('override');
    expect(entry.project).toBe(project);
    expect(entry.session).toBe(session);

    // Parse and verify the detail JSON
    const detail = JSON.parse(entry.detail || '{}');
    expect(detail.epicId).toBe(epicId);
    expect(detail.actor).toBe(actor);
    expect(detail.reason).toBe(reason);
    expect(detail.clearedBaseSha).toBe(baseSha);
    expect(detail.clearedStatus).toBe('fail');
  });

  test('rejects a second invalidate with no-cached-base-gate and writes no further audit entry', async () => {
    const baseSha = 'abc1234def5678';

    // Record and then clear
    recordEpicBaseGate({ epicId, project, baseSha, status: 'fail', command: 'npm test', output: 'test output' });
    await handleEpicTool('invalidate_base_gate', {
      project,
      session,
      epicId,
      reason: 'first clear',
      actor: 'operator',
    });

    // Verify one audit entry was written
    const auditBefore = listSupervisorAudit({ project });
    expect(auditBefore).toHaveLength(1);

    // Attempt to invalidate again — should throw
    let threw = false;
    let errorMessage = '';
    try {
      await handleEpicTool('invalidate_base_gate', {
        project,
        session,
        epicId,
        reason: 'second clear',
        actor: 'operator',
      });
    } catch (e) {
      threw = true;
      errorMessage = (e as Error).message;
    }

    expect(threw).toBe(true);
    expect(errorMessage).toMatch(/no-cached-base-gate/);

    // Verify audit trail is UNCHANGED (still 1 entry)
    const auditAfter = listSupervisorAudit({ project });
    expect(auditAfter).toHaveLength(1);
  });

  test('store function returns deleted:false when no row exists', () => {
    const { deleted, row } = invalidateEpicBaseGate('nonexistent-epic');
    expect(deleted).toBe(false);
    expect(row).toBeNull();
  });
});
