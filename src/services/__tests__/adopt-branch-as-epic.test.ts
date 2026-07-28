/**
 * Test adoptBranchAsEpic end-to-end: resolves a source ref, captures commits,
 * creates an epic + leaf, marks the leaf accepted, creates a branch, and
 * leaves master untouched.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'adopt-branch-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { adoptBranchAsEpic } from '../adopt-branch-as-epic.js';
import { getTodo, _closeProject } from '../todo-store.js';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store.js';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('adoptBranchAsEpic', () => {
  let project: string;

  beforeEach(async () => {
    project = mkdtempSync(join(tmpdir(), 'adopt-branch-repo-'));
    execFileSync('git', ['init'], { cwd: project });
    // Force the default branch name to master (git init's default is not guaranteed)
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/master'], { cwd: project });
    _closeProject(project);
  });

  afterEach(() => {
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  });

  it('adopts a branch with commits, creates epic+leaf, marks leaf accepted, creates branch at source, leaves master untouched', async () => {
    // Setup: commit an initial file on master
    writeFileSync(join(project, 'initial.txt'), 'initial content\n');
    execFileSync('git', ['add', 'initial.txt'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: project });

    // Create a scratch branch with 2 commits
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });
    writeFileSync(join(project, 'file1.txt'), 'content 1\n');
    execFileSync('git', ['add', 'file1.txt'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'commit 1'], { cwd: project });

    writeFileSync(join(project, 'file2.txt'), 'content 2\n');
    execFileSync('git', ['add', 'file2.txt'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'commit 2'], { cwd: project });

    // Checkout back to master (this is in the test, not the implementation)
    execFileSync('git', ['checkout', 'master'], { cwd: project });

    // Record master SHA before adoption
    const masterBefore = execFileSync('git', ['rev-parse', 'master'], { cwd: project }).toString('utf8').trim();

    // Adopt the scratch branch
    const result = await adoptBranchAsEpic(project, 'test-session', {
      source: 'scratch',
      title: 'adopted work',
    });

    // Assert: epic and leaf were created
    expect(result.epicId).toMatch(/^[a-f0-9\-]+$/);
    expect(result.leafId).toMatch(/^[a-f0-9\-]+$/);
    expect(result.epicBranch).toMatch(/^collab\/epic\//);
    expect(result.commits).toHaveLength(2);

    // Assert: leaf is accepted
    const leaf = getTodo(project, result.leafId);
    expect(leaf).not.toBeNull();
    expect(leaf!.status).toBe('done');
    expect(leaf!.acceptanceStatus).toBe('accepted');
    expect(leaf!.parentId).toBe(result.epicId);

    // Assert: commits are on the epic branch
    for (const sha of result.commits) {
      const isMergeBase = execFileSync('git', ['merge-base', '--is-ancestor', sha, result.epicBranch], {
        cwd: project,
      });
      // merge-base --is-ancestor exits 0 if sha is an ancestor
      expect(isMergeBase).toEqual(Buffer.from(''));
    }

    // Assert: master is untouched
    const masterAfter = execFileSync('git', ['rev-parse', 'master'], { cwd: project }).toString('utf8').trim();
    expect(masterAfter).toBe(masterBefore);
  });

  it('throws when source has no commits ahead of master', async () => {
    // Setup: commit an initial file on master
    writeFileSync(join(project, 'initial.txt'), 'initial content\n');
    execFileSync('git', ['add', 'initial.txt'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: project });

    // Adopt master (which has no commits ahead of itself)
    let error: Error | null = null;
    try {
      await adoptBranchAsEpic(project, 'test-session', {
        source: 'master',
        title: 'empty adoption',
      });
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    expect(error!.message).toContain('source has no commits ahead of master');
  });

  it('throws when source ref does not resolve', async () => {
    // Setup: commit an initial file
    writeFileSync(join(project, 'initial.txt'), 'initial content\n');
    execFileSync('git', ['add', 'initial.txt'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: project });

    // Adopt a nonexistent ref
    let error: Error | null = null;
    try {
      await adoptBranchAsEpic(project, 'test-session', {
        source: 'nonexistent-ref-xyz',
        title: 'bad ref',
      });
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    expect(error!.message).toContain('failed to resolve source');
  });
});
