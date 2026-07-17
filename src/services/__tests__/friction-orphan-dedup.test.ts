import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordFriction, recordFrictionOnce, listFriction, hasFrictionNote, _closeProject } from '../friction-store';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'friction-orphan-')); });
afterEach(() => { _closeProject(project); rmSync(project, { recursive: true, force: true }); });

const DIR = '/tmp/worktrees/session-abc';
const REASON = 'orphan-unregistered';
const detail = `orphan non-leaf worktree left in place: ${DIR}`;

// Replicates flagOrphan's durable-dedup path (reaper.ts:269-280).
async function flagOnce() {
  if (!hasFrictionNote(project, { layer: 'operational', retryReason: REASON, detailIncludes: DIR })) {
    await recordFriction(project, { layer: 'operational', retryReason: REASON, detail });
  }
}

describe('flagOrphan durable dedup', () => {
  it('records the first-ever orphan note (0 -> 1)', async () => {
    expect(listFriction(project, { layer: 'operational' }).length).toBe(0);
    await flagOnce();
    expect(listFriction(project, { layer: 'operational' })
      .filter((n) => n.retryReason === REASON && (n.detail ?? '').includes(DIR)).length).toBe(1);
  });

  it('does NOT record a duplicate on the second pass (stays 1)', async () => {
    await flagOnce();
    await flagOnce();
    expect(listFriction(project, { layer: 'operational' })
      .filter((n) => n.retryReason === REASON && (n.detail ?? '').includes(DIR)).length).toBe(1);
  });

  it('hasFrictionNote is false before and true after the first record', async () => {
    expect(hasFrictionNote(project, { layer: 'operational', retryReason: REASON, detailIncludes: DIR })).toBe(false);
    await flagOnce();
    expect(hasFrictionNote(project, { layer: 'operational', retryReason: REASON, detailIncludes: DIR })).toBe(true);
  });
});

describe('recordFrictionOnce — atomic race-proof dedup', () => {
  it('N=3 sequential passes over the SAME dir → exactly 1 note total (0 new on passes 2..3)', async () => {
    const r1 = await recordFrictionOnce(project, { layer: 'operational', retryReason: REASON, detail });
    const r2 = await recordFrictionOnce(project, { layer: 'operational', retryReason: REASON, detail });
    const r3 = await recordFrictionOnce(project, { layer: 'operational', retryReason: REASON, detail });
    expect(r1).toBe(true);
    expect(r2).toBe(false);
    expect(r3).toBe(false);
    expect(listFriction(project, { layer: 'operational' })
      .filter((n) => n.retryReason === REASON && n.detail === detail).length).toBe(1);
  });

  it('CONCURRENT overlapping passes over the SAME dir → exactly 1 note total', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        recordFrictionOnce(project, { layer: 'operational', retryReason: REASON, detail })),
    );
    expect(results.filter(Boolean).length).toBe(1);
    expect(listFriction(project, { layer: 'operational' })
      .filter((n) => n.retryReason === REASON && n.detail === detail).length).toBe(1);
  });
});
