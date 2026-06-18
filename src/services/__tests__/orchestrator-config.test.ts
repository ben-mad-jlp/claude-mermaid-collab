import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'orch-config-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  ORCH_LEVELS,
  levelRank,
  coalesceLevel,
  getOrchestratorLevel,
  setOrchestratorLevel,
  _closeDb,
} from '../orchestrator-config';

beforeAll(() => { _closeDb(); });
afterAll(() => {
  _closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('ORCH_LEVELS', () => {
  it('contains exactly the three canonical levels in order', () => {
    expect(ORCH_LEVELS).toEqual(['off', 'on', 'auto']);
  });
});

describe('levelRank', () => {
  it('off=0, on=1, auto=2', () => {
    expect(levelRank('off')).toBe(0);
    expect(levelRank('on')).toBe(1);
    expect(levelRank('auto')).toBe(2);
  });

  it('ranks are strictly ordered (off < on < auto)', () => {
    for (let i = 0; i < ORCH_LEVELS.length - 1; i++) {
      expect(levelRank(ORCH_LEVELS[i])).toBeLessThan(levelRank(ORCH_LEVELS[i + 1]));
    }
  });
});

describe('coalesceLevel — legacy 5-rung → off/on/auto', () => {
  it('collapses build|nudge|propose → on, drive → auto, off/on/auto pass through', () => {
    expect(coalesceLevel('off')).toBe('off');
    expect(coalesceLevel('build')).toBe('on');
    expect(coalesceLevel('nudge')).toBe('on');
    expect(coalesceLevel('propose')).toBe('on');
    expect(coalesceLevel('drive')).toBe('auto');
    expect(coalesceLevel('on')).toBe('on');
    expect(coalesceLevel('auto')).toBe('auto');
  });
  it('unknown / undefined → on (supervised default)', () => {
    expect(coalesceLevel('totally-unknown')).toBe('on');
    expect(coalesceLevel(undefined)).toBe('on');
  });
});

describe('getOrchestratorLevel default', () => {
  it('returns "on" for an unregistered project', () => {
    expect(getOrchestratorLevel('/never/registered')).toBe('on');
  });
});

describe('set → get round-trip', () => {
  it('persists each canonical level correctly', () => {
    for (const level of ORCH_LEVELS) {
      const project = `/proj/${level}`;
      setOrchestratorLevel(project, level);
      expect(getOrchestratorLevel(project)).toBe(level);
    }
  });

  it('updates an existing row', () => {
    const project = '/proj/update-test';
    setOrchestratorLevel(project, 'off');
    expect(getOrchestratorLevel(project)).toBe('off');
    setOrchestratorLevel(project, 'auto');
    expect(getOrchestratorLevel(project)).toBe('auto');
  });
});

describe('legacy read coalescing', () => {
  it('a row persisted as a legacy value reads back coalesced', () => {
    // getOrchestratorLevel coalesces on read even if a legacy value lingers
    // (the backfill collapses stored rows; this guards the read seam too).
    setOrchestratorLevel('/proj/legacy', 'drive' as never);
    expect(getOrchestratorLevel('/proj/legacy')).toBe('auto');
    setOrchestratorLevel('/proj/legacy2', 'build' as never);
    expect(getOrchestratorLevel('/proj/legacy2')).toBe('on');
  });
});

describe('unknown value clamping', () => {
  it('setOrchestratorLevel clamps unknown values to "on"', () => {
    setOrchestratorLevel('/proj/bad', 'totally-unknown' as never);
    expect(getOrchestratorLevel('/proj/bad')).toBe('on');
  });
});
