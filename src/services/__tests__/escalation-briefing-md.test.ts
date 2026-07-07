/**
 * Unit tests for the DETERMINISTIC escalation-briefing markdown renderer + the
 * enriched packBundle fields.
 *
 * Pure: renderBundleMarkdown is string assembly; packBundle IO is injected.
 */

import { test, expect } from 'bun:test';
import { renderBundleMarkdown } from '../escalation-briefing-md';
import { packBundle, type TriageBundle, type TriageDeps } from '../grok-triage';
import type { Escalation } from '../supervisor-store';

function esc(overrides: Partial<Escalation> = {}): Escalation {
  return {
    id: 'e1',
    project: '/p',
    session: 'worker-1',
    kind: 'blocker',
    questionText: 'dep not done?',
    status: 'open',
    createdAt: 0,
    resolvedAt: null,
    serverId: '',
    todoId: 't1',
    options: null,
    recommended: null,
    ui: null,
    routedTo: 'human',
    operatorGated: 0,
    proof: null,
    stewardAttempts: 0,
    suggestedAction: null,
    triageInFlight: false,
    resolvedBy: null,
    ...overrides,
  } as Escalation;
}

function fullBundle(): TriageBundle {
  return {
    escalation: { id: 'e1', kind: 'blocker', questionText: 'Ship as-is or redesign?', todoId: 't1' },
    todo: {
      id: 't1', title: 'Wire up gizmo', status: 'blocked', retryCount: 4,
      acceptanceStatus: 'rejected', dependsOn: ['d1'], type: 'backend',
      targetProject: null, updatedAt: '2026-07-01T00:00:00.000Z',
    },
    deps: [{ id: 'd1', status: 'done', acceptanceStatus: 'accepted' }],
    git: { commitsBehindMaster: 3 },
    recentAudit: [],
    planGraph: {
      parentEpic: { id: 'ep1', title: 'Gizmo Epic', status: 'in_progress' },
      siblings: [{ id: 's1', title: 'Sibling A', status: 'done' }],
      dependents: [{ id: 'dep1', title: 'Downstream', status: 'blocked' }],
    },
    epicBranch: { epicId: 'ep1', ahead: 5, behind: 2, mergeable: false, landLeafDone: false, stranded: true },
    priorEscalations: [
      { kind: 'escalation.raise', session: 'worker-0', ts: 100, detail: '{"verdict":"reject"}' },
    ],
    raiseDetail: { verdict: 'reject', gate: 'tsc failed', conflicts: ['a.ts', 'b.ts'] },
  };
}

test('renders all sections + key facts for a full bundle', () => {
  const md = renderBundleMarkdown(fullBundle(), {
    options: [{ id: 'a', label: 'Ship' }, { id: 'b', label: 'Redesign', detail: 'start over' }],
  });
  expect(md).toContain('## Decision');
  expect(md).toContain('Ship as-is or redesign?');
  expect(md).toContain('**Ship**');
  expect(md).toContain('**Redesign** — start over');
  expect(md).toContain('## Situation');
  expect(md).toContain('Wire up gizmo');
  expect(md).toContain('Retry count: 4');
  expect(md).toContain('Commits behind master: 3');
  expect(md).toContain('Verdict: reject');
  expect(md).toContain('Conflict files: a.ts, b.ts');
  expect(md).toContain('## System context');
  expect(md).toContain('Gizmo Epic');
  expect(md).toContain('STRANDED');
  expect(md).toContain('Prior related escalations: 1');
});

test('renders a minimal bundle (no todo, no options) without throwing', () => {
  const minimal: TriageBundle = {
    escalation: { id: 'e2', kind: 'question', questionText: 'What now?', todoId: null },
    todo: null,
    deps: [],
    git: { commitsBehindMaster: null },
    recentAudit: [],
  };
  const md = renderBundleMarkdown(minimal);
  expect(md).toContain('## Decision');
  expect(md).toContain('What now?');
  expect(md).toContain('No linked todo.');
  expect(md).toContain('Plan graph: unavailable.');
  expect(md).toContain('Prior related escalations: 0');
});

test('deterministic: same input yields identical output', () => {
  const b = fullBundle();
  expect(renderBundleMarkdown(b)).toBe(renderBundleMarkdown(b));
});

test('packBundle enriched fields default gracefully when deps throw', () => {
  const throwing: TriageDeps = {
    getTodo: () => ({
      id: 't1', title: 'x', status: 'blocked', retryCount: 0,
      acceptanceStatus: null, dependsOn: [], type: null, targetProject: null,
      updatedAt: '2026-07-01T00:00:00.000Z',
    }),
    getDeps: () => [],
    listRecentAudit: () => { throw new Error('audit boom'); },
    commitsBehindMaster: () => { throw new Error('git boom'); },
    listAllTodos: () => { throw new Error('todos boom'); },
    getEpicBranch: () => { throw new Error('branch boom'); },
  };
  const b = packBundle('/p', esc(), throwing);
  expect(b.git.commitsBehindMaster).toBeNull();
  expect(b.recentAudit).toEqual([]);
  expect(b.planGraph).toBeNull();
  expect(b.epicBranch).toBeNull();
  expect(b.priorEscalations).toEqual([]);
  expect(b.raiseDetail).toBeNull();
  // And the renderer tolerates the degraded bundle.
  expect(() => renderBundleMarkdown(b)).not.toThrow();
});

test('packBundle derives plan graph + prior escalations from injected deps', () => {
  const deps: TriageDeps = {
    getTodo: () => ({
      id: 't1', title: 'target', status: 'blocked', retryCount: 1,
      acceptanceStatus: null, dependsOn: [], type: null, targetProject: null,
      updatedAt: '2026-07-01T00:00:00.000Z',
    }),
    getDeps: () => [],
    listAllTodos: () => [
      { id: 'ep1', title: 'Epic', status: 'in_progress', parentId: null, dependsOn: [] },
      { id: 't1', title: 'target', status: 'blocked', parentId: 'ep1', dependsOn: [] },
      { id: 's1', title: 'sibling', status: 'done', parentId: 'ep1', dependsOn: [] },
      { id: 'x1', title: 'downstream', status: 'planned', parentId: 'ep1', dependsOn: ['t1'] },
    ],
    getEpicBranch: () => ({ epicId: 'ep1', ahead: 1, behind: 0, mergeable: true, landLeafDone: false, stranded: true }),
    listRecentAudit: () => [
      { kind: 'escalation.raise', session: 'w', detail: '{"todoId":"t1","verdict":"reject"}', ts: 200 },
      { kind: 'other', session: 'w', detail: 'noise', ts: 150 },
    ],
    commitsBehindMaster: () => 0,
  };
  const b = packBundle('/p', esc(), deps);
  expect(b.planGraph?.parentEpic?.id).toBe('ep1');
  expect(b.planGraph?.siblings.map((s) => s.id).sort()).toEqual(['s1', 'x1']);
  expect(b.planGraph?.dependents.map((d) => d.id)).toEqual(['x1']);
  expect(b.epicBranch?.stranded).toBe(true);
  expect(b.priorEscalations?.length).toBe(1);
  expect((b.raiseDetail as { verdict?: string })?.verdict).toBe('reject');
});
