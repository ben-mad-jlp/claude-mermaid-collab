import { describe, it, expect } from 'bun:test';
import {
  selectConductorOwnedTodoIds,
  RUNNING_FRESH_MS,
  type ConductorOwnedTodosDeps,
} from '../conductor-owned-todos.ts';
import type { ConductorLastPass } from '../supervisor-store.ts';
import type { Todo } from '../todo-store.ts';
import type { MissionSummary } from '../mission-store.ts';

function makeTodo(
  id: string,
  parentId: string | null,
  kind: string,
  status: string,
): Todo {
  return {
    id,
    parentId,
    kind,
    status,
    title: `Todo ${id}`,
    description: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archivedAt: null,
  } as any;
}

function makeMission(
  id: string,
  active: boolean,
  status: string = 'building',
  abandonedAt: number | null = null,
  closedAt: number | null = null,
): MissionSummary {
  return {
    node: { id, title: `Mission ${id}`, status },
    ownerSession: null,
    assigneeSession: null,
    mission: {
      todoId: id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      active,
      status,
      abandonedAt,
      closedAt,
      lastNudgeAt: null,
      lastNudgeKey: null,
      lastConductorKey: null,
      lastConductorPassAt: null,
      lastConductorSelfKey: null,
      handoffDocId: null,
      budgetUsd: 100,
      queuePos: 0,
    } as any,
  } as any;
}

