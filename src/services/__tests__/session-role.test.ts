// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect } from 'bun:test';
import { resolveSessionRole, type SessionRoleDeps } from '../session-role';
import type { MissionSummary } from '../mission-store';

describe('session-role: resolveSessionRole', () => {
  test('owner of an active non-terminal mission → "conductor"', () => {
    const deps: SessionRoleDeps = {
      listMissions: () => [
        {
          node: { id: 'm1', title: '[MISSION] Test', status: 'in_progress' },
          ownerSession: 'sess1',
          assigneeSession: null,
          mission: { active: true, phase: 'execute' } as any,
          rollup: {} as any,
          criteria: [],
          epics: [],
        } as MissionSummary,
      ],
    };
    expect(resolveSessionRole('proj', 'sess1', deps)).toBe('conductor');
  });

  test('assignee (not owner) of an active non-terminal mission → "conductor"', () => {
    const deps: SessionRoleDeps = {
      listMissions: () => [
        {
          node: { id: 'm1', title: '[MISSION] Test', status: 'in_progress' },
          ownerSession: 'other',
          assigneeSession: 'sess2',
          mission: { active: true, phase: 'discover' } as any,
          rollup: {} as any,
          criteria: [],
          epics: [],
        } as MissionSummary,
      ],
    };
    expect(resolveSessionRole('proj', 'sess2', deps)).toBe('conductor');
  });

  test('active: false mission → null', () => {
    const deps: SessionRoleDeps = {
      listMissions: () => [
        {
          node: { id: 'm1', title: '[MISSION] Test', status: 'in_progress' },
          ownerSession: 'sess1',
          assigneeSession: null,
          mission: { active: false, phase: 'execute' } as any,
          rollup: {} as any,
          criteria: [],
          epics: [],
        } as MissionSummary,
      ],
    };
    expect(resolveSessionRole('proj', 'sess1', deps)).toBeNull();
  });

  test('terminal phase "converged" → null', () => {
    const deps: SessionRoleDeps = {
      listMissions: () => [
        {
          node: { id: 'm1', title: '[MISSION] Test', status: 'done' },
          ownerSession: 'sess1',
          assigneeSession: null,
          mission: { active: true, phase: 'converged' } as any,
          rollup: {} as any,
          criteria: [],
          epics: [],
        } as MissionSummary,
      ],
    };
    expect(resolveSessionRole('proj', 'sess1', deps)).toBeNull();
  });

  test('terminal phase "stopped" → null', () => {
    const deps: SessionRoleDeps = {
      listMissions: () => [
        {
          node: { id: 'm1', title: '[MISSION] Test', status: 'in_progress' },
          ownerSession: 'sess1',
          assigneeSession: null,
          mission: { active: true, phase: 'stopped' } as any,
          rollup: {} as any,
          criteria: [],
          epics: [],
        } as MissionSummary,
      ],
    };
    expect(resolveSessionRole('proj', 'sess1', deps)).toBeNull();
  });

  test('mission owned by different session → null', () => {
    const deps: SessionRoleDeps = {
      listMissions: () => [
        {
          node: { id: 'm1', title: '[MISSION] Test', status: 'in_progress' },
          ownerSession: 'other-session',
          assigneeSession: null,
          mission: { active: true, phase: 'execute' } as any,
          rollup: {} as any,
          criteria: [],
          epics: [],
        } as MissionSummary,
      ],
    };
    expect(resolveSessionRole('proj', 'sess1', deps)).toBeNull();
  });

  test('no missions at all → null', () => {
    const deps: SessionRoleDeps = {
      listMissions: () => [],
    };
    expect(resolveSessionRole('proj', 'sess1', deps)).toBeNull();
  });

  test('listMissions throws → null (fails open)', () => {
    const deps: SessionRoleDeps = {
      listMissions: () => {
        throw new Error('database error');
      },
    };
    expect(resolveSessionRole('proj', 'sess1', deps)).toBeNull();
  });

  test('multiple missions, only one active → resolves correctly', () => {
    const deps: SessionRoleDeps = {
      listMissions: () => [
        {
          node: { id: 'm1', title: '[MISSION] Old', status: 'done' },
          ownerSession: 'sess1',
          assigneeSession: null,
          mission: { active: false, phase: 'converged' } as any,
          rollup: {} as any,
          criteria: [],
          epics: [],
        } as MissionSummary,
        {
          node: { id: 'm2', title: '[MISSION] Current', status: 'in_progress' },
          ownerSession: 'sess1',
          assigneeSession: null,
          mission: { active: true, phase: 'plan' } as any,
          rollup: {} as any,
          criteria: [],
          epics: [],
        } as MissionSummary,
      ],
    };
    expect(resolveSessionRole('proj', 'sess1', deps)).toBe('conductor');
  });
});
