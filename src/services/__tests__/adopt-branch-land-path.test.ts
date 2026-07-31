/**
 * Land-path integration tests for an epic created via adoptBranchAsEpic: drives
 * landEpic against the REAL merge/mutex/teardown machinery (only the three
 * pre-proof stages and the proof stage itself are stubbed), proving an adopted
 * branch merges/conflicts/fails through landEpic exactly like a daemon-authored
 * epic would.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'adopt-land-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { landEpic, defaultLandStageDeps, landCondition, type LandStageDeps } from '../coordinator-land';
import { adoptBranchAsEpic } from '../adopt-branch-as-epic.js';
import { _closeProject } from '../todo-store';
import {
  createEscalation,
  addWatchedProject,
  setProjectDigestEnabled,
  listEscalations,
  _closeDb as _closeSupervisorDb,
} from '../supervisor-store';
import type { EpicLandGateResult } from '../epic-land-gate';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

const GREEN_GATE: EpicLandGateResult = {
  status: 'pass',
  declared: true,
  manifestPath: '',
  units: [],
  regressions: [],
  inherited: [],
  incidents: [],
  reasons: [],
  specFiles: [],
  epicTipSha: 'abc123',
  baseSha: 'def456',
};

/** Passthrough stubs for the three pre-proof stages, plus a green proof stage —
 *  every other stage stays the REAL defaultLandStageDeps implementation. */
function greenProofDeps(overrides?: Partial<LandStageDeps>): LandStageDeps {
  return {
    ...defaultLandStageDeps,
    checkDirtyTree: async () => ({ ok: true, dirty: [] }),
    runStewardPrecheck: async () => ({ ok: true, epic: null, epicChildIds: [] }),
    checkStaleness: async () => ({ ok: true }),
    runProofStage: async () => ({ ok: true, proof: { ok: true, reason: 'ok', gate: GREEN_GATE } }),
    ...(overrides ?? {}),
  } as LandStageDeps;
}

/** Wall-clock budget for the real-`git` land tests. The base gate runs 6 test
 *  files concurrently, so these subprocess-heavy cases need far more headroom
 *  than bun's 5s default. */
const REAL_GIT_TIMEOUT_MS = 60_000;

function git(project: string, args: string[]): string {
  return execFileSync('git', args, { cwd: project }).toString('utf8').trim();
}

function commitFile(project: string, file: string, content: string, message: string): string {
  writeFileSync(join(project, file), content);
  execFileSync('git', ['add', file], { cwd: project });
  execFileSync('git', ['commit', '-m', message], { cwd: project });
  return git(project, ['rev-parse', 'HEAD']);
}