describe('selectConductorOwnedTodoIds', () => {
  it('returns empty array when conductor is disabled', () => {
    const deps: ConductorOwnedTodosDeps = {
      getConductorEnabled: () => false,
      getConductorLastPass: () => null,
      listTodos: () => [
        makeTodo('epic1', 'mission1', 'epic', 'ready'),
      ],
      listMissions: () => [makeMission('mission1', true)],
    };

    const result = selectConductorOwnedTodoIds('proj', Date.now(), deps);
    expect(result).toEqual([]);
  });

  it('returns empty array when lastPass is null', () => {
    const deps: ConductorOwnedTodosDeps = {
      getConductorEnabled: () => true,
      getConductorLastPass: () => null,
      listTodos: () => [
        makeTodo('epic1', 'mission1', 'epic', 'ready'),
      ],
      listMissions: () => [makeMission('mission1', true)],
    };

    const result = selectConductorOwnedTodoIds('proj', Date.now(), deps);
    expect(result).toEqual([]);
  });

  it('returns empty array when lastPass.reason is not pass-ran', () => {
    const deps: ConductorOwnedTodosDeps = {
      getConductorEnabled: () => true,
      getConductorLastPass: () => ({
        missionId: 'mission1',
        reason: 'conducted',
        tickAt: Date.now(),
      }),
      listTodos: () => [
        makeTodo('epic1', 'mission1', 'epic', 'ready'),
      ],
      listMissions: () => [makeMission('mission1', true)],
    };

    const result = selectConductorOwnedTodoIds('proj', Date.now(), deps);
    expect(result).toEqual([]);
  });

  it('returns empty array when lastPass.tickAt is not a number', () => {
    const deps: ConductorOwnedTodosDeps = {
      getConductorEnabled: () => true,
      getConductorLastPass: () => ({
        missionId: 'mission1',
        reason: 'pass-ran',
        tickAt: null as any,
      }),
      listTodos: () => [
        makeTodo('epic1', 'mission1', 'epic', 'ready'),
      ],
      listMissions: () => [makeMission('mission1', true)],
    };

    const result = selectConductorOwnedTodoIds('proj', Date.now(), deps);
    expect(result).toEqual([]);
  });

  it('returns empty array when lastPass is stale (>= RUNNING_FRESH_MS)', () => {
    const nowMs = 1000000;
    const staleTickAt = nowMs - RUNNING_FRESH_MS; // exactly at the edge, should be stale
    const deps: ConductorOwnedTodosDeps = {
      getConductorEnabled: () => true,
      getConductorLastPass: () => ({
        missionId: 'mission1',
        reason: 'pass-ran',
        tickAt: staleTickAt,
      }),
      listTodos: () => [
        makeTodo('epic1', 'mission1', 'epic', 'ready'),
      ],
      listMissions: () => [makeMission('mission1', true)],
    };

    const result = selectConductorOwnedTodoIds('proj', nowMs, deps);
    expect(result).toEqual([]);
  });

  it('returns empty array when no pin and listMissions has no active non-terminal missions', () => {
    const deps: ConductorOwnedTodosDeps = {
      getConductorEnabled: () => true,
      getConductorLastPass: () => ({
        missionId: null,
        reason: 'pass-ran',
        tickAt: Date.now(),
      }),
      listTodos: () => [],
      listMissions: () => [],
    };

    const result = selectConductorOwnedTodoIds('proj', Date.now(), deps);
    expect(result).toEqual([]);
  });

  it('returns empty array when no pin and listMissions has > 1 active non-terminal missions (ambiguous)', () => {
    const deps: ConductorOwnedTodosDeps = {
      getConductorEnabled: () => true,
      getConductorLastPass: () => ({
        missionId: null,
        reason: 'pass-ran',
        tickAt: Date.now(),
      }),
      listTodos: () => [],
      listMissions: () => [
        makeMission('mission1', true),
        makeMission('mission2', true),
      ],
    };

    const result = selectConductorOwnedTodoIds('proj', Date.now(), deps);
    expect(result).toEqual([]);
  });

  it('returns the single active mission epic children (2 live epics, 1 dropped, 1 non-epic)', () => {
    const missionId = 'mission1';
    const deps: ConductorOwnedTodosDeps = {
      getConductorEnabled: () => true,
      getConductorLastPass: () => ({
        missionId,
        reason: 'pass-ran',
        tickAt: Date.now(),
      }),
      listTodos: () => [
        makeTodo('epic1', missionId, 'epic', 'ready'),
        makeTodo('epic2', missionId, 'epic', 'ready'),
        makeTodo('epic3', missionId, 'epic', 'dropped'),
        makeTodo('leaf1', missionId, 'leaf', 'ready'),
        makeTodo('other', 'other-parent', 'epic', 'ready'),
      ],
      listMissions: () => [makeMission(missionId, true)],
    };

    const result = selectConductorOwnedTodoIds('proj', Date.now(), deps);
    expect(result).toEqual(['epic1', 'epic2']);
  });

  it('returns single active non-terminal mission epic children when no pin', () => {
    const missionId = 'mission1';
    const deps: ConductorOwnedTodosDeps = {
      getConductorEnabled: () => true,
      getConductorLastPass: () => ({
        missionId,
        reason: 'pass-ran',
        tickAt: Date.now(),
      }),
      listTodos: () => [
        makeTodo('epic1', missionId, 'epic', 'ready'),
        makeTodo('epic2', missionId, 'epic', 'ready'),
      ],
      listMissions: () => [makeMission(missionId, true)],
    };

    const result = selectConductorOwnedTodoIds('proj', Date.now(), deps);
    expect(result).toEqual(['epic1', 'epic2']);
  });

  it('returns empty array when no pin and mission is terminal (converged)', () => {
    const missionId = 'mission1';
    const deps: ConductorOwnedTodosDeps = {
      getConductorEnabled: () => true,
      getConductorLastPass: () => ({
        missionId,
        reason: 'pass-ran',
        tickAt: Date.now(),
      }),
      listTodos: () => [
        makeTodo('epic1', missionId, 'epic', 'ready'),
      ],
      listMissions: () => [makeMission(missionId, true, 'converged')],
    };

    const result = selectConductorOwnedTodoIds('proj', Date.now(), deps);
    expect(result).toEqual([]);
  });

  it('returns empty array when no pin and mission is terminal (abandoned)', () => {
    const missionId = 'mission1';
    const deps: ConductorOwnedTodosDeps = {
      getConductorEnabled: () => true,
      getConductorLastPass: () => ({
        missionId,
        reason: 'pass-ran',
        tickAt: Date.now(),
      }),
      listTodos: () => [
        makeTodo('epic1', missionId, 'epic', 'ready'),
      ],
      listMissions: () => [
        makeMission(missionId, true, 'abandoned', Date.now()),
      ],
    };

    const result = selectConductorOwnedTodoIds('proj', Date.now(), deps);
    expect(result).toEqual([]);
  });

  it('returns empty array when no pin and mission is terminal (closed)', () => {
    const missionId = 'mission1';
    const deps: ConductorOwnedTodosDeps = {
      getConductorEnabled: () => true,
      getConductorLastPass: () => ({
        missionId,
        reason: 'pass-ran',
        tickAt: Date.now(),
      }),
      listTodos: () => [
        makeTodo('epic1', missionId, 'epic', 'ready'),
      ],
      listMissions: () => [makeMission(missionId, true, 'closed', null, Date.now())],
    };

    const result = selectConductorOwnedTodoIds('proj', Date.now(), deps);
    expect(result).toEqual([]);
  });

  it('returns empty array when no pin and mission is inactive', () => {
    const missionId = 'mission1';
    const deps: ConductorOwnedTodosDeps = {
      getConductorEnabled: () => true,
      getConductorLastPass: () => ({
        missionId,
        reason: 'pass-ran',
        tickAt: Date.now(),
      }),
      listTodos: () => [
        makeTodo('epic1', missionId, 'epic', 'ready'),
      ],
      listMissions: () => [makeMission(missionId, false)],
    };

    const result = selectConductorOwnedTodoIds('proj', Date.now(), deps);
    expect(result).toEqual([]);
  });
});
