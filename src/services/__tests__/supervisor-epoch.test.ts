import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'sup-epoch-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  setSupervisorIdentity,
  getSupervisorIdentity,
  touchSupervisorIdentity,
  assertSupervisorOwner,
  SupersededError,
  _closeDb,
} from '../supervisor-store';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

describe('supervisor ownership epoch (split-brain fence)', () => {
  beforeEach(() => {
    // Fresh DB per test so epoch counts are predictable.
    _closeDb();
    rmSync(join(dir, 'supervisor.db'), { force: true });
    rmSync(join(dir, 'supervisor.db-wal'), { force: true });
    rmSync(join(dir, 'supervisor.db-shm'), { force: true });
  });

  it('first register returns epoch 1; re-register monotonically increments (a counter, not a clock)', () => {
    expect(setSupervisorIdentity('/p', 'sup')).toBe(1);
    expect(setSupervisorIdentity('/p', 'sup')).toBe(2);
    expect(setSupervisorIdentity('/p', 'sup')).toBe(3);
    expect(getSupervisorIdentity()?.epoch).toBe(3);
  });

  it('getSupervisorIdentity exposes the current epoch', () => {
    setSupervisorIdentity('/p', 'sup');
    setSupervisorIdentity('/p', 'sup');
    const id = getSupervisorIdentity();
    expect(id?.epoch).toBe(2);
    expect(id?.session).toBe('sup');
  });

  // The unit acceptance: given current epoch=2, an action tagged epoch=1 is
  // REJECTED; epoch=2 is ALLOWED.
  it('assertSupervisorOwner: stale epoch rejected, current epoch allowed', () => {
    setSupervisorIdentity('/p', 'sup'); // epoch 1
    setSupervisorIdentity('/p', 'sup'); // epoch 2
    expect(() => assertSupervisorOwner(1)).toThrow(SupersededError);
    expect(() => assertSupervisorOwner(2)).not.toThrow();
  });

  it('assertSupervisorOwner: a caller with no epoch cannot prove ownership (rejected)', () => {
    setSupervisorIdentity('/p', 'sup');
    expect(() => assertSupervisorOwner(undefined)).toThrow(SupersededError);
  });

  it('assertSupervisorOwner: rejects when no supervisor is registered', () => {
    expect(() => assertSupervisorOwner(1)).toThrow(SupersededError);
  });

  it('SupersededError carries caller + current epoch for diagnostics', () => {
    setSupervisorIdentity('/p', 'sup'); // 1
    setSupervisorIdentity('/p', 'sup'); // 2
    try {
      assertSupervisorOwner(1);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SupersededError);
      const se = e as SupersededError;
      expect(se.superseded).toBe(true);
      expect(se.callerEpoch).toBe(1);
      expect(se.currentEpoch).toBe(2);
      expect(se.currentSession).toBe('sup');
    }
  });

  // The integration acceptance (split-brain), expressed at the store layer where
  // the fence lives: register A (epoch 1) → register B (epoch 2) → A is fenced on
  // every mutating path, B succeeds, and A's heartbeat cannot resurrect ownership.
  it('split-brain: superseded A is fenced everywhere; B owns; A cannot heartbeat back', () => {
    const epochA = setSupervisorIdentity('/p', 'sup'); // A claims, epoch 1
    const epochB = setSupervisorIdentity('/p', 'sup'); // B (respawn) claims, epoch 2
    expect(epochA).toBe(1);
    expect(epochB).toBe(2);

    // A (epoch 1) is rejected on the guarded path; B (epoch 2) passes.
    expect(() => assertSupervisorOwner(epochA)).toThrow(SupersededError);
    expect(() => assertSupervisorOwner(epochB)).not.toThrow();

    // A's heartbeat is a NO-OP (cannot resurrect ownership); B's advances liveness.
    expect(touchSupervisorIdentity(epochA)).toBe(false);
    expect(touchSupervisorIdentity(epochB)).toBe(true);

    // The server's own un-epoched heartbeat keeps the CURRENT owner alive.
    expect(touchSupervisorIdentity()).toBe(true);
  });
});
