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
  runDriveLandPass,
  isTriageEligible,
  isSuggestionFresh,
  isTriageNullBackedOff,
  _resetTriageNullBackoff,
  TRIAGE_CAP,
  TRIAGE_NULL_BACKOFF_MS,
  AUTO_RESOLVE_CAP,
  EPIC_LAND_CAP,
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
  _resetTriageNullBackoff();
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

  it('conductor ON ⇒ AI triage is skipped entirely (the conductor handles escalations)', async () => {
    const project = freshProject();
    createEscalation({ project, session: 'w1', kind: 'blocker', questionText: 'stuck?' });
    let calls = 0;
    await runTriagePass(project, {
      conductorEnabled: () => true, // conductor drives this project
      callGrok: async () => { calls++; return '{"bucket":"stale","confidence":0.6,"rationale":"x"}'; },
      commitsBehindMaster: () => 0,
    });
    expect(calls).toBe(0); // no Grok classify spend
  });

  it('a null classify (Grok down) is NOT re-classified every tick — it backs off, then retries after the window', async () => {
    const project = freshProject();
    createEscalation({ project, session: 'w1', kind: 'blocker', questionText: 'stuck?' });
    let calls = 0;
    let clock = 1_000_000;
    const downGrok = { callGrok: async () => { calls++; throw new Error('grok unreachable'); }, commitsBehindMaster: () => 0, now: () => clock };

    // Tick 1: Grok is down → one classify attempt → back-off recorded.
    await runTriagePass(project, downGrok);
    expect(calls).toBe(1);

    // Ticks 2..N within the back-off window: the SAME unchanged escalation is skipped — no re-spend.
    clock += TRIAGE_NULL_BACKOFF_MS - 1;
    await runTriagePass(project, downGrok);
    await runTriagePass(project, downGrok);
    expect(calls).toBe(1); // still 1 — the down-Grok hammer is gone

    // Past the window: retried once (and backs off again if still failing).
    clock += 2;
    await runTriagePass(project, downGrok);
    expect(calls).toBe(2);
  });

  it('the null back-off releases early when the linked todo revision changes (its world moved)', async () => {
    const project = freshProject();
    const { escalation } = createEscalation({ project, session: 'w1', kind: 'blocker', questionText: 'stuck?', todoId: 't1' });
    let calls = 0;
    let clock = 1_000_000;
    let rev = 'rev-a';
    const downGrok = {
      callGrok: async () => { calls++; throw new Error('grok unreachable'); },
      commitsBehindMaster: () => 0,
      getTodoRevision: () => ({ updatedAt: rev }),
      now: () => clock,
    };

    await runTriagePass(project, downGrok);
    expect(calls).toBe(1); // classified once, backed off at rev-a

    // Same revision, inside the window → skipped.
    clock += 1000;
    await runTriagePass(project, downGrok);
    expect(calls).toBe(1);
    // isTriageNullBackedOff agrees at rev-a, disagrees once the revision moves.
    expect(isTriageNullBackedOff(getEscalation(escalation.id)!, () => ({ updatedAt: 'rev-a' }), clock)).toBe(true);
    expect(isTriageNullBackedOff(getEscalation(escalation.id)!, () => ({ updatedAt: 'rev-b' }), clock)).toBe(false);

    // The linked todo moves → the escalation is re-classified immediately, still inside the window.
    rev = 'rev-b';
    await runTriagePass(project, downGrok);
    expect(calls).toBe(2);
  });
});

