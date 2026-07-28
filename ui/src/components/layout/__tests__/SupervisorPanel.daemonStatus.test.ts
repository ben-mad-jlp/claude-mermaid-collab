import { describe, it, expect } from 'vitest';
import { resolveDaemonStatus } from '@/components/layout/SupervisorPanel';
import type { SessionCardData } from '@/components/layout/SessionCard';
import { selectEscalationKindCounts } from '@/lib/statusSelectors';
import type { Escalation } from '@/stores/supervisorStore';

describe('resolveDaemonStatus', () => {
  it('returns "conducting" when only machine-handled escalations exist and conductor is mid-pass', () => {
    const result = resolveDaemonStatus({
      inProgress: 0,
      hasHeadlessInflight: false,
      blockerCount: 0, // only machine-handled escalations (from selectEscalationKindCounts machineHandled bucket)
      isConducting: true,
      idleWithWork: false,
      combined: 'unknown',
    });
    expect(result).toBe('conducting');
  });

  it('does not return "permission" when only machine-handled escalations exist and conductor is idle', () => {
    const result = resolveDaemonStatus({
      inProgress: 0,
      hasHeadlessInflight: false,
      blockerCount: 0, // only machine-handled escalations
      isConducting: false,
      idleWithWork: false,
      combined: 'unknown',
    });
    expect(result).not.toBe('permission');
    expect(result).toBe('unknown');
  });

  it('returns "active" when working (in progress) even if conductor is conducting and only machine-handled escalations exist', () => {
    const result = resolveDaemonStatus({
      inProgress: 1,
      hasHeadlessInflight: false,
      blockerCount: 0, // only machine-handled escalations
      isConducting: true,
      idleWithWork: false,
      combined: 'unknown',
    });
    expect(result).toBe('active');
  });

  it('precedence order: working outranks conducting', () => {
    const result = resolveDaemonStatus({
      inProgress: 0,
      hasHeadlessInflight: true, // daemon leaf-executor inflight
      blockerCount: 0,
      isConducting: true,
      idleWithWork: false,
      combined: 'unknown',
    });
    expect(result).toBe('active');
  });

  it('precedence order: permission (blocker) outranks conducting', () => {
    const result = resolveDaemonStatus({
      inProgress: 0,
      hasHeadlessInflight: false,
      blockerCount: 1, // human-actionable blocker
      isConducting: true,
      idleWithWork: false,
      combined: 'unknown',
    });
    expect(result).toBe('permission');
  });

  it('returns "waiting" when idle with work queued and conductor is idle', () => {
    const result = resolveDaemonStatus({
      inProgress: 0,
      hasHeadlessInflight: false,
      blockerCount: 0,
      isConducting: false,
      idleWithWork: true,
      combined: 'unknown',
    });
    expect(result).toBe('waiting');
  });

  it('conducting outranks idle-with-work', () => {
    const result = resolveDaemonStatus({
      inProgress: 0,
      hasHeadlessInflight: false,
      blockerCount: 0,
      isConducting: true,
      idleWithWork: true,
      combined: 'unknown',
    });
    expect(result).toBe('conducting');
  });

  it('returns combined status when no concrete conditions match', () => {
    const result = resolveDaemonStatus({
      inProgress: 0,
      hasHeadlessInflight: false,
      blockerCount: 0,
      isConducting: false,
      idleWithWork: false,
      combined: 'waiting' as SessionCardData['status'],
    });
    expect(result).toBe('waiting');
  });
});

