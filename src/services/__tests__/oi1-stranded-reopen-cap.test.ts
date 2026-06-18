// OI-1 loop-bound: a stranded acceptance that can't be integrated must not be
// re-surfaced `ready` forever (the build123d A1 "dump_plan core" ~5h re-claim/
// re-build burn at `drive`). After STRANDED_REOPEN_CAP reversals the gate parks the
// leaf held instead of reopening. This test covers the cap DECISION input —
// countStrandedReversals reads the recorded reversals from the supervisor audit —
// so the gate flips to park-held at exactly the cap.
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'oi1-cap-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

const { recordSupervisorAudit, _closeDb } = await import('../supervisor-store');
const { countStrandedReversals, STRANDED_REOPEN_CAP } = await import('../coordinator-live');

afterAll(() => {
  _closeDb?.();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('OI-1 stranded-reopen cap', () => {
  const project = '/tmp/oi1-cap-proj';
  const todoId = 'leaf-A1';

  it('counts only THIS leaf\'s integration-unreachable reversals', () => {
    expect(countStrandedReversals(project, todoId)).toBe(0);
    // Reversals for a different leaf must not count.
    recordSupervisorAudit({ kind: 'reconcile', project, session: 's', detail: JSON.stringify({ todoId: 'other', oi1: 'reversed-not-on-integration' }) });
    // A different oi1 reason for our leaf must not count.
    recordSupervisorAudit({ kind: 'reconcile', project, session: 's', detail: JSON.stringify({ todoId, oi1: 'reachable-accept' }) });
    expect(countStrandedReversals(project, todoId)).toBe(0);
  });

  it('reaches the cap after CAP reversals → gate would park held instead of reopening', () => {
    for (let i = 0; i < STRANDED_REOPEN_CAP; i++) {
      expect(countStrandedReversals(project, todoId) >= STRANDED_REOPEN_CAP).toBe(false); // still reopening
      recordSupervisorAudit({ kind: 'reconcile', project, session: 's', detail: JSON.stringify({ todoId, oi1: 'reversed-not-on-integration' }) });
    }
    expect(countStrandedReversals(project, todoId)).toBe(STRANDED_REOPEN_CAP);
    // At/over the cap the gate parks held (stops the infinite re-claim loop).
    expect(countStrandedReversals(project, todoId) >= STRANDED_REOPEN_CAP).toBe(true);
  });
});