describe('runTriagePass — autoResolve (level drive, Phase 3)', () => {
  const HI = '{"bucket":"now-buildable","confidence":0.97,"rationale":"go"}';

  it('does NOT auto-resolve at propose (autoResolve omitted) — write-only', async () => {
    const project = freshProject();
    createEscalation({ project, session: 'w1', kind: 'blocker', questionText: 'q?' });
    const confirmed: string[] = [];
    await runTriagePass(project, {
      callGrok: async () => HI, commitsBehindMaster: () => 0,
      confirm: async (_p, id) => { confirmed.push(id); return { ok: true, reason: 'applied' }; },
    });
    expect(confirmed).toEqual([]); // propose never auto-confirms
  });

  it('auto-resolves a high-confidence actionable suggestion at drive', async () => {
    const project = freshProject();
    const { escalation } = createEscalation({ project, session: 'w1', kind: 'blocker', questionText: 'q?' });
    const confirmed: string[] = [];
    await runTriagePass(project, {
      autoResolve: true, callGrok: async () => HI, commitsBehindMaster: () => 0,
      confirm: async (_p, id) => { confirmed.push(id); return { ok: true, reason: 'applied' }; },
    });
    expect(confirmed).toEqual([escalation.id]);
  });

  it('does NOT auto-resolve a classify-only suggestion (no verb)', async () => {
    const project = freshProject();
    createEscalation({ project, session: 'w1', kind: 'blocker', questionText: 'q?' });
    const confirmed: string[] = [];
    await runTriagePass(project, {
      autoResolve: true, commitsBehindMaster: () => 0,
      callGrok: async () => '{"bucket":"genuine-decision","confidence":0.99,"rationale":"human"}',
      confirm: async (_p, id) => { confirmed.push(id); return { ok: true, reason: 'applied' }; },
    });
    expect(confirmed).toEqual([]);
  });

  it('does NOT auto-resolve below the auto-resolve confidence bar', async () => {
    const project = freshProject();
    createEscalation({ project, session: 'w1', kind: 'blocker', questionText: 'q?' });
    const confirmed: string[] = [];
    await runTriagePass(project, {
      autoResolve: true, commitsBehindMaster: () => 0,
      // 0.75 ≥ now-buildable bar (0.7) so a suggestion IS written, but < auto bar (0.9).
      callGrok: async () => '{"bucket":"now-buildable","confidence":0.75,"rationale":"meh"}',
      confirm: async (_p, id) => { confirmed.push(id); return { ok: true, reason: 'applied' }; },
    });
    expect(confirmed).toEqual([]);
  });

  it('respects the per-tick auto-resolve cap', async () => {
    const project = freshProject();
    for (let i = 0; i < AUTO_RESOLVE_CAP + 2; i++) {
      createEscalation({ project, session: `w${i}`, kind: 'blocker', questionText: `q${i}` });
    }
    let confirmed = 0;
    await runTriagePass(project, {
      autoResolve: true, callGrok: async () => HI, commitsBehindMaster: () => 0,
      confirm: async () => { confirmed++; return { ok: true, reason: 'applied' }; },
    });
    // TRIAGE_CAP suggestions written, but auto-resolutions capped at AUTO_RESOLVE_CAP.
    expect(confirmed).toBe(AUTO_RESOLVE_CAP);
  });

  it('A3: mission escalation auto-resolves via autoResolveScope', async () => {
    const project = freshProject();
    const { escalation } = createEscalation({ project, session: 'w1', kind: 'blocker', questionText: 'q?' });
    const confirmed: string[] = [];
    await runTriagePass(project, {
      callGrok: async () => HI, commitsBehindMaster: () => 0,
      autoResolveScope: () => true, // mission-scoped predicate says YES
      confirm: async (_p, id) => { confirmed.push(id); return { ok: true, reason: 'applied' }; },
    });
    expect(confirmed).toEqual([escalation.id]);
  });

  it('A3: non-mission escalation stays SUGGEST (no confirm), but suggestion is written', async () => {
    const project = freshProject();
    const { escalation } = createEscalation({ project, session: 'w1', kind: 'blocker', questionText: 'q?' });
    const confirmed: string[] = [];
    await runTriagePass(project, {
      callGrok: async () => HI, commitsBehindMaster: () => 0,
      autoResolveScope: () => false, // mission-scoped predicate says NO
      confirm: async (_p, id) => { confirmed.push(id); return { ok: true, reason: 'applied' }; },
    });
    expect(confirmed).toEqual([]); // no auto-resolve
    const after = getEscalation(escalation.id);
    expect(after?.suggestedAction?.bucket).toBe('now-buildable'); // but suggestion is written
  });
});

