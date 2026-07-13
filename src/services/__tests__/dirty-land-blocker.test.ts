import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-dirty-land-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { surfaceDirtyLandBlocker, type LandEpicOutcome } from '../coordinator-live';
import { listOpenEscalations, _closeDb as _closeSupervisorDb } from '../supervisor-store';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

const dirtyOutcome: LandEpicOutcome = {
  ok: false, landed: false, reason: 'dirty-tree',
  epicId: 'abcdef12-3456-7890-aaaa-bbbbbbbbbbbb', epicBranch: 'epic/abcdef12',
  dirtyPaths: ['src/z.ts', 'src/a.ts'],
};

describe('surfaceDirtyLandBlocker — operator-visible dirty-tree warning', () => {
  let project: string;
  beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'dirty-land-proj-')); });
  afterEach(() => { try { rmSync(project, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('a dirty-tree auto-land refusal produces exactly one operator-visible card naming the dirty paths', () => {
    const res = surfaceDirtyLandBlocker(project, 'coordinator', dirtyOutcome,
      { epicId: dirtyOutcome.epicId!, epicBranch: dirtyOutcome.epicBranch!, todoId: null });
    expect(res).not.toBeNull();
    expect(res!.isNew).toBe(true);
    // names the dirty path(s), sorted-stable
    expect(res!.escalation.questionText).toContain('src/a.ts, src/z.ts');
    expect(res!.escalation.kind).toBe('blocker');

    const open = listOpenEscalations().filter((e) => e.project === project);
    expect(open.length).toBe(1);
    expect(open[0].questionText).toContain('src/a.ts, src/z.ts');
  });

  it('dedups a repeated refusal (stable questionText) to ONE card', () => {
    const a = surfaceDirtyLandBlocker(project, 'coordinator', dirtyOutcome,
      { epicId: dirtyOutcome.epicId!, epicBranch: dirtyOutcome.epicBranch!, todoId: null });
    const b = surfaceDirtyLandBlocker(project, 'coordinator', dirtyOutcome,
      { epicId: dirtyOutcome.epicId!, epicBranch: dirtyOutcome.epicBranch!, todoId: null });
    expect(a!.isNew).toBe(true);
    expect(b!.isNew).toBe(false);
    expect(b!.escalation.id).toBe(a!.escalation.id);
    expect(listOpenEscalations().filter((e) => e.project === project).length).toBe(1);
  });

  it('does not change the (unlanded) outcome and surfaces nothing on a landed outcome', () => {
    // outcome is the input contract — the helper never mutates it
    expect(dirtyOutcome.landed).toBe(false);
    expect(dirtyOutcome.reason).toBe('dirty-tree');
    const landed: LandEpicOutcome = { ok: true, landed: true, reason: 'landed' };
    const res = surfaceDirtyLandBlocker(project, 'coordinator', landed,
      { epicId: 'x', epicBranch: 'epic/x', todoId: null });
    expect(res).toBeNull();
    expect(landed.landed).toBe(true);
    expect(listOpenEscalations().filter((e) => e.project === project).length).toBe(0);
  });
});
