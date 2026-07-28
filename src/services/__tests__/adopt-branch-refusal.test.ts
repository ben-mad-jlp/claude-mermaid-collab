/**
 * Test adoptBranchAsEpic refusal paths: master refusal, dirty checkout refusal,
 * and zero direct-to-master writes on successful adoption.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'adopt-branch-refusal-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { adoptBranchAsEpic, type AdoptBranchAsEpicDeps, defaultAdoptBranchAsEpicDeps, runGit } from '../adopt-branch-as-epic.js';
import { listTodos, _closeProject } from '../todo-store.js';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store.js';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('adoptBranchAsEpic refusal paths', () => {
  let project: string;

  beforeEach(async () => {
    project = mkdtempSync(join(tmpdir(), 'adopt-branch-refusal-repo-'));
    execFileSync('git', ['init'], { cwd: project });
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/master'], { cwd: project });
    _closeProject(project);
  });

  afterEach(() => {
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  });

  it('(a) refuses master as source, zero mutation', async () => {
    // Setup: commit one file on master
    writeFileSync(join(project, 'initial.txt'), 'initial content\n');
    execFileSync('git', ['add', 'initial.txt'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: project });

    // Snapshot before call
    const todosLengthBefore = listTodos(project, {}).length;
    const masterBefore = execFileSync('git', ['rev-parse', 'master'], { cwd: project }).toString('utf8').trim();
    const epicBranchesBefore = execFileSync('git', ['branch', '--list', 'collab/epic/*'], { cwd: project }).toString('utf8').trim();

    // Attempt to adopt master
    let error: Error | null = null;
    try {
      await adoptBranchAsEpic(project, 'test-session', {
        source: 'master',
        title: 'master adoption attempt',
      });
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    expect(error!.message).toContain('master');

    // Assert: no mutation
    const todosLengthAfter = listTodos(project, {}).length;
    const masterAfter = execFileSync('git', ['rev-parse', 'master'], { cwd: project }).toString('utf8').trim();
    const epicBranchesAfter = execFileSync('git', ['branch', '--list', 'collab/epic/*'], { cwd: project }).toString('utf8').trim();

    expect(todosLengthAfter).toBe(todosLengthBefore);
    expect(masterAfter).toBe(masterBefore);
    expect(epicBranchesAfter).toBe(epicBranchesBefore);
  });

  it('(b) refuses dirty checkout, zero mutation', async () => {
    // Setup: commit an initial file
    writeFileSync(join(project, 'initial.txt'), 'initial content\n');
    execFileSync('git', ['add', 'initial.txt'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: project });

    // Create a scratch branch with one commit
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });
    writeFileSync(join(project, 'scratch.txt'), 'scratch content\n');
    execFileSync('git', ['add', 'scratch.txt'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'scratch commit'], { cwd: project });

    // Checkout back to master
    execFileSync('git', ['checkout', 'master'], { cwd: project });

    // Write uncommitted edit to tracked file to make checkout dirty
    writeFileSync(join(project, 'initial.txt'), 'initial content\nDIRTY\n');

    // Snapshot before call
    const todosLengthBefore = listTodos(project, {}).length;
    const masterBefore = execFileSync('git', ['rev-parse', 'master'], { cwd: project }).toString('utf8').trim();
    const epicBranchesBefore = execFileSync('git', ['branch', '--list', 'collab/epic/*'], { cwd: project }).toString('utf8').trim();

    // Attempt to adopt scratch
    let error: Error | null = null;
    try {
      await adoptBranchAsEpic(project, 'test-session', {
        source: 'scratch',
        title: 'dirty checkout adoption attempt',
      });
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    expect(error!.message).toContain('dirty');
    expect(error!.message).toContain('initial.txt');

    // Assert: no mutation
    const todosLengthAfter = listTodos(project, {}).length;
    const masterAfter = execFileSync('git', ['rev-parse', 'master'], { cwd: project }).toString('utf8').trim();
    const epicBranchesAfter = execFileSync('git', ['branch', '--list', 'collab/epic/*'], { cwd: project }).toString('utf8').trim();

    expect(todosLengthAfter).toBe(todosLengthBefore);
    expect(masterAfter).toBe(masterBefore);
    expect(epicBranchesAfter).toBe(epicBranchesBefore);
  });

  it('(c) successful adopt with zero direct-to-master writes', async () => {
    // Setup: commit an initial file
    writeFileSync(join(project, 'initial.txt'), 'initial content\n');
    execFileSync('git', ['add', 'initial.txt'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: project });

    // Create scratch branch with one commit
    execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: project });
    writeFileSync(join(project, 'scratch.txt'), 'scratch content\n');
    execFileSync('git', ['add', 'scratch.txt'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'scratch commit'], { cwd: project });

    // Checkout back to master (clean tree)
    execFileSync('git', ['checkout', 'master'], { cwd: project });

    // Build a recording deps wrapper
    const calls: string[][] = [];
    const spyDeps: AdoptBranchAsEpicDeps = {
      runGit: async (root: string, args: string[]) => {
        calls.push(args);
        return runGit(root, args);
      },
    };

    // Snapshot before call
    const masterBefore = execFileSync('git', ['rev-parse', 'master'], { cwd: project }).toString('utf8').trim();
    const reflogBefore = execFileSync('git', ['reflog', 'show', 'master'], { cwd: project }).toString('utf8').trim();
    const reflogLinesBefore = reflogBefore.split('\n').filter((line) => line.trim().length > 0).length;

    // Adopt scratch
    const result = await adoptBranchAsEpic(project, 'test-session', {
      source: 'scratch',
      title: 'clean adoption',
    }, spyDeps);

    expect(result.epicId).toMatch(/^[a-f0-9\-]+$/);
    expect(result.epicBranch).toMatch(/^collab\/epic\//);

    // Assert: no calls to git that target master
    for (const args of calls) {
      const gitCmd = args[0];
      const hasTarget = (cmd: string) => args.includes(cmd);

      // No commit/merge/reset/push/checkout targeting master
      if (gitCmd === 'commit' || gitCmd === 'merge' || gitCmd === 'reset' || gitCmd === 'push') {
        expect(!args.includes('master')).toBe(true);
      }
      if (gitCmd === 'checkout') {
        expect(!args.includes('master')).toBe(true);
      }
    }

    // Assert: master SHA and reflog unchanged
    const masterAfter = execFileSync('git', ['rev-parse', 'master'], { cwd: project }).toString('utf8').trim();
    const reflogAfter = execFileSync('git', ['reflog', 'show', 'master'], { cwd: project }).toString('utf8').trim();
    const reflogLinesAfter = reflogAfter.split('\n').filter((line) => line.trim().length > 0).length;

    expect(masterAfter).toBe(masterBefore);
    expect(reflogLinesAfter).toBe(reflogLinesBefore);
  });
});
