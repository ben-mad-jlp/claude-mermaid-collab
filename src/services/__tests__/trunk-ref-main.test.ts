/**
 * Trunk-ref regression: a repo whose trunk is `main` (NO `master` ref) must be
 * adopted correctly. Before the trunk-ref fix, adoptBranchAsEpic hardcoded
 * `master..<source>` / "no commits ahead of master" and refused only literal
 * 'master' — so on a main-trunk repo it either enumerated nothing (rev-list
 * against a non-existent ref) or failed to refuse the trunk itself.
 *
 * Two layers of coverage:
 *   1. detectBaseTrunk unit test — returns 'main' on a main-only repo, 'master'
 *      on a master-only repo (the extracted resolver).
 *   2. Full-service drive against a temp main-trunk repo — asserts adoption
 *      (a) does NOT throw "no commits ahead of master", (b) enumerates the topic
 *      branch's commit against `main`, (c) still refuses when source IS the trunk.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'trunk-ref-main-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { adoptBranchAsEpic, detectBaseTrunk, runGit } from '../adopt-branch-as-epic.js';
import { listTodos, _closeProject } from '../todo-store.js';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store.js';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd });
}

describe('detectBaseTrunk resolver', () => {
  let repo: string;
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  it('returns "main" on a main-only repo (no master ref)', async () => {
    repo = mkdtempSync(join(tmpdir(), 'trunk-ref-main-only-'));
    git(repo, ['init']);
    git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    writeFileSync(join(repo, 'f.txt'), 'x\n');
    git(repo, ['add', 'f.txt']);
    git(repo, ['commit', '-m', 'init']);

    expect(await detectBaseTrunk(repo, runGit)).toBe('main');
  });

  it('returns "master" on a master-only repo (behaviour-preserving)', async () => {
    repo = mkdtempSync(join(tmpdir(), 'trunk-ref-master-only-'));
    git(repo, ['init']);
    git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/master']);
    writeFileSync(join(repo, 'f.txt'), 'x\n');
    git(repo, ['add', 'f.txt']);
    git(repo, ['commit', '-m', 'init']);

    expect(await detectBaseTrunk(repo, runGit)).toBe('master');
  });
});

describe('adoptBranchAsEpic on a main-trunk repo', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'trunk-ref-main-repo-'));
    git(project, ['init']);
    git(project, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    // The per-project collab store writes .collab/ into the repo; gitignore it so the
    // main checkout stays clean (mirrors real repos and satisfies the dirty-tree guard).
    writeFileSync(join(project, '.gitignore'), '.collab/\n');
    git(project, ['add', '.gitignore']);
    git(project, ['commit', '-m', 'gitignore collab']);
    _closeProject(project);
  });

  afterEach(() => {
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  });

  it('(a)+(b) adopts a topic branch, enumerating its commits against main (no "ahead of master" throw)', async () => {
    // main with one commit
    writeFileSync(join(project, 'initial.txt'), 'initial\n');
    git(project, ['add', 'initial.txt']);
    git(project, ['commit', '-m', 'initial']);
    const topicCommitParent = execFileSync('git', ['rev-parse', 'main'], { cwd: project }).toString('utf8').trim();

    // topic branch with one commit ahead of main
    git(project, ['checkout', '-b', 'topic']);
    writeFileSync(join(project, 'topic.txt'), 'topic\n');
    git(project, ['add', 'topic.txt']);
    git(project, ['commit', '-m', 'topic commit']);
    const topicSha = execFileSync('git', ['rev-parse', 'topic'], { cwd: project }).toString('utf8').trim();

    // back to a clean main checkout
    git(project, ['checkout', 'main']);

    const result = await adoptBranchAsEpic(project, 'test-session', {
      source: 'topic',
      title: 'main-trunk adoption',
    });

    // (b) enumerated exactly the one commit ahead of main (not zero, not the base)
    expect(result.commits[0]).toBe(topicSha);
    expect(result.commits.at(-1)).toBe(result.trailerCommit);
    for (const sha of result.commits) {
      const isAncestor = execFileSync('git', ['merge-base', '--is-ancestor', sha, result.epicBranch], { cwd: project });
      expect(isAncestor).toEqual(Buffer.from(''));
    }
    expect(result.commits).not.toContain(topicCommitParent);
    expect(result.epicBranch).toMatch(/^collab\/epic\//);
    const epicBranchSha = execFileSync('git', ['rev-parse', result.epicBranch], { cwd: project }).toString('utf8').trim();
    expect(epicBranchSha).toBe(result.trailerCommit);
    const topicIsAncestor = execFileSync('git', ['merge-base', '--is-ancestor', topicSha, result.epicBranch], { cwd: project });
    expect(topicIsAncestor).toEqual(Buffer.from(''));

    // main must be untouched
    const mainAfter = execFileSync('git', ['rev-parse', 'main'], { cwd: project }).toString('utf8').trim();
    expect(mainAfter).toBe(topicCommitParent);
  });

  it('(c) refuses when the source IS the trunk (main)', async () => {
    writeFileSync(join(project, 'initial.txt'), 'initial\n');
    git(project, ['add', 'initial.txt']);
    git(project, ['commit', '-m', 'initial']);

    const todosBefore = listTodos(project, {}).length;

    let error: Error | null = null;
    try {
      await adoptBranchAsEpic(project, 'test-session', {
        source: 'main',
        title: 'adopt main itself',
      });
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    expect(error!.message).toContain('cannot adopt main');
    // zero mutation
    expect(listTodos(project, {}).length).toBe(todosBefore);
  });

  it('(c2) refuses when source resolves to the same SHA as main (alias branch)', async () => {
    writeFileSync(join(project, 'initial.txt'), 'initial\n');
    git(project, ['add', 'initial.txt']);
    git(project, ['commit', '-m', 'initial']);
    // alias branch pointing at main's tip
    git(project, ['branch', 'alias', 'main']);

    let error: Error | null = null;
    try {
      await adoptBranchAsEpic(project, 'test-session', {
        source: 'alias',
        title: 'adopt alias of main',
      });
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    expect(error!.message).toContain('cannot adopt main');
  });
});
