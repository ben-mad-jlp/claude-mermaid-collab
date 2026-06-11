// Pure-builder tests for src/services/escalation-history.ts — the escalation rows,
// epic lookup, and decision lookup are injected, so these are hermetic (no DB).
// Cover: open+resolved trail, epic/project/kind/route/time filters, recurrence,
// resolution actor, and the summary aggregate (auto-resolved vs escalated-to-human,
// avg attempts, median time-to-resolution, grouping).
import { describe, test, expect } from 'bun:test';
import type { Escalation, EscalationDecision } from '../supervisor-store';
import {
  buildHistoryRows,
  summarizeHistory,
  computeRecurrence,
  median,
  type EscalationHistoryFilter,
} from '../escalation-history';

let seq = 0;
function esc(p: Partial<Escalation> & { questionText?: string }): Escalation {
  return {
    id: p.id ?? `e${++seq}`,
    project: p.project ?? '/repo',
    session: p.session ?? 'backend-1',
    kind: p.kind ?? 'decision',
    questionText: p.questionText ?? 'q?',
    status: p.status ?? 'open',
    createdAt: p.createdAt ?? 1000,
    resolvedAt: p.resolvedAt ?? null,
    serverId: '',
    todoId: p.todoId ?? null,
    options: null,
    recommended: null,
    ui: null,
    routedTo: p.routedTo ?? 'human',
    operatorGated: 0,
    proof: null,
    stewardAttempts: p.stewardAttempts ?? 0,
    suggestedAction: p.suggestedAction ?? null,
  };
}

const noEpic = () => null;
const noDecision = () => null;

