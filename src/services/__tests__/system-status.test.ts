// Pure summarizeSystemStatus tests — no real FS, git, sockets, or processes.
import { describe, test, expect } from 'bun:test';
import {
  summarizeSystemStatus,
  type SystemStatusInputs,
} from '../system-status';
import type { InstanceTopology } from '../instance-topology';
import type { FleetStatus } from '../fleet-status';

function fleet(overrides: Partial<FleetStatus['summary']> = {}): FleetStatus {
  return {
    project: '/p',
    now: 1000,
    entries: [],
    summary: {
      inProgress: 3,
      working: 2,
      idle: 1,
      permission: 0,
      deadOrGone: 0,
      overLease: 0,
      ...overrides,
    },
    headroom: { liveProcs: 120, perUidCap: 6000, tmuxSessions: 4, idleSessions: 1 },
  };
}

function topology(overrides: Partial<InstanceTopology> = {}): InstanceTopology {
  return {
    canonicalPort: 9002,
    canonicalHolder: {
      pid: 4242,
      version: '5.92.19',
      exePath: '/Applications/Mermaid Collab.app/Contents/Resources/mc-server',
      owner: 'dev',
      startedAt: '2026-06-11T12:00:00.000Z',
    },
    lock: null,
    instances: [],
    peers: [],
    hasShadow: false,
    ...overrides,
  };
}

function inputs(overrides: Partial<SystemStatusInputs> = {}): SystemStatusInputs {
  return {
    project: '/p',
    now: 1000,
    orchestratorHealth: {
      running: true,
      tickMs: 5000,
      lastTickAt: 900,
      projects: [{ project: '/p', level: 'build' }],
    },
    poolOccupancy: 2,
    coldStartsInFlight: 0,
    fleet: fleet(),
    violations: [],
    topology: topology(),
    repoVersion: '5.92.19',
    repoHead: 'abc1234',
    uncommittedCount: 0,
    openEscalations: 0,
    pendingDecisions: 0,
    stewardPaused: false,
    supervisorPaused: false,
    ...overrides,
  };
}

describe('summarizeSystemStatus', () => {
  test('composes every foundational field from its read-model', () => {
    const s = summarizeSystemStatus(inputs());
    expect(s.orchestrator.running).toBe(true);
    expect(s.orchestrator.level).toBe('build');
    expect(s.orchestrator.poolOccupancy).toBe(2);
    expect(s.fleet.inProgress).toBe(3);
    expect(s.fleet.headroom.perUidCap).toBe(6000);
    expect(s.invariants.violationCount).toBe(0);
    expect(s.instances.canonicalConfirmed).toBe(true);
    expect(s.instances.canonicalHolder?.pid).toBe(4242);
    expect(s.inbox.openEscalations).toBe(0);
    expect(s.pause.steward).toBe(false);
  });

  test('no deploy drift when live version matches repo and tree is clean', () => {
    const s = summarizeSystemStatus(inputs());
    expect(s.deploy.liveVersion).toBe('5.92.19');
    expect(s.deploy.repoVersion).toBe('5.92.19');
    expect(s.deploy.livePid).toBe(4242);
    expect(s.deploy.repoHead).toBe('abc1234');
    expect(s.deploy.drift).toBe(false);
  });

  test('drift=true when the live version is behind the repo', () => {
    const s = summarizeSystemStatus(inputs({ repoVersion: '5.93.0' }));
    expect(s.deploy.drift).toBe(true);
  });

  test('drift=true when the repo carries uncommitted WIP', () => {
    const s = summarizeSystemStatus(inputs({ uncommittedCount: 5 }));
    expect(s.deploy.drift).toBe(true);
  });

  test('drift is null (unknowable) when no live server answers', () => {
    const s = summarizeSystemStatus(inputs({ topology: topology({ canonicalHolder: null }) }));
    expect(s.instances.canonicalConfirmed).toBe(false);
    expect(s.deploy.liveVersion).toBeNull();
    expect(s.deploy.livePid).toBeNull();
    expect(s.deploy.drift).toBeNull();
  });

  test('drift is null when the repo version is unreadable', () => {
    const s = summarizeSystemStatus(inputs({ repoVersion: null }));
    expect(s.deploy.drift).toBeNull();
  });

  test('surfaces shadow + violation + inbox + pause signals', () => {
    const s = summarizeSystemStatus(
      inputs({
        topology: topology({
          hasShadow: true,
          instances: [
            { sessionId: 'a', port: 9002, project: '/p', session: 's', pid: 1, serverVersion: '5.0.0', startedAt: 'x', tag: 'canonical', alive: true, reason: '' },
            { sessionId: 'b', port: 9002, project: '/p', session: 'plugin', pid: 2, serverVersion: '5.0.0', startedAt: 'x', tag: 'shadow', alive: true, reason: '' },
          ],
        }),
        violations: [
          { kind: 'orphan', todoId: 't1', title: 'x', reason: 'r' },
          { kind: 'orphan', todoId: 't2', title: 'y', reason: 'r' },
          { kind: 'stranded-epic', todoId: 't3', title: 'z', reason: 'r' },
        ] as SystemStatusInputs['violations'],
        openEscalations: 4,
        pendingDecisions: 1,
        stewardPaused: true,
        supervisorPaused: true,
      }),
    );
    expect(s.instances.hasShadow).toBe(true);
    expect(s.instances.shadowCount).toBe(1);
    expect(s.instances.instanceCount).toBe(2);
    expect(s.invariants.violationCount).toBe(3);
    expect(s.invariants.kinds.sort()).toEqual(['orphan', 'stranded-epic']);
    expect(s.inbox.openEscalations).toBe(4);
    expect(s.inbox.pendingDecisions).toBe(1);
    expect(s.pause.steward).toBe(true);
    expect(s.pause.supervisor).toBe(true);
  });

  test("level falls back to 'build' when the project has no explicit level row", () => {
    const s = summarizeSystemStatus(
      inputs({ orchestratorHealth: { running: false, tickMs: 5000, lastTickAt: null, projects: [] } }),
    );
    expect(s.orchestrator.running).toBe(false);
    expect(s.orchestrator.level).toBe('build');
  });

  test('exposes drill-down pointers to the focused tools', () => {
    const s = summarizeSystemStatus(inputs());
    expect(s.pointers.orchestrator).toBe('orchestrator_status');
    expect(s.pointers.instances).toBe('instance_topology');
  });
});
