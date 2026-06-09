/**
 * Unit tests for triage-pass.ts + triage-execute.ts (Orch P2).
 *
 * Isolates the global supervisor.db via MERMAID_SUPERVISOR_DIR and the per-project
 * todo DB via a temp dir (mirrors reconcile-pass.test.ts). Grok is injected, so no
 * network is touched.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supDir = mkdtempSync(join(tmpdir(), 'tp-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = supDir;

import {
  runTriagePass,
  isTriageEligible,
  isSuggestionFresh,
  TRIAGE_CAP,
} from '../triage-pass';
import { confirmSuggestion, dismissSuggestion } from '../triage-execute';
import {
  createEscalation,
  getEscalation,
  setEscalationSuggestion,
  listOpenEscalations,
  _closeDb,
  type SuggestedAction,
} from '../supervisor-store';
import { createTodo, getTodo, completeTodo } from '../todo-store';

const todoBase = mkdtempSync(join(tmpdir(), 'tp-todos-'));
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

function sugg(overrides: Partial<SuggestedAction> = {}): SuggestedAction {
  return {
    bucket: 'now-buildable', verb: 'reset_todo',
    args: { proof: { kind: 'dep-done' }, status: 'ready' },
    confidence: 0.9, rationale: 'deps done',
    bundleInputs: { todoUpdatedAt: null }, generatedAt: 0,
    ...overrides,
  };
}

// Inject a canned Grok reply into the pass via classifyEscalation's deps.
// commitsBehindMaster is stubbed so packBundle doesn't shell out to git in temp dirs.
function grokReply(reply: string) {
  return { callGrok: async () => reply, commitsBehindMaster: () => 0 };
}

describe('isTriageEligible', () => {
  const getRev = () => null;
  it('skips human-floor kinds', () => {
    for (const kind of ['approval', 'decision', 'assumption-invalidated', 'operator-gated']) {
      const e = { status: 'open', session: 's', kind, operatorGated: 0, suggestedAction: null, todoId: null } as any;
      expect(isTriageEligible(e, getRev)).toBe(false);
    }
  });
  it('skips operator-gated + the fail-open sentinel', () => {
    expect(isTriageEligible({ status: 'open', session: 's', kind: 'blocker', operatorGated: 1, suggestedAction: null, todoId: null } as any, getRev)).toBe(false);
    expect(isTriageEligible({ status: 'open', session: '__steward_failopen__', kind: 'blocker', operatorGated: 0, suggestedAction: null, todoId: null } as any, getRev)).toBe(false);
  });
  it('allows a plain open blocker', () => {
    expect(isTriageEligible({ status: 'open', session: 'w', kind: 'blocker', operatorGated: 0, suggestedAction: null, todoId: null } as any, getRev)).toBe(true);
  });
});

describe('isSuggestionFresh', () => {
  it('fresh when the todo revision is unchanged', () => {
    const e = { project: '/p', todoId: 't1', suggestedAction: sugg({ bundleInputs: { todoUpdatedAt: 'REV1' } }) } as any;
    expect(isSuggestionFresh(e, () => ({ updatedAt: 'REV1' }))).toBe(true);
  });
  it('stale when the todo revision changed', () => {
    const e = { project: '/p', todoId: 't1', suggestedAction: sugg({ bundleInputs: { todoUpdatedAt: 'REV1' } }) } as any;
    expect(isSuggestionFresh(e, () => ({ updatedAt: 'REV2' }))).toBe(false);
  });
  it('no suggestion → not fresh (eligible)', () => {
    expect(isSuggestionFresh({ suggestedAction: null } as any, () => null)).toBe(false);
  });
});

describe('runTriagePass', () => {
  it('classifies an eligible escalation and writes an inline suggestion', async () => {
    const project = freshProject();
    const { escalation } = createEscalation({ project, session: 'w1', kind: 'blocker', questionText: 'stuck?' });
    await runTriagePass(project, grokReply('{"bucket":"now-buildable","confidence":0.95,"rationale":"go"}'));
    const after = getEscalation(escalation.id);
    expect(after?.suggestedAction?.bucket).toBe('now-buildable');
    expect(after?.suggestedAction?.verb).toBe('reset_todo');
  });

  it('respects the per-tick cap', async () => {
    const project = freshProject();
    for (let i = 0; i < TRIAGE_CAP + 2; i++) {
      createEscalation({ project, session: `w${i}`, kind: 'blocker', questionText: `q${i}` });
    }
    let calls = 0;
    await runTriagePass(project, { callGrok: async () => { calls++; return '{"bucket":"stale","confidence":0.6,"rationale":"x"}'; }, commitsBehindMaster: () => 0 });
    expect(calls).toBe(TRIAGE_CAP);
  });

  it('skips an escalation that already has a fresh suggestion', async () => {
    const project = freshProject();
    const { escalation } = createEscalation({ project, session: 'w1', kind: 'blocker', questionText: 'stuck?' });
    setEscalationSuggestion(escalation.id, sugg({ bundleInputs: { todoUpdatedAt: null } }));
    let calls = 0;
    await runTriagePass(project, { callGrok: async () => { calls++; return '{"bucket":"stale","confidence":0.6,"rationale":"x"}'; }, commitsBehindMaster: () => 0, getTodoRevision: () => null });
    expect(calls).toBe(0);
  });

  it('fails open per-escalation: a Grok error leaves the escalation plain, no throw', async () => {
    const project = freshProject();
    const { escalation } = createEscalation({ project, session: 'w1', kind: 'blocker', questionText: 'stuck?' });
    await runTriagePass(project, { callGrok: async () => { throw new Error('boom'); }, commitsBehindMaster: () => 0 });
    expect(getEscalation(escalation.id)?.suggestedAction).toBeNull();
  });
});

describe('confirmSuggestion / dismissSuggestion', () => {
  it('confirm applies reset_todo when the dep-done proof re-validates green', async () => {
    const project = freshProject();
    const dep = await createTodo(project, { ownerSession: 'w', title: 'dep' });
    await completeTodo(project, dep.id, 'accepted', 'w'); // dep done+accepted
    const work = await createTodo(project, { ownerSession: 'w', title: 'work', status: 'blocked', dependsOn: [dep.id] });
    const { escalation } = createEscalation({ project, session: 'w', kind: 'blocker', questionText: 'blocked?', todoId: work.id });
    setEscalationSuggestion(escalation.id, sugg({ bundleInputs: { todoUpdatedAt: getTodo(project, work.id)!.updatedAt } }));

    const res = await confirmSuggestion(project, escalation.id);
    expect(res.ok).toBe(true);
    expect(getTodo(project, work.id)?.status).toBe('ready'); // verb applied
    expect(getEscalation(escalation.id)?.status).toBe('resolved');
    expect(getEscalation(escalation.id)?.suggestedAction).toBeNull();
  });

  it('confirm REJECTS (no mutation) + re-routes to human when the proof FAILS (dep not done)', async () => {
    const project = freshProject();
    const dep = await createTodo(project, { ownerSession: 'w', title: 'dep' }); // NOT done
    const work = await createTodo(project, { ownerSession: 'w', title: 'work', status: 'blocked', dependsOn: [dep.id] });
    const { escalation } = createEscalation({ project, session: 'w', kind: 'blocker', questionText: 'blocked?', todoId: work.id });
    setEscalationSuggestion(escalation.id, sugg({ bundleInputs: { todoUpdatedAt: getTodo(project, work.id)!.updatedAt } }));

    const res = await confirmSuggestion(project, escalation.id);
    expect(res.ok).toBe(false);
    expect(getTodo(project, work.id)?.status).toBe('blocked'); // NOT mutated
    const after = getEscalation(escalation.id);
    expect(after?.status).toBe('open'); // still open
    expect(after?.routedTo).toBe('human'); // re-routed
    expect(after?.suggestedAction).toBeNull(); // cleared
  });

  it('confirm is STALE-guarded: a moved todo revision → no mutation, suggestion cleared', async () => {
    const project = freshProject();
    const dep = await createTodo(project, { ownerSession: 'w', title: 'dep' });
    await completeTodo(project, dep.id, 'accepted', 'w');
    const work = await createTodo(project, { ownerSession: 'w', title: 'work', status: 'blocked', dependsOn: [dep.id] });
    const { escalation } = createEscalation({ project, session: 'w', kind: 'blocker', questionText: 'blocked?', todoId: work.id });
    // Suggestion generated against a STALE revision.
    setEscalationSuggestion(escalation.id, sugg({ bundleInputs: { todoUpdatedAt: '1999-01-01T00:00:00.000Z' } }));

    const res = await confirmSuggestion(project, escalation.id);
    expect(res.reason).toBe('stale');
    expect(getTodo(project, work.id)?.status).toBe('blocked'); // untouched
    expect(getEscalation(escalation.id)?.suggestedAction).toBeNull();
  });

  it('dismiss clears the suggestion, leaves the escalation open', async () => {
    const project = freshProject();
    const { escalation } = createEscalation({ project, session: 'w', kind: 'blocker', questionText: 'q?' });
    setEscalationSuggestion(escalation.id, sugg());
    const res = dismissSuggestion(project, escalation.id);
    expect(res.ok).toBe(true);
    expect(getEscalation(escalation.id)?.suggestedAction).toBeNull();
    expect(getEscalation(escalation.id)?.status).toBe('open');
  });
});
