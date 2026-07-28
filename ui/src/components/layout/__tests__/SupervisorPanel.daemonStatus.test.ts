import { describe, it, expect } from 'vitest';
import { resolveDaemonStatus } from '@/components/layout/SupervisorPanel';
import type { SessionCardData } from '@/components/layout/SessionCard';

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
