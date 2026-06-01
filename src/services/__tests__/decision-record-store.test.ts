import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDecisionRecord, getDecisionRecord, listDecisionRecords,
  approveDecisionRecord, supersedeDecisionRecord, getActiveConstraints, _closeProject,
} from '../decision-record-store';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'dr-store-')); });
afterEach(() => { _closeProject(project); rmSync(project, { recursive: true, force: true }); });

describe('decision-record-store', () => {
  it('a decision is auto-active; a constraint starts proposed (human gate)', () => {
    const d = createDecisionRecord(project, { kind: 'decision', title: 'use bun:sqlite' });
    const c = createDecisionRecord(project, { kind: 'constraint', title: 'no cross-epic imports' });
    expect(d.status).toBe('active');
    expect(c.status).toBe('proposed');
  });

  it('round-trips arrays (alternatives, linkedTodos)', () => {
    const d = createDecisionRecord(project, {
      kind: 'decision', title: 't', alternatives: ['x', 'y'], linkedTodos: ['t1', 't2'], rationale: 'because',
    });
    const got = getDecisionRecord(project, d.id)!;
    expect(got.alternatives).toEqual(['x', 'y']);
    expect(got.linkedTodos).toEqual(['t1', 't2']);
    expect(got.rationale).toBe('because');
  });

  it('approveDecisionRecord moves a proposed constraint to active', () => {
    const c = createDecisionRecord(project, { kind: 'constraint', title: 'c' });
    const a = approveDecisionRecord(project, c.id, 'human')!;
    expect(a.status).toBe('active');
    expect(a.approvedBy).toBe('human');
  });

  it('supersede marks superseded + records supersededBy', () => {
    const old = createDecisionRecord(project, { kind: 'decision', title: 'old' });
    const neo = createDecisionRecord(project, { kind: 'decision', title: 'new' });
    const sup = supersedeDecisionRecord(project, old.id, neo.id)!;
    expect(sup.status).toBe('superseded');
    expect(sup.supersededBy).toBe(neo.id);
  });

  it('listDecisionRecords filters by epicId/kind/status', () => {
    createDecisionRecord(project, { kind: 'constraint', title: 'proj', epicId: null });
    createDecisionRecord(project, { kind: 'constraint', title: 'epicX', epicId: 'X' });
    expect(listDecisionRecords(project, { epicId: 'X' }).map((r) => r.title)).toEqual(['epicX']);
    expect(listDecisionRecords(project, { epicId: null }).map((r) => r.title)).toEqual(['proj']);
    expect(listDecisionRecords(project, { kind: 'constraint' }).length).toBe(2);
  });

  it('getActiveConstraints returns epic + project-level active constraints only', () => {
    const proj = createDecisionRecord(project, { kind: 'constraint', title: 'proj', epicId: null });
    const epicX = createDecisionRecord(project, { kind: 'constraint', title: 'X', epicId: 'X' });
    createDecisionRecord(project, { kind: 'constraint', title: 'Y', epicId: 'Y' });
    const aDecision = createDecisionRecord(project, { kind: 'decision', title: 'd', epicId: 'X' });
    // proposed constraints are not active yet
    expect(getActiveConstraints(project, 'X').length).toBe(0);
    approveDecisionRecord(project, proj.id, 'h');
    approveDecisionRecord(project, epicX.id, 'h');
    const inScope = getActiveConstraints(project, 'X').map((r) => r.title).sort();
    expect(inScope).toEqual(['X', 'proj']); // not 'Y', not the decision
    void aDecision;
  });
});
