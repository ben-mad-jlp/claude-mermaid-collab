/**
 * Tests for landEpic's epicId parameter — three criterion-named cases.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'land-by-id-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { landEpic, defaultLandStageDeps, type LandStageDeps } from '../coordinator-land';
import { adoptBranchAsEpic } from '../adopt-branch-as-epic.js';
import { _closeProject } from '../todo-store';
import {
  createEscalation,
  addWatchedProject,
  setProjectDigestEnabled,
  listOpenEscalations,
  _closeDb as _closeSupervisorDb,
} from '../supervisor-store';
import type { EpicLandGateResult } from '../epic-land-gate';
import { getWorktreeManager } from '../coordinator-live';

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

describe('land_epic with epicId parameter (three criterion-named cases)', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'land-by-id-repo-'));
    execFileSync('git', ['init'], { cwd: project });
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/master'], { cwd: project });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: project });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: project });
    commitFile(project, '.gitignore', '.collab/\n', 'gitignore');
    commitFile(project, 'initial.txt', 'initial content\n', 'initial');
    _closeProject(project);

    addWatchedProject(project);
    setProjectDigestEnabled(project, false);
  });

  afterEach(() => {
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  });

  it('reaches the gate stage when supplied only an epicId', async () => {
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });
    const commit1 = commitFile(project, 'file1.txt', 'content 1\n', 'commit 1');
    execFileSync('git', ['checkout', 'master'], { cwd: project });

    const adopted = await adoptBranchAsEpic(project, 'test-session', { source: 'scratch', title: 'test' });

    // Verify NO escalation cards exist before
    const before = listOpenEscalations({ project, kind: 'epic-ready-to-land' });
    expect(before.length).toBe(0);

    // Build deps with a spy that captures positional args 2 and 3 (epicId, epicBranch)
    let capturedEpicId: string | undefined;
    let capturedEpicBranch: string | undefined;
    let callCount = 0;

    const deps = greenProofDeps({
      runProofStage: async (
        project: any,
        targetProject: any,
        epicId: any,
        epicBranch: any,
        ...rest: any[]
      ) => {
        capturedEpicId = epicId;
        capturedEpicBranch = epicBranch;
        callCount++;
        return { ok: true, proof: { ok: true, reason: 'ok', gate: GREEN_GATE } };
      },
    });

    const outcome = await landEpic(project, { epicId: adopted.epicId }, undefined, deps);

    // Assert: call count, captured values, and successful outcome
    expect(callCount).toBe(1);
    expect(capturedEpicId).toBe(adopted.epicId);
    expect(capturedEpicBranch).toBe(getWorktreeManager(project).epicBranchName(adopted.epicId));
    expect(outcome.ok).toBe(true);
  }, { timeout: REAL_GIT_TIMEOUT_MS });

  it('never answers escalation-not-found when no escalationId was supplied', async () => {
    // Part (a): adopt a branch and land by epicId without a card
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });
    commitFile(project, 'file2.txt', 'content 2\n', 'commit 2');
    execFileSync('git', ['checkout', 'master'], { cwd: project });

    const adopted = await adoptBranchAsEpic(project, 'test-session', { source: 'scratch', title: 'test' });

    const outcome1 = await landEpic(project, { epicId: adopted.epicId }, undefined, greenProofDeps());
    expect(outcome1.ok).toBe(true);
    expect(outcome1.reason).not.toBe('escalation-not-found');

    // Part (b): land by a bogus epicId — must answer 'todo-not-found' (epicId branch), not 'escalation-not-found'
    const outcome2 = await landEpic(project, { epicId: 'nonexistent-epic-id-0000' });
    expect(outcome2.ok).toBe(false);
    expect(outcome2.reason).toBe('todo-not-found');
  }, { timeout: REAL_GIT_TIMEOUT_MS });

  it('leaves an open epic-ready-to-land card open after a failed attempt', async () => {
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });
    commitFile(project, 'file3.txt', 'content 3\n', 'commit 3');
    execFileSync('git', ['checkout', 'master'], { cwd: project });

    const adopted = await adoptBranchAsEpic(project, 'test-session', { source: 'scratch', title: 'test' });

    // Create an open epic-ready-to-land card
    const { escalation } = createEscalation({
      project,
      audience: 'internal',
      session: 'test-session',
      kind: 'epic-ready-to-land',
      todoId: adopted.epicId,
      questionText: 'ready to land',
    });

    expect(escalation.status).toBe('open');

    // Record master before
    const masterBefore = git(project, ['rev-parse', 'master']);

    // Land with a failing proof stage (gate-refused)
    const deps = greenProofDeps({
      runProofStage: async () => ({
        ok: false,
        landed: false,
        reason: 'gate-refused',
      }),
    });

    const outcome = await landEpic(project, { epicId: adopted.epicId }, undefined, deps);

    // Assert: outcome failed, card still open, master unchanged
    expect(outcome.ok).toBe(false);
    const openCards = listOpenEscalations({ project, kind: 'epic-ready-to-land' });
    expect(openCards.some((c) => c.id === escalation.id)).toBe(true);
    const masterAfter = git(project, ['rev-parse', 'master']);
    expect(masterAfter).toBe(masterBefore);
  }, { timeout: REAL_GIT_TIMEOUT_MS });
});
