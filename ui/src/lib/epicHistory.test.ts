import { describe, it, expect } from 'vitest';
import {
  buildEpicTimeline,
  escalationRowLifecycle,
  toEscalationEntry,
  isEmptyTimeline,
  presentationFor,
  type EscalationHistoryRow,
  type DecisionRecordLite,
} from './epicHistory';

let seq = 0;
function row(p: Partial<EscalationHistoryRow>): EscalationHistoryRow {
  return {
    id: p.id ?? `e${++seq}`,
    project: p.project ?? '/repo',
    session: p.session ?? 'backend-1',
    kind: p.kind ?? 'decision',
    status: p.status ?? 'open',
    questionText: p.questionText ?? 'q?',
    todoId: p.todoId ?? null,
    epicId: p.epicId ?? 'EPIC-1',
    createdAt: p.createdAt ?? 1000,
    resolvedAt: p.resolvedAt ?? null,
    timeToResolutionMs: p.timeToResolutionMs ?? null,
    routedTo: p.routedTo ?? 'human',
    stewardAttempts: p.stewardAttempts ?? 0,
    suggestedAction: p.suggestedAction ?? null,
    resolutionActor: p.resolutionActor ?? null,
    recurrenceCount: p.recurrenceCount ?? 1,
  };
}

function rec(p: Partial<DecisionRecordLite>): DecisionRecordLite {
  return {
    id: p.id ?? `d${++seq}`,
    kind: p.kind ?? 'decision',
    status: p.status ?? 'active',
    title: p.title ?? 'a decision',
    rationale: p.rationale ?? null,
    epicId: p.epicId ?? 'EPIC-1',
    createdAt: p.createdAt ?? 1000,
    updatedAt: p.updatedAt ?? 1000,
  };
}

describe('escalationRowLifecycle (reuses the shared classifier)', () => {
  it('open + untouched → open', () => {
    expect(escalationRowLifecycle(row({ status: 'open' }))).toBe('open');
  });

  it('open + steward route → escalated-to-human', () => {
    expect(escalationRowLifecycle(row({ status: 'open', routedTo: 'steward' }))).toBe('escalated-to-human');
  });

  it('open + a Grok suggestion → ai-suggested', () => {
    const r = row({ status: 'open', suggestedAction: { bucket: 'stale', confidence: 0.7, rationale: 'dep merged' } });
    expect(escalationRowLifecycle(r)).toBe('ai-suggested');
  });

  it('resolved + steward route → ai-resolved (the AI auto-resolved it)', () => {
    const r = row({ status: 'resolved', routedTo: 'steward', resolvedAt: 2000 });
    expect(escalationRowLifecycle(r)).toBe('ai-resolved');
  });

  it('resolved + human route → human-resolved', () => {
    const r = row({ status: 'resolved', routedTo: 'human', resolvedAt: 2000 });
    expect(escalationRowLifecycle(r)).toBe('human-resolved');
  });
});

describe('toEscalationEntry', () => {
  it('carries lifecycle + presentation + rationale + resolver', () => {
    const r = row({
      id: 'x',
      status: 'resolved',
      routedTo: 'steward',
      resolvedAt: 2000,
      resolutionActor: 'daemon-auto',
      suggestedAction: { bucket: 'stale', confidence: 0.8, rationale: 'dep merged' },
    });
    const e = toEscalationEntry(r);
    expect(e.type).toBe('escalation');
    expect(e.lifecycle).toBe('ai-resolved');
    expect(e.presentation.label).toBe('AI resolved');
    expect(e.rationale).toBe('dep merged');
    expect(e.resolutionActor).toBe('daemon-auto');
    expect(e.ts).toBe(1000); // sort key = createdAt
  });
});

describe('presentationFor', () => {
  it('maps each lifecycle state to a label; ai-handling shows a spinner', () => {
    expect(presentationFor('open').label).toBe('Open');
    expect(presentationFor('ai-handling').spinner).toBe(true);
    expect(presentationFor('escalated-to-human').label).toContain('Needs you');
    expect(presentationFor('ai-resolved').label).toBe('AI resolved');
    expect(presentationFor('human-resolved').label).toBe('Resolved');
  });
});

describe('buildEpicTimeline', () => {
  it('merges escalations + decision records, newest-first by default', () => {
    const resp = {
      rows: [
        row({ id: 'e-early', createdAt: 100 }),
        row({ id: 'e-late', createdAt: 400 }),
      ],
      decisionRecords: [
        rec({ id: 'd-mid', createdAt: 250 }),
        rec({ id: 'd-latest', createdAt: 500 }),
      ],
    };
    const tl = buildEpicTimeline(resp);
    expect(tl.map((t) => t.id)).toEqual(['d-latest', 'e-late', 'd-mid', 'e-early']);
    expect(tl.map((t) => t.type)).toEqual(['decision', 'escalation', 'decision', 'escalation']);
  });

  it('honours ascending order', () => {
    const resp = {
      rows: [row({ id: 'a', createdAt: 300 })],
      decisionRecords: [rec({ id: 'b', createdAt: 100 })],
    };
    expect(buildEpicTimeline(resp, { order: 'asc' }).map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('includes RESOLVED escalations with their triage outcome, not just open', () => {
    const resp = {
      rows: [
        row({ id: 'open1', status: 'open', createdAt: 100 }),
        row({ id: 'aiRes', status: 'resolved', routedTo: 'steward', resolvedAt: 250, createdAt: 200 }),
      ],
      decisionRecords: [],
    };
    const tl = buildEpicTimeline(resp);
    const resolved = tl.find((t) => t.id === 'aiRes');
    expect(resolved).toBeDefined();
    expect(resolved!.type === 'escalation' && resolved!.lifecycle).toBe('ai-resolved');
  });

  it('empty/absent payload → empty timeline (empty state)', () => {
    expect(buildEpicTimeline(null)).toEqual([]);
    expect(buildEpicTimeline({})).toEqual([]);
    expect(buildEpicTimeline({ rows: [], decisionRecords: [] })).toEqual([]);
    expect(isEmptyTimeline(buildEpicTimeline(null))).toBe(true);
    expect(isEmptyTimeline(buildEpicTimeline({ rows: [row({})] }))).toBe(false);
  });
});
