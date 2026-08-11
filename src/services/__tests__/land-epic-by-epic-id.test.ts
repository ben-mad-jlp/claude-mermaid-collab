/**
 * Tests for landEpic's epicId parameter — landing an epic directly without a card.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'land-by-epicid-'));
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

describe('land_epic with epicId parameter', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'land-epicid-repo-'));
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

  it('lands by epicId with zero escalation rows', async () => {
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });
    const commit1 = commitFile(project, 'file1.txt', 'content 1\n', 'commit 1');
    execFileSync('git', ['checkout', 'master'], { cwd: project });

    const adopted = await adoptBranchAsEpic(project, 'test-session', { source: 'scratch', title: 'direct land' });

    // Verify NO escalation cards exist for this project
    const before = listOpenEscalations({ project, kind: 'epic-ready-to-land' });
    expect(before.length).toBe(0);

    // Land directly by epicId, with no card
    const outcome = await landEpic(project, { epicId: adopted.epicId }, undefined, greenProofDeps());

    expect(outcome.ok).toBe(true);
    expect(outcome.landed).toBe(true);
    const masterAfter = git(project, ['rev-parse', 'master']);
    expect(outcome.masterSha).toBe(masterAfter);

    // Verify still no escalation cards
    const after = listOpenEscalations({ project, kind: 'epic-ready-to-land' });
    expect(after.length).toBe(0);
  }, { timeout: REAL_GIT_TIMEOUT_MS });

  it('refuses when neither escalationId nor epicId is supplied', async () => {
    const outcome = await landEpic(project, {} as any);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('missing-land-target');
  });

  it('refuses when both escalationId and epicId are supplied', async () => {
    const outcome = await landEpic(project, { escalationId: 'esc1', epicId: 'epic1' } as any);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('ambiguous-land-target');
  });

  it('resolves a pre-existing open epic-ready-to-land card after landing by epicId', async () => {
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });
    const commit1 = commitFile(project, 'file1.txt', 'content 1\n', 'commit 1');
    execFileSync('git', ['checkout', 'master'], { cwd: project });

    const adopted = await adoptBranchAsEpic(project, 'test-session', { source: 'scratch', title: 'pre-existing card' });

    // Create an open card that links to this epic
    const { escalation } = createEscalation({
      project,
      audience: 'internal',
      session: 'test-session',
      kind: 'epic-ready-to-land',
      todoId: adopted.epicId,
      questionText: 'ready to land',
    });

    expect(escalation.status).toBe('open');

    // Land by epicId (not escalationId) — resolver should find and resolve the card
    const outcome = await landEpic(project, { epicId: adopted.epicId }, undefined, greenProofDeps());

    expect(outcome.ok).toBe(true);
    expect(outcome.landed).toBe(true);

    // Verify the card was resolved
    const openCards = listOpenEscalations({ project, kind: 'epic-ready-to-land' });
    expect(openCards.length).toBe(0);
  }, { timeout: REAL_GIT_TIMEOUT_MS });
});
