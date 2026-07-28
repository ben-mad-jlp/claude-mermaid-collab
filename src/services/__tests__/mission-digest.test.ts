import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'mission-digest-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;
let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-digest-'));
});

// Imports AFTER the env is set so any db opens against our temp dir.
import {
  writeMissionDigest,
  readMissionDigest,
  deleteMissionDigest,
  resolveActiveMissionDigest,
} from '../mission-digest';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { _resetMissionDbCache, activateMission } from '../mission-store';
import { _closeProject as closeDecisions } from '../decision-record-store';
import { _closeProject as closeTodos } from '../todo-store';
import { writeProjectDigest } from '../project-digest';
import { composeInjectedContext } from '../prompt-injection';

afterEach(() => {
  _resetMissionDbCache(project);
  closeDecisions(project);
  closeTodos(project);
  rmSync(project, { recursive: true, force: true });
});

describe('mission-digest — write/read/delete round-trip', () => {
  test('write → read normalises trailing newline and round-trips', () => {
    writeMissionDigest(project, 'm1', '# hello');
    expect(readMissionDigest(project, 'm1')).toBe('# hello\n');
  });

  test('write preserves an already-trailing newline (no double newline)', () => {
    writeMissionDigest(project, 'm1', '# hello\n');
    expect(readMissionDigest(project, 'm1')).toBe('# hello\n');
  });

  test('delete → subsequent read is null', () => {
    writeMissionDigest(project, 'm1', '# hello');
    deleteMissionDigest(project, 'm1');
    expect(readMissionDigest(project, 'm1')).toBeNull();
  });

  test('readMissionDigest on an absent file returns null', () => {
    expect(readMissionDigest(project, 'missing')).toBeNull();
  });

  test('readMissionDigest on an unreadable dir returns null', () => {
    const dir = join(project, '.collab', 'mission-digests');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'locked.md');
    writeFileSync(path, '# secret');
    chmodSync(path, 0o000);
    try {
      expect(readMissionDigest(project, 'locked')).toBeNull();
    } finally {
      chmodSync(path, 0o644); // restore so temp-dir cleanup can remove it
    }
  });

  test('deleteMissionDigest on an absent file never throws', () => {
    expect(() => deleteMissionDigest(project, 'missing')).not.toThrow();
  });
});

describe('resolveActiveMissionDigest', () => {
  test('returns the single active mission digest', async () => {
    const r = await forgeMission(project, {
      session: 's1',
      title: 'The only active mission',
      criteria: ['it works'],
      digest: '# active mission orientation',
    });
    expect(resolveActiveMissionDigest(project)).toContain('active mission orientation');
    void r;
  });

  test('a second forge enqueues rather than creating a second active — the single active mission digest resolves (7721f2db)', async () => {
    // One-active-per-project (mission 7721f2db): forging a second mission does NOT create a
    // rival active mission — it is enqueued behind the first, which stays active. So the digest
    // resolves unambiguously to the single active mission's digest, never the project fallback.
    // (This replaces the old 'two active missions → ambiguous → project digest' case: two
    // active missions are no longer constructible.)
    await forgeMission(project, {
      session: 's1',
      title: 'First active mission',
      criteria: ['it works'],
      digest: '# first',
    });
    await forgeMission(project, {
      session: 's2',
      title: 'Second mission (enqueued, not a second active)',
      criteria: ['it works'],
      digest: '# second',
    });
    await writeProjectDigest(project);
    expect(existsSync(join(project, '.collab', 'project-digest.md'))).toBe(true);
    const resolved = resolveActiveMissionDigest(project);
    expect(resolved).toContain('# first');
    expect(resolved).not.toContain('# second');
  });

  test('no mission at all falls back to the project digest', async () => {
    await writeProjectDigest(project);
    const expected = readFileSync(join(project, '.collab', 'project-digest.md'), 'utf-8');
    expect(resolveActiveMissionDigest(project)).toBe(expected);
  });

  test('no mission and no project digest returns null', () => {
    expect(resolveActiveMissionDigest(project)).toBeNull();
  });
});

describe('mission-scoped digest — queued forge never moves the live payload', () => {
  test('queuing a second mission does not move the live blueprint payload; activating it does', async () => {
    const FLAGS = { digest: true, retryContext: false, activeConstraints: false };

    const a = await forgeMission(project, {
      session: 's1',
      title: 'Steering',
      criteria: ['it works'],
      digest: '# DIGEST-A orientation',
    });
    const payloadA = composeInjectedContext({ project, kind: 'blueprint', flags: FLAGS });

    const b = await forgeMission(project, {
      session: 's1',
      title: 'Converter',
      criteria: ['it works'],
      digest: '# DIGEST-B orientation',
      activate: false,
    });

    const after = composeInjectedContext({ project, kind: 'blueprint', flags: FLAGS });
    expect(after).toBe(payloadA);
    expect(after).toContain('DIGEST-A');
    expect(after).not.toContain('DIGEST-B');

    expect(readMissionDigest(project, b.missionId)).toContain('DIGEST-B');
    expect(existsSync(join(project, '.collab', 'project-digest.md'))).toBe(false);

    activateMission(project, b.missionId);
    const swapped = composeInjectedContext({ project, kind: 'blueprint', flags: FLAGS });
    expect(swapped).toContain('DIGEST-B');
    expect(swapped).not.toContain('DIGEST-A');

    void a;
  });
});
