// Pure summarizeGate tests — no DB. Feeds hand-built audit entries + todos.
import { describe, test, expect } from 'bun:test';
import type { Todo, TodoStatus } from '../todo-store';
import type { SupervisorAuditEntry } from '../supervisor-store';
import { summarizeGate, DEFAULT_GATE_DESC } from '../gate-status';

let seq = 0;
function todo(partial: Partial<Todo> & { id?: string; title: string; status?: TodoStatus }): Todo {
  const status = partial.status ?? 'done';
  return {
    ownerSession: 's',
    assigneeSession: null,
    assigneeKind: 'agent',
    description: null,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    sessionName: null,
    executedBySession: null,
    blueprintId: null,
    type: null,
    targetProject: null,
    acceptanceStatus: null,
    claimedBy: null,
    claimToken: null,
    claimedAt: null,
    claimLeaseMs: null,
    retryCount: 0,
    completedBy: null,
    objectRef: null,
    decisionRef: null,
    claimProbe: null,
    ...partial,
    id: partial.id ?? `t${seq++}`,
    status,
  } as Todo;
}

function audit(partial: Partial<SupervisorAuditEntry> & { detail: string | null }): SupervisorAuditEntry {
  return {
    id: `a${seq++}`,
    ts: 1000 + seq,
    kind: 'complete',
    project: 'P',
    session: 's',
    serverId: '',
    ...partial,
  };
}

describe('summarizeGate — gate config', () => {
  test('reports a declared gateCommand', () => {
    const s = summarizeGate('P', '  npx tsc --noEmit && bun test  ', [], []);
    expect(s.gateConfigured).toBe(true);
    expect(s.gateCommand).toBe('npx tsc --noEmit && bun test'); // trimmed
    expect(s.gateDescription).toBe('npx tsc --noEmit && bun test');
  });

  test('null / blank gateCommand → default fallback', () => {
    for (const cmd of [null, '', '   ']) {
      const s = summarizeGate('P', cmd, [], []);
      expect(s.gateConfigured).toBe(false);
      expect(s.gateCommand).toBeNull();
      expect(s.gateDescription).toBe(DEFAULT_GATE_DESC);
    }
  });
});

describe('summarizeGate — recent results', () => {
  test('maps accepted/rejected audit entries to pass/fail enriched with todo', () => {
    const t1 = todo({ id: 'todo-1', title: 'Build X', acceptanceStatus: 'accepted' });
    const t2 = todo({ id: 'todo-2', title: 'Build Y', acceptanceStatus: 'rejected' });
    const entries = [
      audit({ detail: JSON.stringify({ todoId: 'todo-1', acceptance: 'accepted' }) }),
      audit({ detail: JSON.stringify({ todoId: 'todo-2', acceptance: 'rejected' }) }),
    ];
    const s = summarizeGate('P', 'cmd', entries, [t1, t2]);
    expect(s.recent).toHaveLength(2);
    const [r1, r2] = s.recent;
    expect(r1).toMatchObject({ todoId: 'todo-1', title: 'Build X', passed: true, acceptance: 'accepted', acceptanceStatus: 'accepted' });
    expect(r1.reason).toContain('passed');
    expect(r2).toMatchObject({ todoId: 'todo-2', title: 'Build Y', passed: false, acceptance: 'rejected' });
    expect(r2.reason).toContain('failed');
  });

  test('unknown todo → null title, still reported', () => {
    const entries = [audit({ detail: JSON.stringify({ todoId: 'gone', acceptance: 'accepted' }) })];
    const s = summarizeGate('P', null, entries, []);
    expect(s.recent[0]).toMatchObject({ todoId: 'gone', title: null, passed: true });
  });

  test('null acceptance → not passed, descriptive reason', () => {
    const entries = [audit({ detail: JSON.stringify({ todoId: 'todo-3', acceptance: null }) })];
    const s = summarizeGate('P', null, entries, [todo({ id: 'todo-3', title: 'Z' })]);
    expect(s.recent[0].passed).toBe(false);
    expect(s.recent[0].reason).toContain('without an explicit');
  });

  test('skips entries with missing / unparseable detail', () => {
    const entries = [
      audit({ detail: null }),
      audit({ detail: 'not json' }),
      audit({ detail: JSON.stringify({ acceptance: 'accepted' }) }), // no todoId
      audit({ detail: JSON.stringify({ todoId: 'ok', acceptance: 'accepted' }) }),
    ];
    const s = summarizeGate('P', null, entries, []);
    expect(s.recent).toHaveLength(1);
    expect(s.recent[0].todoId).toBe('ok');
  });
});
