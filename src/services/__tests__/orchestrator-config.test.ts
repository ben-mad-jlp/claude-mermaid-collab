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
  it('contains exactly the five canonical levels in order', () => {
    expect(ORCH_LEVELS).toEqual(['off', 'build', 'nudge', 'propose', 'consult']);
  });
});

describe('levelRank', () => {
  it('off=0, build=1, nudge=2, propose=3, consult=4', () => {
    expect(levelRank('off')).toBe(0);
    expect(levelRank('build')).toBe(1);
    expect(levelRank('nudge')).toBe(2);
    expect(levelRank('propose')).toBe(3);
    expect(levelRank('consult')).toBe(4);
  });

  it('ranks are strictly ordered (off < build < nudge < propose < consult)', () => {
    for (let i = 0; i < ORCH_LEVELS.length - 1; i++) {
      expect(levelRank(ORCH_LEVELS[i])).toBeLessThan(levelRank(ORCH_LEVELS[i + 1]));
    }
  });
});

describe('getOrchestratorLevel default', () => {
  it('returns "build" for an unregistered project', () => {
    expect(getOrchestratorLevel('/never/registered')).toBe('build');
  });
});

describe('set → get round-trip', () => {
  it('persists each level correctly', () => {
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
    setOrchestratorLevel(project, 'consult');
    expect(getOrchestratorLevel(project)).toBe('consult');
  });
});

describe('unknown value clamping', () => {
  it('setOrchestratorLevel clamps unknown values to "build"', () => {
    // Cast through `never` to simulate a caller passing a bad string at runtime.
    setOrchestratorLevel('/proj/bad', 'totally-unknown' as never);
    // The coerce() inside setOrchestratorLevel maps unknown → 'build'.
    expect(getOrchestratorLevel('/proj/bad')).toBe('build');
  });
});