describe('median', () => {
  test('odd, even, empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('computeRecurrence', () => {
  test('counts escalations sharing project+session+questionText', () => {
    const a = esc({ id: 'a', questionText: 'same' });
    const b = esc({ id: 'b', questionText: 'same' });
    const c = esc({ id: 'c', questionText: 'different' });
    const r = computeRecurrence([a, b, c]);
    expect(r.get('a')).toBe(2);
    expect(r.get('b')).toBe(2);
    expect(r.get('c')).toBe(1);
  });
});

describe('buildHistoryRows', () => {
  test('includes both open and resolved (unlike escalation_list), newest-first', () => {
    const open = esc({ id: 'o', status: 'open', createdAt: 100 });
    const resolved = esc({ id: 'r', status: 'resolved', createdAt: 200, resolvedAt: 250 });
    const rows = buildHistoryRows([open, resolved], {}, noEpic, noDecision);
    expect(rows.map((r) => r.id)).toEqual(['r', 'o']); // newest-first by createdAt
    expect(rows.find((r) => r.id === 'r')!.timeToResolutionMs).toBe(50);
    expect(rows.find((r) => r.id === 'o')!.timeToResolutionMs).toBeNull();
  });

  test('epic filter resolves via injected epicOf and narrows', () => {
    const inEpic = esc({ id: 'a', todoId: 't1' });
    const other = esc({ id: 'b', todoId: 't2' });
    const epicOf = (e: Escalation) => (e.todoId === 't1' ? 'EPIC-1' : 'EPIC-2');
    const rows = buildHistoryRows([inEpic, other], { epicId: 'EPIC-1' }, epicOf, noDecision);
    expect(rows.map((r) => r.id)).toEqual(['a']);
    expect(rows[0].epicId).toBe('EPIC-1');
  });

  test('project / kind / routedTo / time filters narrow correctly', () => {
    const all = [
      esc({ id: 'p1', project: '/x', kind: 'decision', routedTo: 'human', createdAt: 100 }),
      esc({ id: 'p2', project: '/y', kind: 'blocker', routedTo: 'steward', createdAt: 200 }),
      esc({ id: 'p3', project: '/x', kind: 'blocker', routedTo: 'steward', createdAt: 300 }),
    ];
    expect(buildHistoryRows(all, { project: '/x' }, noEpic, noDecision).map((r) => r.id).sort()).toEqual(['p1', 'p3']);
    expect(buildHistoryRows(all, { kind: 'blocker' }, noEpic, noDecision).map((r) => r.id).sort()).toEqual(['p2', 'p3']);
    expect(buildHistoryRows(all, { routedTo: 'steward' }, noEpic, noDecision).map((r) => r.id).sort()).toEqual(['p2', 'p3']);
    expect(buildHistoryRows(all, { since: 150, until: 250 }, noEpic, noDecision).map((r) => r.id)).toEqual(['p2']);
  });

  test('resolutionActor: decider handle, else daemon-auto for resolved steward route, else null', () => {
    const human = esc({ id: 'h', status: 'resolved', routedTo: 'human', resolvedAt: 5 });
    const auto = esc({ id: 'a', status: 'resolved', routedTo: 'steward', resolvedAt: 5 });
    const open = esc({ id: 'o', status: 'open', routedTo: 'steward' });
    const decisionOf = (id: string): EscalationDecision | null =>
      id === 'h' ? { escalationId: 'h', optionId: 'opt-a', note: null, decidedBy: 'ben', decidedAt: 5 } : null;
    const rows = buildHistoryRows([human, auto, open], {}, noEpic, decisionOf);
    expect(rows.find((r) => r.id === 'h')!.resolutionActor).toBe('ben');
    expect(rows.find((r) => r.id === 'h')!.decision?.optionId).toBe('opt-a');
    expect(rows.find((r) => r.id === 'a')!.resolutionActor).toBe('daemon-auto');
    expect(rows.find((r) => r.id === 'o')!.resolutionActor).toBeNull();
  });

  test('surfaces suggestedAction bucket+confidence+rationale when present', () => {
    const e = esc({
      id: 's',
      suggestedAction: {
        bucket: 'stale', verb: 'reset_todo', args: null, confidence: 0.8,
        rationale: 'dep merged', bundleInputs: {}, generatedAt: 1,
      },
    });
    const rows = buildHistoryRows([e], {}, noEpic, noDecision);
    expect(rows[0].suggestedAction).toEqual({ bucket: 'stale', confidence: 0.8, rationale: 'dep merged' });
  });
});

describe('summarizeHistory', () => {
  test('auto-resolved vs escalated-to-human, avg attempts, median TTR, grouping', () => {
    const rows = buildHistoryRows(
      [
        esc({ id: '1', routedTo: 'steward', status: 'resolved', resolvedAt: 110, createdAt: 100, stewardAttempts: 2, todoId: 't' }),
        esc({ id: '2', routedTo: 'human', status: 'resolved', resolvedAt: 140, createdAt: 100, stewardAttempts: 0, todoId: 't' }),
        esc({ id: '3', routedTo: 'steward', status: 'open', createdAt: 100, stewardAttempts: 4, todoId: 't' }),
      ],
      {},
      () => 'EPIC-9',
      noDecision,
    );
    const s = summarizeHistory(rows);
    expect(s.total).toBe(3);
    expect(s.byOutcome).toEqual({ autoResolved: 2, escalatedToHuman: 1 });
    expect(s.avgStewardAttempts).toBe(2); // (2+0+4)/3
    expect(s.medianTimeToResolutionMs).toBe(25); // resolved TTRs [10,40] → median 25
    expect(s.byStatus).toEqual({ resolved: 2, open: 1 });
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0].key).toBe('EPIC-9');
    expect(s.groups[0].total).toBe(3);
    expect(s.groups[0].autoResolved).toBe(2);
  });

  test('empty rows → zeroed summary, null median', () => {
    const s = summarizeHistory([]);
    expect(s.total).toBe(0);
    expect(s.avgStewardAttempts).toBe(0);
    expect(s.medianTimeToResolutionMs).toBeNull();
    expect(s.groups).toEqual([]);
  });
});