describe('resolveDaemonStatus with derived blockerCount (owned leaf-scoped escalations)', () => {
  it('derives counts from selectEscalationKindCounts with owned fixture', () => {
    const ownedLeafIds = ['leaf-1', 'leaf-2'];
    const ownedTodoIds = new Set(ownedLeafIds);

    const escalations: Escalation[] = [
      {
        id: 'esc-1',
        project: 'proj',
        session: 's1',
        kind: 'blocker',
        questionText: 'Test blocker 1',
        status: 'open',
        createdAt: 0,
        todoId: 'leaf-1',
      },
      {
        id: 'esc-2',
        project: 'proj',
        session: 's1',
        kind: 'blocker',
        questionText: 'Test blocker 2',
        status: 'open',
        createdAt: 0,
        todoId: 'leaf-2',
      },
    ];

    const derived = selectEscalationKindCounts(
      escalations,
      { kind: 'project', project: 'proj' },
      { ownedTodoIds }
    );

    expect(derived).toEqual({ blockers: 0, landReady: 0, machineHandled: 2, total: 2 });
  });

  it('conducts when owned escalations are classified as machineHandled and isConducting is true', () => {
    const ownedLeafIds = ['leaf-1', 'leaf-2'];
    const ownedTodoIds = new Set(ownedLeafIds);

    const escalations: Escalation[] = [
      {
        id: 'esc-1',
        project: 'proj',
        session: 's1',
        kind: 'blocker',
        questionText: 'Test blocker 1',
        status: 'open',
        createdAt: 0,
        todoId: 'leaf-1',
      },
      {
        id: 'esc-2',
        project: 'proj',
        session: 's1',
        kind: 'blocker',
        questionText: 'Test blocker 2',
        status: 'open',
        createdAt: 0,
        todoId: 'leaf-2',
      },
    ];

    const derived = selectEscalationKindCounts(
      escalations,
      { kind: 'project', project: 'proj' },
      { ownedTodoIds }
    );

    const result = resolveDaemonStatus({
      inProgress: 0,
      hasHeadlessInflight: false,
      blockerCount: derived.blockers,
      isConducting: true,
      idleWithWork: false,
      combined: 'unknown',
    });

    expect(result).toBe('conducting');
  });

  it('returns unknown when owned escalations are classified as machineHandled and isConducting is false', () => {
    const ownedLeafIds = ['leaf-1', 'leaf-2'];
    const ownedTodoIds = new Set(ownedLeafIds);

    const escalations: Escalation[] = [
      {
        id: 'esc-1',
        project: 'proj',
        session: 's1',
        kind: 'blocker',
        questionText: 'Test blocker 1',
        status: 'open',
        createdAt: 0,
        todoId: 'leaf-1',
      },
      {
        id: 'esc-2',
        project: 'proj',
        session: 's1',
        kind: 'blocker',
        questionText: 'Test blocker 2',
        status: 'open',
        createdAt: 0,
        todoId: 'leaf-2',
      },
    ];

    const derived = selectEscalationKindCounts(
      escalations,
      { kind: 'project', project: 'proj' },
      { ownedTodoIds }
    );

    const result = resolveDaemonStatus({
      inProgress: 0,
      hasHeadlessInflight: false,
      blockerCount: derived.blockers,
      isConducting: false,
      idleWithWork: false,
      combined: 'unknown',
    });

    expect(result).toBe('unknown');
  });

  it('returns permission when escalations are unowned blockers and isConducting is true', () => {
    const ownedLeafIds = ['leaf-1', 'leaf-2'];
    const ownedTodoIds = new Set(ownedLeafIds);

    const escalations: Escalation[] = [
      {
        id: 'esc-1',
        project: 'proj',
        session: 's1',
        kind: 'blocker',
        questionText: 'Test blocker 1',
        status: 'open',
        createdAt: 0,
        todoId: 'other-1',
      },
      {
        id: 'esc-2',
        project: 'proj',
        session: 's1',
        kind: 'blocker',
        questionText: 'Test blocker 2',
        status: 'open',
        createdAt: 0,
        todoId: 'other-2',
      },
    ];

    const derived = selectEscalationKindCounts(
      escalations,
      { kind: 'project', project: 'proj' },
      { ownedTodoIds }
    );

    expect(derived.blockers).toBe(2);

    const result = resolveDaemonStatus({
      inProgress: 0,
      hasHeadlessInflight: false,
      blockerCount: derived.blockers,
      isConducting: true,
      idleWithWork: false,
      combined: 'unknown',
    });

    expect(result).toBe('permission');
  });

  it('maintains parity between blockers, landReady, machineHandled, and total for owned fixture', () => {
    const ownedLeafIds = ['leaf-1', 'leaf-2'];
    const ownedTodoIds = new Set(ownedLeafIds);

    const escalations: Escalation[] = [
      {
        id: 'esc-1',
        project: 'proj',
        session: 's1',
        kind: 'blocker',
        questionText: 'Test blocker 1',
        status: 'open',
        createdAt: 0,
        todoId: 'leaf-1',
      },
      {
        id: 'esc-2',
        project: 'proj',
        session: 's1',
        kind: 'blocker',
        questionText: 'Test blocker 2',
        status: 'open',
        createdAt: 0,
        todoId: 'leaf-2',
      },
    ];

    const derived = selectEscalationKindCounts(
      escalations,
      { kind: 'project', project: 'proj' },
      { ownedTodoIds }
    );

    expect(derived.blockers + derived.landReady + derived.machineHandled).toBe(derived.total);
  });

  it('maintains parity between blockers, landReady, machineHandled, and total for unowned fixture', () => {
    const ownedLeafIds = ['leaf-1', 'leaf-2'];
    const ownedTodoIds = new Set(ownedLeafIds);

    const escalations: Escalation[] = [
      {
        id: 'esc-1',
        project: 'proj',
        session: 's1',
        kind: 'blocker',
        questionText: 'Test blocker 1',
        status: 'open',
        createdAt: 0,
        todoId: 'other-1',
      },
      {
        id: 'esc-2',
        project: 'proj',
        session: 's1',
        kind: 'blocker',
        questionText: 'Test blocker 2',
        status: 'open',
        createdAt: 0,
        todoId: 'other-2',
      },
    ];

    const derived = selectEscalationKindCounts(
      escalations,
      { kind: 'project', project: 'proj' },
      { ownedTodoIds }
    );

    expect(derived.blockers + derived.landReady + derived.machineHandled).toBe(derived.total);
  });
});