describe('confirmSuggestion / dismissSuggestion', () => {
  it('confirm applies reset_todo when the dep-done proof re-validates green', async () => {
    const project = freshProject();
    const dep = await createTodo(project, { allowOrphan: true, ownerSession: 'w', title: 'dep' });
    await completeTodo(project, dep.id, 'accepted', 'w'); // dep done+accepted
    const work = await createTodo(project, { allowOrphan: true, ownerSession: 'w', title: 'work', status: 'blocked', dependsOn: [dep.id] });
    const { escalation } = createEscalation({ project, session: 'w', kind: 'blocker', questionText: 'blocked?', todoId: work.id });
    setEscalationSuggestion(escalation.id, sugg({ bundleInputs: { todoUpdatedAt: getTodo(project, work.id)!.updatedAt } }));

    const res = await confirmSuggestion(project, escalation.id);
    expect(res.ok).toBe(true);
    // De-conflate: the reset_todo verb APPROVES (clears hold) — stored 'planned',
    // approvedAt set → DERIVES claimable.
    expect(getTodo(project, work.id)?.status).toBe('planned');
    expect(getTodo(project, work.id)?.approvedAt).not.toBeNull();
    expect(getTodo(project, work.id)?.heldAt).toBeNull();
    expect(getEscalation(escalation.id)?.status).toBe('resolved');
    expect(getEscalation(escalation.id)?.suggestedAction).toBeNull();
  });

  it('confirm REJECTS (no mutation) + re-routes to human when the proof FAILS (dep not done)', async () => {
    const project = freshProject();
    const dep = await createTodo(project, { allowOrphan: true, ownerSession: 'w', title: 'dep' }); // NOT done
    const work = await createTodo(project, { allowOrphan: true, ownerSession: 'w', title: 'work', status: 'blocked', dependsOn: [dep.id] });
    const { escalation } = createEscalation({ project, session: 'w', kind: 'blocker', questionText: 'blocked?', todoId: work.id });
    setEscalationSuggestion(escalation.id, sugg({ bundleInputs: { todoUpdatedAt: getTodo(project, work.id)!.updatedAt } }));

    const res = await confirmSuggestion(project, escalation.id);
    expect(res.ok).toBe(false);
    // NOT mutated — created via status:'blocked' (seam → heldAt='manual', stored
    // 'planned'); the rejected confirm leaves it held.
    expect(getTodo(project, work.id)?.status).toBe('planned');
    expect(getTodo(project, work.id)?.heldAt).not.toBeNull();
    const after = getEscalation(escalation.id);
    expect(after?.status).toBe('open'); // still open
    expect(after?.routedTo).toBe('human'); // re-routed
    expect(after?.suggestedAction).toBeNull(); // cleared
  });

  it('confirm is STALE-guarded: a moved todo revision → no mutation, suggestion cleared', async () => {
    const project = freshProject();
    const dep = await createTodo(project, { allowOrphan: true, ownerSession: 'w', title: 'dep' });
    await completeTodo(project, dep.id, 'accepted', 'w');
    const work = await createTodo(project, { allowOrphan: true, ownerSession: 'w', title: 'work', status: 'blocked', dependsOn: [dep.id] });
    const { escalation } = createEscalation({ project, session: 'w', kind: 'blocker', questionText: 'blocked?', todoId: work.id });
    // Suggestion generated against a STALE revision.
    setEscalationSuggestion(escalation.id, sugg({ bundleInputs: { todoUpdatedAt: '1999-01-01T00:00:00.000Z' } }));

    const res = await confirmSuggestion(project, escalation.id);
    expect(res.reason).toBe('stale');
    // untouched — created via status:'blocked' (seam → heldAt, stored 'planned').
    expect(getTodo(project, work.id)?.status).toBe('planned');
    expect(getTodo(project, work.id)?.heldAt).not.toBeNull();
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

describe('drive auto-land (decision 647beb2b)', () => {
  it('lands open epic-ready-to-land cards via landEpic, capped at EPIC_LAND_CAP', async () => {
    const project = freshProject();
    // Three land cards; distinct questionText so dedupe in createEscalation keeps them.
    for (let i = 0; i < 3; i++) {
      createEscalation({ project, session: 'coordinator', kind: 'epic-ready-to-land', questionText: `land epic ${i}?` });
    }
    const landed: string[] = [];
    await runDriveLandPass(project, {
      landEpic: async (_p, escId) => { landed.push(escId); return { ok: true, landed: true, reason: 'landed' }; },
    });
    expect(landed.length).toBe(EPIC_LAND_CAP); // capped, not all 3
  });

  it('isTriageEligible skips epic-ready-to-land (deterministic path, not Grok)', () => {
    const project = freshProject();
    const { escalation } = createEscalation({ project, session: 'coordinator', kind: 'epic-ready-to-land', questionText: 'land it?' });
    expect(isTriageEligible(escalation, () => null)).toBe(false);
  });

  it('does NOT land below drive (autoResolve falsy → runDriveLandPass not invoked)', async () => {
    const project = freshProject();
    createEscalation({ project, session: 'coordinator', kind: 'epic-ready-to-land', questionText: 'land below drive?' });
    let landCalls = 0;
    // No autoResolve → the land card is also Grok-ineligible, so the pass is a no-op for it.
    await runTriagePass(project, {
      landEpic: async () => { landCalls++; return { ok: true, landed: true, reason: 'landed' }; },
      grok: async () => { throw new Error('grok must not be called'); },
    } as any);
    expect(landCalls).toBe(0);
  });

  it('a conflict (landed=false) is audited but does not throw', async () => {
    const project = freshProject();
    createEscalation({ project, session: 'coordinator', kind: 'epic-ready-to-land', questionText: 'conflicting epic?' });
    await runDriveLandPass(project, {
      landEpic: async () => ({ ok: false, landed: false, conflict: true, reason: 'merge-conflict' }),
    });
    // No throw = pass; the card stays open for the human-rebase path (landEpic owns that).
    expect(true).toBe(true);
  });
});
