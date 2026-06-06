import { describe, it, expect } from 'bun:test';
import {
  deriveLiveness,
  roleOf,
  buildSessionRuntime,
  buildSessionRuntimes,
  CRASH_MS,
  type RuntimeSources,
} from '../session-runtime';
import type { SessionStatusRow } from '../session-status-store';

const NOW = 1_000_000_000;

function status(over: Partial<SessionStatusRow> & { session: string }): SessionStatusRow {
  return {
    project: '/proj',
    session: over.session,
    status: over.status ?? 'active',
    updatedAt: over.updatedAt ?? NOW,
    contextPercent: over.contextPercent ?? null,
    contextUpdatedAt: over.contextUpdatedAt ?? null,
    checkpointReadyAt: over.checkpointReadyAt ?? null,
  };
}

function sources(over: Partial<RuntimeSources> = {}): RuntimeSources {
  return {
    statuses: [],
    inProgressTodos: [],
    supervisorSession: null,
    escalatedSessions: new Set(),
    slotTmuxBySession: new Map(),
    now: NOW,
    ...over,
  };
}

describe('deriveLiveness', () => {
  it('fresh active heartbeat → active', () => {
    expect(deriveLiveness({ status: 'active', updatedAt: NOW }, false, NOW)).toBe('active');
  });

  it('stale heartbeat WITH an active claim → crashed', () => {
    const stale = NOW - CRASH_MS - 1;
    expect(deriveLiveness({ status: 'active', updatedAt: stale }, true, NOW)).toBe('crashed');
  });

  it('stale heartbeat WITHOUT a claim is not crashed (falls through to status)', () => {
    const stale = NOW - CRASH_MS - 1;
    // crashed requires a held claim; a stale active session with no claim stays active.
    expect(deriveLiveness({ status: 'active', updatedAt: stale }, false, NOW)).toBe('active');
    // a stale idle session with no claim is idle.
    expect(deriveLiveness({ status: 'waiting', updatedAt: stale }, false, NOW)).toBe('idle');
  });

  it('fresh but waiting/permission/checkpoint_ready → idle', () => {
    for (const s of ['waiting', 'permission', 'checkpoint_ready']) {
      expect(deriveLiveness({ status: s, updatedAt: NOW }, false, NOW)).toBe('idle');
    }
  });

  it('exactly at CRASH_MS is NOT yet stale', () => {
    expect(deriveLiveness({ status: 'active', updatedAt: NOW - CRASH_MS }, true, NOW)).toBe('active');
  });
});

describe('roleOf', () => {
  it('takes the session-name prefix, lowercased', () => {
    expect(roleOf('backend-2')).toBe('backend');
    expect(roleOf('Frontend_1')).toBe('frontend');
    expect(roleOf('supervisor')).toBe('supervisor');
  });
});

