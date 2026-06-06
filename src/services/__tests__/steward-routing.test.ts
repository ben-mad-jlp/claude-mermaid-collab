import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'steward-routing-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  setSupervisorIdentity,
  getSupervisorIdentity,
  assertSupervisorOwner,
  touchSupervisorIdentity,
  SupersededError,
  routeOf,
  routeEscalation,
  stewardAutoEnabled,
  setStewardPause,
  isStewardPaused,
  isStewardLive,
  stewardFailOpenScan,
  STEWARD_FAILOPEN_SESSION,
  SUPERVISOR_STALE_AFTER_MS,
  createEscalation,
  getEscalation,
  listEscalations,
  _closeDb,
} from '../supervisor-store';

beforeAll(() => { _closeDb(); });
afterAll(() => {
  _closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
  delete process.env.MERMAID_STEWARD_AUTO;
});

function freshDb() {
  _closeDb();
  rmSync(join(dir, 'supervisor.db'), { force: true });
  rmSync(join(dir, 'supervisor.db-wal'), { force: true });
  rmSync(join(dir, 'supervisor.db-shm'), { force: true });
}

describe('per-role identity + epoch fence', () => {
  beforeEach(() => { freshDb(); delete process.env.MERMAID_STEWARD_AUTO; });

  it('supervisor and steward are independent rows with independent epochs', () => {
    expect(setSupervisorIdentity('/p', 'sup')).toBe(1); // role defaults to 'supervisor'
    expect(setSupervisorIdentity('/p', 'stew', '', 'steward')).toBe(1); // separate epoch line
    expect(setSupervisorIdentity('/p', 'stew', '', 'steward')).toBe(2);
    // The steward bumps did NOT touch the supervisor epoch.
    expect(getSupervisorIdentity('supervisor')?.epoch).toBe(1);
    expect(getSupervisorIdentity('steward')?.epoch).toBe(2);
    expect(getSupervisorIdentity('supervisor')?.session).toBe('sup');
    expect(getSupervisorIdentity('steward')?.session).toBe('stew');
  });

  it('the steward fence is per-role: a stale steward epoch is superseded, supervisor untouched', () => {
    setSupervisorIdentity('/p', 'sup'); // supervisor epoch 1
    setSupervisorIdentity('/p', 'stewA', '', 'steward'); // steward epoch 1
    setSupervisorIdentity('/p', 'stewB', '', 'steward'); // steward epoch 2 supersedes A
    // Current steward (epoch 2) passes; the superseded one (epoch 1) is rejected.
    expect(() => assertSupervisorOwner(2, 'steward')).not.toThrow();
    expect(() => assertSupervisorOwner(1, 'steward')).toThrow(SupersededError);
    // Supervisor fence is unaffected by steward churn.
    expect(() => assertSupervisorOwner(1, 'supervisor')).not.toThrow();
  });

  it('SupersededError names the role that rejected the caller', () => {
    setSupervisorIdentity('/p', 'stewA', '', 'steward');
    setSupervisorIdentity('/p', 'stewB', '', 'steward');
    try {
      assertSupervisorOwner(1, 'steward');
      throw new Error('expected SupersededError');
    } catch (e) {
      expect(e).toBeInstanceOf(SupersededError);
      expect((e as SupersededError).role).toBe('steward');
      expect((e as Error).message).toContain('steward');
    }
  });

  it('fenced touch only advances the current steward', () => {
    setSupervisorIdentity('/p', 'stewA', '', 'steward'); // epoch 1
    setSupervisorIdentity('/p', 'stewB', '', 'steward'); // epoch 2
    expect(touchSupervisorIdentity(2, 'steward')).toBe(true);
    expect(touchSupervisorIdentity(1, 'steward')).toBe(false); // superseded — no write
  });
});

describe('routeOf — deterministic create-time routing (design §3)', () => {
  afterEach(() => { delete process.env.MERMAID_STEWARD_AUTO; });

  it('routes EVERYTHING to human while steward-auto is OFF (default)', () => {
    delete process.env.MERMAID_STEWARD_AUTO;
    expect(stewardAutoEnabled()).toBe(false);
    for (const kind of ['blocker', 'question', 'needs-design', 'decision', 'approval', 'assumption-invalidated']) {
      expect(routeOf(kind, false)).toBe('human');
    }
  });

  it('with steward-auto ON, routes by the §3 table', () => {
    process.env.MERMAID_STEWARD_AUTO = '1';
    expect(routeOf('blocker', false)).toBe('steward');
    expect(routeOf('question', false)).toBe('steward');
    expect(routeOf('needs-design', false)).toBe('steward');
    // Hard human floors.
    expect(routeOf('approval', false)).toBe('human');
    expect(routeOf('decision', false)).toBe('human');
    expect(routeOf('assumption-invalidated', false)).toBe('human');
    expect(routeOf('operator-gated', false)).toBe('human');
    // operatorGated flag forces human even for a steward kind.
    expect(routeOf('blocker', true)).toBe('human');
    // Unknown kind fails safe to human.
    expect(routeOf('something-new', false)).toBe('human');
  });
});

