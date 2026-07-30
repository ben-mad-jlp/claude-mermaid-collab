import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'crit-drop-card-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import { shouldRaiseDropCard, raiseCriterionDropCard } from '../criterion-drop-card';
import { listEscalations, _closeDb } from '../supervisor-store';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

describe('criterion-drop-card', () => {
  it('raises exactly one human card when dropping a capability criterion', () => {
    const calls: any[] = [];
    const stub = { createEscalation: (input: any) => { calls.push(input); return { escalation: {} as any, isNew: true }; } };
    const result = raiseCriterionDropCard(stub, {
      project: '/proj-a', session: 'sess-1', missionId: 'mission-a',
      criterion: { id: 'crit-a', text: 'do the thing', type: 'capability' },
      reason: 'no longer needed',
    });
    expect(calls.length).toBe(1);
    expect(calls[0].audience).toBe('human');
    expect(result).toEqual({ isNew: true });
  });

  it('raises 0 cards when dropping a one-shot criterion', () => {
    const calls: any[] = [];
    const stub = { createEscalation: (input: any) => { calls.push(input); return { escalation: {} as any, isNew: true }; } };
    const result = raiseCriterionDropCard(stub, {
      project: '/proj-a', session: 'sess-1', missionId: 'mission-a',
      criterion: { id: 'crit-b', text: 'do the thing', type: 'one-shot' as any },
      reason: 'no longer needed',
    });
    expect(calls.length).toBe(0);
    expect(result).toBeNull();
  });

  it('raises 0 cards for an epic/leaf dropped under an already-dropped parent', () => {
    const calls: any[] = [];
    const stub = { createEscalation: (input: any) => { calls.push(input); return { escalation: {} as any, isNew: true }; } };
    const epicResult = raiseCriterionDropCard(stub, {
      subject: 'epic', parentDropped: true, project: '/proj-a', session: 'sess-1', missionId: 'mission-a', reason: 'cascade',
    });
    const leafResult = raiseCriterionDropCard(stub, {
      subject: 'leaf', parentDropped: true, project: '/proj-a', session: 'sess-1', missionId: 'mission-a', reason: 'cascade',
    });
    expect(calls.length).toBe(0);
    expect(epicResult).toBeNull();
    expect(leafResult).toBeNull();

    expect(shouldRaiseDropCard({ subject: 'epic', parentDropped: true })).toBe(false);
    expect(shouldRaiseDropCard({ subject: 'epic', parentDropped: false })).toBe(false);
    expect(shouldRaiseDropCard({ subject: 'leaf', parentDropped: true })).toBe(false);
    expect(shouldRaiseDropCard({ subject: 'leaf', parentDropped: false })).toBe(false);
  });

  it('a repeat drop of the same criterion returns isNew:false and raises no second open card', () => {
    const project = '/proj-repeat-drop';
    const missionId = 'mission-repeat';
    const criterion = { id: 'crit-repeat', text: 'stable text', type: 'capability' as const };

    const first = raiseCriterionDropCard({}, { project, session: 'sess-1', missionId, criterion, reason: 'first drop' });
    const second = raiseCriterionDropCard({}, { project, session: 'sess-1', missionId, criterion, reason: 'second drop' });

    expect(first).toEqual({ isNew: true });
    expect(second).toEqual({ isNew: false });

    const open = listEscalations('open').filter((e) => e.project === project);
    expect(open.length).toBe(1);
    expect(open[0].conditionKey).toBe(`criterion-dropped:${missionId}:${criterion.id}`);
  });
});
