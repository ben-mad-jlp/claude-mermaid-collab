/**
 * Audit item 8 — ONE listOpenEscalations sweep per reconcile pass.
 *
 * The escalation table used to be swept by multiple owners inside one
 * runReconcilePass: the step-1 stale-reaper, the 3i dangling-deps auto-close and
 * the 3j dep-strand auto-close each performed their own full
 * `listOpenEscalations()` read (with step 4 additionally operating on step 1's
 * stale snapshot). Now the pass takes ONE snapshot at the top and steps 1 / 3i /
 * 3j / 4 are phases over it, each re-reading a row's CURRENT status via the
 * per-row `getEscalation(id)` check exactly once before writing.
 *
 * MASTER-FAILS EVIDENCE: on master (pre-change, commit 3a3aa7c9) the identical
 * scenario performs 3 listOpenEscalations calls (step 1 at reconcile-pass.ts:144,
 * 3i at :508, 3j at :657 — step 4 reuses step 1's snapshot in that tree; the
 * audit counted 4 on the earlier layout). The `toHaveBeenCalledTimes(1)`
 * assertion therefore FAILS on master with 3.
 *
 * The double-write pin: a card the stale phase (1) resolves is NOT re-written by
 * the verified-done phase (4) even when its linked todo qualifies — the per-row
 * current-status re-check skips it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supDir = mkdtempSync(join(tmpdir(), 'esc1read-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = supDir;

import * as supervisorStore from '../supervisor-store';
import {
  createEscalation,
  getEscalation,
  SUPERVISOR_STALE_AFTER_MS,
  _closeDb,
} from '../supervisor-store';
import { createTodo, completeTodo, _closeProject } from '../todo-store';
import { runReconcilePass } from '../reconcile-pass';

const todoBase = mkdtempSync(join(tmpdir(), 'esc1read-proj-'));
let projectCounter = 0;
function freshProject(): string {
  const p = join(todoBase, `proj-${++projectCounter}`);
  mkdirSync(join(p, '.collab'), { recursive: true });
  return p;
}

beforeAll(() => { _closeDb(); });
beforeEach(() => {
  process.env.MERMAID_SUPERVISOR_DIR = supDir;
  _closeDb();
});
afterAll(() => {
  _closeDb();
  rmSync(supDir, { recursive: true, force: true });
  rmSync(todoBase, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

/** Run the reconcile pass with Date.now shifted forward by `deltaMs` (the
 *  card-timeout-honesty.test.ts idiom — makes fresh escalations "old" without
 *  raw-SQL backdating). */
async function runPassAt(project: string, deltaMs: number): Promise<void> {
  const realNow = Date.now;
  const base = realNow();
  Date.now = () => base + deltaMs;
  try {
    await runReconcilePass(project);
  } finally {
    Date.now = realNow;
  }
}

describe('reconcile pass — single escalation-table read (audit 8)', () => {
  it('one runReconcilePass performs exactly ONE listOpenEscalations sweep (master: 3)', async () => {
    const project = freshProject();
    // A live open card so the phases have a row to consider.
    createEscalation({
      project,
      session: 'coordinator',
      audience: 'internal',
      kind: 'blocker',
      questionText: 'open card for the single-read count',
    });

    const spy = spyOn(supervisorStore, 'listOpenEscalations');
    try {
      await runReconcilePass(project);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('a card resolved by the stale phase is NOT double-written by the verified-done phase', async () => {
    const project = freshProject();
    // Linked todo is done+accepted → phase 4's verified-done gate WOULD close the
    // card; the card is also past the stale window → phase 1 closes it first. The
    // per-row current-status re-check must make phase 4 skip it.
    const todo = await createTodo(project, { ownerSession: 's1', title: 'settled work', inbox: true });
    await completeTodo(project, todo.id, 'accepted');
    const { escalation } = createEscalation({
      project,
      session: 'coordinator',
      audience: 'internal',
      kind: 'blocker',
      todoId: todo.id,
      questionText: 'card both phases would want to close',
    });

    const resolveSpy = spyOn(supervisorStore, 'resolveEscalation');
    try {
      await runPassAt(project, SUPERVISOR_STALE_AFTER_MS + 60_000);
      const writesForCard = resolveSpy.mock.calls.filter((c) => c[0] === escalation.id);
      expect(writesForCard.length).toBe(1);            // exactly ONE write…
      expect(writesForCard[0][1]).toBe('stale');       // …and it was phase 1's (stale), not phase 4's 'resolved'
      expect(getEscalation(escalation.id)?.status).not.toBe('open');
    } finally {
      resolveSpy.mockRestore();
    }
  });
});
