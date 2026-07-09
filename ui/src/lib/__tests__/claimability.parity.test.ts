import { describe, it, expect } from 'vitest';
import * as ui from '../claimability';
import * as server from '@server/services/claimability.ts';
import type { SessionTodo } from '@/types/sessionTodo';
import cases from '../../../../src/services/__tests__/fixtures/claimability-cases.json';

type ServerTodo = Parameters<typeof server.claimReason>[0];

function uiMk(over: Partial<SessionTodo> = {}): SessionTodo {
  return {
    id: 'T', ownerSession: 's', assigneeSession: null, assigneeKind: 'agent',
    title: 't', description: null, status: 'planned', completed: false, priority: null,
    dueDate: null, parentId: null, dependsOn: [], order: 0, link: null,
    createdAt: '', updatedAt: '', completedAt: null, asanaGid: null,
    kind: 'leaf',
    ...over,
  };
}

function serverMk(over: Partial<ServerTodo> = {}): ServerTodo {
  return {
    id: 'T', ownerSession: 's', assigneeSession: null, assigneeKind: 'agent',
    title: 't', description: null, status: 'planned', completed: false, priority: null,
    dueDate: null, parentId: null, dependsOn: [], order: 0, link: null,
    createdAt: '', updatedAt: '', completedAt: null, asanaGid: null, sessionName: null,
    executedBySession: null, blueprintId: null, type: null, kind: 'leaf', targetProject: null,
    acceptanceStatus: null, claimedBy: null, claimToken: null, claimedAt: null,
    claimLeaseMs: null, claim: null, approvedAt: null, approvedBy: null, heldAt: null,
    heldReason: null, retryCount: 0, completedBy: null, objectRef: null, decisionRef: null,
    claimProbe: null,
    ...over,
  } as ServerTodo;
}

describe('claimability parity — server vs UI over the shared fixture', () => {
  it('fixture schemaVersion is 1', () => expect(cases.schemaVersion).toBe(1));

  for (const c of cases.cases) {
    it(`${c.name} — both sides agree`, () => {
      const uiTodos = c.todos.map((t) => uiMk(t as Partial<SessionTodo>));
      const svTodos = c.todos.map((t) => serverMk(t as Partial<ServerTodo>));
      const uiById = ui.buildById(uiTodos);
      const svById = new Map(svTodos.map((t) => [t.id, t]));
      const uiT = uiById.get(c.subject)!;
      const svT = svById.get(c.subject)!;

      const uiReason = ui.claimReason(uiT, uiById);
      const svReason = server.claimReason(svT, svById);

      // THE ASSERTION THAT MATTERS: the RESULTING REASON, not the boolean.
      expect(uiReason, `${c.name}: ${c.why}`).toBe(svReason);
      // …and both anchored to the fixture, so neither side can drift together.
      expect(svReason, c.why).toBe(c.expect.claimReason);
      expect(ui.derivedStatus(uiT, uiById), c.why).toBe(server.derivedStatus(svT, svById));
      expect(ui.isClaimable(uiT, uiById), c.why).toBe(server.isClaimable(svT, svById));
    });
  }
});

describe('claimability parity — the case that distinguishes the two orderings', () => {
  const c = (cases.cases as Array<Record<string, any>>).find(
    (x) => x.name === 'dep-rejected-outranks-dep-dropped'
  );

  it('the both-blockers case exists in the shared fixture', () => {
    expect(
      c,
      'a todo blocked by BOTH a rejected and a dropped dep is the ONLY row that ' +
        'distinguishes the two gate orderings; its absence is why the divergence shipped'
    ).toBeDefined();
  });

  it('its subject depends on both a rejected and a dropped dep', () => {
    const byId = new Map(c!.todos.map((t: Record<string, any>) => [t.id, t]));
    const subj = byId.get(c!.subject)!;
    const deps = (subj.dependsOn ?? []).map((id: string) => byId.get(id)!);
    expect(deps.some((d: Record<string, any>) => d.acceptanceStatus === 'rejected')).toBe(true);
    expect(deps.some((d: Record<string, any>) => d.status === 'dropped')).toBe(true);
  });

  it('both predicates report dep-rejected', () => {
    const uiTodos = c!.todos.map((t: Record<string, any>) => uiMk(t as Partial<SessionTodo>));
    const svTodos = c!.todos.map((t: Record<string, any>) => serverMk(t as Partial<ServerTodo>));
    const uiById = ui.buildById(uiTodos);
    const svById = new Map(svTodos.map((t) => [t.id, t]));
    const uiT = uiById.get(c!.subject)!;
    const svT = svById.get(c!.subject)!;

    expect(ui.claimReason(uiT, uiById)).toBe('dep-rejected');
    expect(server.claimReason(svT, svById)).toBe('dep-rejected');
  });
});