describe('createEscalation persists routing', () => {
  beforeEach(() => { freshDb(); });
  afterEach(() => { delete process.env.MERMAID_STEWARD_AUTO; });

  it('defaults routedTo=human, operatorGated=0, proof=null, stewardAttempts=0 (auto OFF)', () => {
    delete process.env.MERMAID_STEWARD_AUTO;
    const { escalation } = createEscalation({ project: '/p', session: 'w1', kind: 'blocker', questionText: 'q1' });
    expect(escalation.routedTo).toBe('human');
    expect(escalation.operatorGated).toBe(0);
    expect(escalation.proof).toBe(null);
    expect(escalation.stewardAttempts).toBe(0);
    expect(getEscalation(escalation.id)?.routedTo).toBe('human');
  });

  it('routes a blocker to the steward when auto is ON and a LIVE steward is registered, and persists it', () => {
    process.env.MERMAID_STEWARD_AUTO = 'true';
    setSupervisorIdentity('/p', 'stew', '', 'steward'); // live (updatedAt=now)
    const { escalation } = createEscalation({ project: '/p', session: 'w2', kind: 'blocker', questionText: 'q2' });
    expect(escalation.routedTo).toBe('steward');
    expect(getEscalation(escalation.id)?.routedTo).toBe('steward');
  });

  it('operatorGated escalation stays human even with auto ON', () => {
    process.env.MERMAID_STEWARD_AUTO = '1';
    const { escalation } = createEscalation({ project: '/p', session: 'w3', kind: 'blocker', questionText: 'q3', operatorGated: true });
    expect(escalation.operatorGated).toBe(1);
    expect(escalation.routedTo).toBe('human');
  });
});

describe('P4 reclaim + liveness — pause, fail-open, supersede (design §4/§5)', () => {
  beforeEach(() => { freshDb(); process.env.MERMAID_STEWARD_AUTO = '1'; });
  afterEach(() => { delete process.env.MERMAID_STEWARD_AUTO; });

  it('PAUSE stops routing: a paused steward routes a steward-kind to human', () => {
    setSupervisorIdentity('/p', 'stew', '', 'steward'); // live
    expect(routeEscalation('blocker', false)).toBe('steward'); // baseline: live + unpaused
    setStewardPause(true);
    expect(isStewardPaused()).toBe(true);
    expect(routeEscalation('blocker', false)).toBe('human'); // paused → human
    const { escalation } = createEscalation({ project: '/p', session: 'w', kind: 'blocker', questionText: 'paused-q' });
    expect(escalation.routedTo).toBe('human');
    setStewardPause(false);
    expect(routeEscalation('blocker', false)).toBe('steward'); // resumed
  });

  it('FAIL-OPEN: a stale/dead steward routes everything to human', () => {
    setSupervisorIdentity('/p', 'stew', '', 'steward');
    const reg = getSupervisorIdentity('steward')!.updatedAt;
    expect(isStewardLive(reg)).toBe(true);
    const stale = reg + SUPERVISOR_STALE_AFTER_MS + 1; // past the stale window
    expect(isStewardLive(stale)).toBe(false);
    expect(routeEscalation('blocker', false, stale)).toBe('human');
  });

  it('FAIL-OPEN surfaces exactly ONE summary escalation (deduped), counting queued steward work', () => {
    setSupervisorIdentity('/p', 'stew', '', 'steward'); // live now → these route to steward
    createEscalation({ project: '/p', session: 'w1', kind: 'blocker', questionText: 'queued-1' });
    createEscalation({ project: '/p', session: 'w2', kind: 'question', questionText: 'queued-2' });
    const stale = getSupervisorIdentity('steward')!.updatedAt + SUPERVISOR_STALE_AFTER_MS + 1;
    const first = stewardFailOpenScan(stale);
    expect(first.stale).toBe(true);
    expect(first.queued).toBe(2);
    expect(first.escalationId).not.toBeNull();
    // Re-scan must NOT create a second summary — same id.
    const second = stewardFailOpenScan(stale + 1_000);
    expect(second.escalationId).toBe(first.escalationId);
    const summaries = listEscalations('open').filter((e) => e.session === STEWARD_FAILOPEN_SESSION);
    expect(summaries.length).toBe(1);
    expect(summaries[0].routedTo).toBe('human');
  });

  it('fail-open is a no-op while the steward is LIVE', () => {
    setSupervisorIdentity('/p', 'stew', '', 'steward');
    expect(stewardFailOpenScan(Date.now()).stale).toBe(false);
  });

  it('SUPERSEDE kill-switch: re-registering the steward bumps the epoch and fences the old one cold', () => {
    const e1 = setSupervisorIdentity('/p', 'stewA', '', 'steward');
    const e2 = setSupervisorIdentity('/p', 'stewB', '', 'steward'); // human reclaims by running the skill
    expect(e2).toBe(e1 + 1);
    expect(() => assertSupervisorOwner(e1, 'steward')).toThrow(SupersededError); // old steward stopped cold
    expect(() => assertSupervisorOwner(e2, 'steward')).not.toThrow();
  });
});