describe('adopted-epic land path — real merge/mutex against a stubbed proof stage', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'adopt-land-repo-'));
    execFileSync('git', ['init'], { cwd: project });
    // Force the default branch name to master (git init's default is not guaranteed).
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/master'], { cwd: project });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: project });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: project });
    // adoptBranchAsEpic refuses a dirty main checkout, and todo-store/land bookkeeping
    // writes its sqlite files under .collab/ in this same repo — ignore that dir so it
    // never shows up as untracked-dirty ahead of a second adopt/land in the same test.
    commitFile(project, '.gitignore', '.collab/\n', 'gitignore');
    commitFile(project, 'initial.txt', 'initial content\n', 'initial');
    _closeProject(project);

    // Avoid a real (network-bound) digest regeneration firing off the tail of a
    // successful landEpic — refreshProjectDigestOnLand defaults digest-enabled
    // to true for an unwatched project.
    addWatchedProject(project);
    setProjectDigestEnabled(project, false);
  });

  afterEach(() => {
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  });

  it('lands a green adopted epic via a real --no-ff merge and serializes concurrent lands under the land mutex', async () => {
    // --- single-epic green land ---
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });
    const commit1 = commitFile(project, 'file1.txt', 'content 1\n', 'commit 1');
    execFileSync('git', ['checkout', 'master'], { cwd: project });

    const adopted = await adoptBranchAsEpic(project, 'test-session', { source: 'scratch', title: 'green land' });
    const { escalation } = createEscalation({
      project,
      audience: 'internal',
      session: 'test-session',
      kind: 'epic-ready-to-land',
      todoId: adopted.leafId,
      questionText: 'ready',
    });

    const outcome = await landEpic(project, escalation.id, undefined, greenProofDeps());

    expect(outcome.ok).toBe(true);
    expect(outcome.landed).toBe(true);
    const masterAfter = git(project, ['rev-parse', 'master']);
    expect(outcome.masterSha).toBe(masterAfter);
    expect(adopted.commits).toEqual([commit1]);
    for (const sha of adopted.commits) {
      const isAncestor = execFileSync('git', ['merge-base', '--is-ancestor', sha, 'master'], { cwd: project });
      expect(isAncestor).toEqual(Buffer.from(''));
    }

    // --- serialization proof: two concurrent adopted-epic lands on the SAME repo ---
    const markers: string[] = [];
    function instrumentedDeps(label: string): LandStageDeps {
      return greenProofDeps({
        runMerge: async (...args: Parameters<typeof defaultLandStageDeps.runMerge>) => {
          markers.push(`start:${label}`);
          const result = await defaultLandStageDeps.runMerge(...args);
          markers.push(`end:${label}`);
          return result;
        },
      });
    }

    execFileSync('git', ['checkout', '-b', 'scratch-a'], { cwd: project });
    commitFile(project, 'file-a.txt', 'content a\n', 'commit a');
    execFileSync('git', ['checkout', 'master'], { cwd: project });
    const adoptedA = await adoptBranchAsEpic(project, 'test-session', { source: 'scratch-a', title: 'mutex land a' });
    const { escalation: escA } = createEscalation({
      audience: 'internal',
      project, session: 'test-session', kind: 'epic-ready-to-land', todoId: adoptedA.leafId, questionText: `ready:${adoptedA.leafId}`,
    });

    execFileSync('git', ['checkout', '-b', 'scratch-b'], { cwd: project });
    commitFile(project, 'file-b.txt', 'content b\n', 'commit b');
    execFileSync('git', ['checkout', 'master'], { cwd: project });
    const adoptedB = await adoptBranchAsEpic(project, 'test-session', { source: 'scratch-b', title: 'mutex land b' });
    const { escalation: escB } = createEscalation({
      audience: 'internal',
      project, session: 'test-session', kind: 'epic-ready-to-land', todoId: adoptedB.leafId, questionText: `ready:${adoptedB.leafId}`,
    });

    const [outcomeA, outcomeB] = await Promise.all([
      landEpic(project, escA.id, undefined, instrumentedDeps(adoptedA.epicId)),
      landEpic(project, escB.id, undefined, instrumentedDeps(adoptedB.epicId)),
    ]);

    expect(outcomeA.ok).toBe(true);
    expect(outcomeA.landed).toBe(true);
    expect(outcomeB.ok).toBe(true);
    expect(outcomeB.landed).toBe(true);

    // No two epics' start/end marker pairs interleave — proves withLandMutex
    // serializes the two landEpic calls' runMerge windows per-project.
    expect(markers.length).toBe(4);
    let openEpic: string | null = null;
    for (const marker of markers) {
      const sep = marker.indexOf(':');
      const kind = marker.slice(0, sep);
      const label = marker.slice(sep + 1);
      if (kind === 'start') {
        expect(openEpic).toBeNull();
        openEpic = label;
      } else {
        expect(openEpic).toBe(label);
        openEpic = null;
      }
    }
    expect(openEpic).toBeNull();
    // Real `git` subprocesses, so the wall-clock budget has to survive the base
    // gate running 6 test files at a time — bun's 5s default was a coin-flip
    // (observed 5491ms) and false-redded the whole epic base.
  }, REAL_GIT_TIMEOUT_MS);

  it('a real merge conflict on the base leaves master untouched and raises an assumption-invalidated escalation', async () => {
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });
    commitFile(project, 'shared.txt', 'scratch content\n', 'scratch edit');
    execFileSync('git', ['checkout', 'master'], { cwd: project });

    const adopted = await adoptBranchAsEpic(project, 'test-session', { source: 'scratch', title: 'conflicting land' });

    // Author a commit DIRECTLY on master (outside the epic branch) that edits the SAME
    // file the adopted commit touched, so the real --no-ff merge hits a conflict.
    commitFile(project, 'shared.txt', 'master content\n', 'master edit');

    const { escalation } = createEscalation({
      project,
      audience: 'internal',
      session: 'test-session',
      kind: 'epic-ready-to-land',
      todoId: adopted.leafId,
      questionText: 'ready',
    });

    const masterBefore = git(project, ['rev-parse', 'master']);
    const outcome = await landEpic(project, escalation.id, undefined, greenProofDeps());

    expect(outcome.ok).toBe(false);
    expect(outcome.conflict).toBe(true);
    expect(outcome.reason).toBe('epic-merge-conflict');

    const masterAfter = git(project, ['rev-parse', 'master']);
    expect(masterAfter).toBe(masterBefore);

    const cond = landCondition('assumption-invalidated', [adopted.epicId.slice(0, 8), 'merge-conflict']);
    const matching = listEscalations('open').filter(
      (e) => e.project === project && e.conditionKey === cond.conditionKey,
    );
    expect(matching.length).toBe(1);
  }, REAL_GIT_TIMEOUT_MS);

  it('a red base gate short-circuits before the merge/teardown stages and leaves master untouched', async () => {
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });
    commitFile(project, 'file1.txt', 'content 1\n', 'commit 1');
    execFileSync('git', ['checkout', 'master'], { cwd: project });

    const adopted = await adoptBranchAsEpic(project, 'test-session', { source: 'scratch', title: 'red land' });
    const { escalation } = createEscalation({
      project,
      audience: 'internal',
      session: 'test-session',
      kind: 'epic-ready-to-land',
      todoId: adopted.leafId,
      questionText: 'ready',
    });

    const callOrder: string[] = [];
    const deps = {
      ...defaultLandStageDeps,
      checkDirtyTree: async () => { callOrder.push('checkDirtyTree'); return { ok: true, dirty: [] }; },
      runStewardPrecheck: async () => { callOrder.push('runStewardPrecheck'); return { ok: true, epic: null, epicChildIds: [] }; },
      checkStaleness: async () => { callOrder.push('checkStaleness'); return { ok: true }; },
      runProofStage: async () => {
        callOrder.push('runProofStage');
        return { ok: false, landed: false, reason: 'gate-failed', epicId: adopted.epicId, epicBranch: adopted.epicBranch };
      },
      runMerge: async (...args: Parameters<typeof defaultLandStageDeps.runMerge>) => {
        callOrder.push('runMerge');
        return defaultLandStageDeps.runMerge(...args);
      },
      teardownEpic: async (...args: Parameters<typeof defaultLandStageDeps.teardownEpic>) => {
        callOrder.push('teardownEpic');
        return defaultLandStageDeps.teardownEpic(...args);
      },
    } as LandStageDeps;

    const masterBefore = git(project, ['rev-parse', 'master']);
    const outcome = await landEpic(project, escalation.id, undefined, deps);

    expect(outcome.ok).toBe(false);
    expect(outcome.landed).toBe(false);
    expect(outcome.reason).toBe('gate-failed');
    expect(callOrder).not.toContain('runMerge');
    expect(callOrder).not.toContain('teardownEpic');

    const masterAfter = git(project, ['rev-parse', 'master']);
    expect(masterAfter).toBe(masterBefore);
  }, REAL_GIT_TIMEOUT_MS);
});
