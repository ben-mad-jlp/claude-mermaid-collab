import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'auto-action-audit-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import { recordAutoAction, AUTO_ACTION_AUDIT_KIND } from '../auto-action-audit';
import { listSupervisorAudit, _closeDb } from '../supervisor-store';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

describe('recordAutoAction', () => {
  it('records exactly one auto-action row carrying action, outcome and a non-empty reason', () => {
    const project = '/test/auto-action-1';
    recordAutoAction({
      project,
      action: 'explore-dispatch',
      outcome: 'performed',
      reason: 'found a new query pattern',
    });

    const rows = listSupervisorAudit({ project, kind: AUTO_ACTION_AUDIT_KIND });
    expect(rows).toHaveLength(1);

    const row = rows[0];
    const detail = JSON.parse(row.detail!);
    expect(detail.action).toBe('explore-dispatch');
    expect(detail.outcome).toBe('performed');
    expect(detail.reason).toBe('found a new query pattern');
    expect(row.session).toBe('__auto__');
  });

  it('throws on an empty or whitespace-only reason and writes no row', () => {
    const project1 = '/test/auto-action-empty';
    expect(() => {
      recordAutoAction({
        project: project1,
        action: 'finding-filed',
        outcome: 'refused',
        reason: '',
      });
    }).toThrow();

    expect(listSupervisorAudit({ project: project1, kind: AUTO_ACTION_AUDIT_KIND })).toHaveLength(0);

    const project2 = '/test/auto-action-whitespace';
    expect(() => {
      recordAutoAction({
        project: project2,
        action: 'mission-forge',
        outcome: 'capped',
        reason: '   ',
      });
    }).toThrow();

    expect(listSupervisorAudit({ project: project2, kind: AUTO_ACTION_AUDIT_KIND })).toHaveLength(0);
  });
});
