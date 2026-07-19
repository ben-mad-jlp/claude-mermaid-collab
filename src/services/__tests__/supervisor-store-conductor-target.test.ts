import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sup-store-conductor-target-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import { addWatchedProject, getConductorTargetMission, setConductorTargetMission, listWatchedProjects, _closeDb } from '../supervisor-store';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

describe('per-project conductor target mission', () => {
  it('defaults to null for a freshly watched project', () => {
    addWatchedProject('/proj/ct-a');
    expect(getConductorTargetMission('/proj/ct-a')).toBeNull();
  });

  it('null for an unknown project', () => {
    expect(getConductorTargetMission('/proj/ct-unknown')).toBeNull();
  });

  it('set then get round-trips', () => {
    addWatchedProject('/proj/ct-b');
    setConductorTargetMission('/proj/ct-b', 'mission-123');
    expect(getConductorTargetMission('/proj/ct-b')).toBe('mission-123');
  });

  it('set(null) clears back to null', () => {
    addWatchedProject('/proj/ct-c');
    setConductorTargetMission('/proj/ct-c', 'mission-456');
    expect(getConductorTargetMission('/proj/ct-c')).toBe('mission-456');
    setConductorTargetMission('/proj/ct-c', null);
    expect(getConductorTargetMission('/proj/ct-c')).toBeNull();
  });

  it('is UPDATE-only (does not create a watched_project row if absent)', () => {
    setConductorTargetMission('/proj/ct-d', 'mission-789');
    expect(getConductorTargetMission('/proj/ct-d')).toBeNull();
    expect(listWatchedProjects().some((p) => p.project === '/proj/ct-d')).toBe(false);
  });

  it('re-running the migration (fresh openDb) is a no-op — column persists across close/reopen', () => {
    addWatchedProject('/proj/ct-e');
    setConductorTargetMission('/proj/ct-e', 'mission-again');
    _closeDb();
    expect(getConductorTargetMission('/proj/ct-e')).toBe('mission-again');
  });
});