describe('buildSessionRuntime — the join', () => {
  it('joins status + claim + identity + escalation + slot into one shape', () => {
    const rt = buildSessionRuntime(
      '/proj',
      status({ session: 'backend-2', status: 'active', contextPercent: 70, contextUpdatedAt: NOW, checkpointReadyAt: 42 }),
      sources({
        inProgressTodos: [
          { id: 'todo-1', claimedBy: 'backend-2', assigneeSession: null, claimedAt: '2026-06-05T00:00:00Z', retryCount: 2 },
        ],
        supervisorSession: 'backend-2',
        escalatedSessions: new Set(['backend-2']),
        slotTmuxBySession: new Map([['backend-2', 'tmux-backend-2']]),
      }),
    );
    expect(rt).toEqual({
      project: '/proj',
      session: 'backend-2',
      role: 'backend',
      isSupervisor: true,
      status: 'active',
      updatedAt: NOW,
      contextPercent: 70,
      contextUpdatedAt: NOW,
      checkpointReadyAt: 42,
      claimedTodoId: 'todo-1',
      claimedAt: '2026-06-05T00:00:00Z',
      retryCount: 2,
      slotTmux: 'tmux-backend-2',
      idleSince: null,
      escalated: true,
      liveness: 'active',
    });
  });

  it('matches a claim by assigneeSession too (mirrors currentTodoFor)', () => {
    const rt = buildSessionRuntime(
      '/proj',
      status({ session: 'ui-1' }),
      sources({ inProgressTodos: [{ id: 't', claimedBy: null, assigneeSession: 'ui-1', claimedAt: null, retryCount: 0 }] }),
    );
    expect(rt.claimedTodoId).toBe('t');
  });

  it('no claim → null claim fields, retryCount 0', () => {
    const rt = buildSessionRuntime('/proj', status({ session: 'idle-1', status: 'waiting' }), sources());
    expect(rt.claimedTodoId).toBeNull();
    expect(rt.claimedAt).toBeNull();
    expect(rt.retryCount).toBe(0);
  });

  it('idleSince is the heartbeat when not active, null when active', () => {
    expect(buildSessionRuntime('/proj', status({ session: 'a', status: 'active' }), sources()).idleSince).toBeNull();
    expect(buildSessionRuntime('/proj', status({ session: 'b', status: 'waiting', updatedAt: NOW }), sources()).idleSince).toBe(NOW);
  });

  it('a stale session still holding a claim reads crashed', () => {
    const rt = buildSessionRuntime(
      '/proj',
      status({ session: 'dead-1', status: 'active', updatedAt: NOW - CRASH_MS - 1 }),
      sources({ inProgressTodos: [{ id: 't', claimedBy: 'dead-1', assigneeSession: null, claimedAt: null, retryCount: 0 }] }),
    );
    expect(rt.liveness).toBe('crashed');
  });
});

describe('golden: supervisor_reconcile join is unchanged', () => {
  // The OLD reconcile stitched getStatuses + isSupervised + open-todo count
  // inline. The NEW path derives status/updatedAt from buildSessionRuntimes and
  // overlays the same supervised/openTodos. Assert identical rows.
  const statuses: SessionStatusRow[] = [
    status({ session: 'backend-1', status: 'active', updatedAt: 10 }),
    status({ session: 'frontend-1', status: 'waiting', updatedAt: 20 }),
  ];
  const supervisedSet = new Set(['backend-1']);
  const openTodoCount: Record<string, number> = { 'backend-1': 3 };

  function rowsOld() {
    return statuses.map((s) => {
      const supervised = supervisedSet.has(s.session);
      const openTodos = supervised ? (openTodoCount[s.session] ?? 0) : 0;
      return { project: '/proj', session: s.session, status: s.status, updatedAt: s.updatedAt, openTodos, supervised, serverId: '' };
    });
  }

  function rowsNew() {
    return buildSessionRuntimes('/proj', sources({ statuses })).map((rt) => {
      const supervised = supervisedSet.has(rt.session);
      const openTodos = supervised ? (openTodoCount[rt.session] ?? 0) : 0;
      return { project: '/proj', session: rt.session, status: rt.status, updatedAt: rt.updatedAt, openTodos, supervised, serverId: '' };
    });
  }

  it('produces byte-identical reconcile rows', () => {
    expect(rowsNew()).toEqual(rowsOld());
  });
});

describe('golden: watchdog selector sees the same fields', () => {
  // SessionRuntime is a structural superset of SessionStatusRow, so the watchdog
  // selector reads identical status/contextPercent/contextUpdatedAt/checkpointReadyAt.
  it('runtime rows carry every field selectWatchdogActions reads', () => {
    const [rt] = buildSessionRuntimes(
      '/proj',
      sources({ statuses: [status({ session: 'w', status: 'waiting', contextPercent: 90, contextUpdatedAt: NOW, checkpointReadyAt: 5 })] }),
    );
    expect(rt.session).toBe('w');
    expect(rt.status).toBe('waiting');
    expect(rt.contextPercent).toBe(90);
    expect(rt.contextUpdatedAt).toBe(NOW);
    expect(rt.checkpointReadyAt).toBe(5);
  });
});
