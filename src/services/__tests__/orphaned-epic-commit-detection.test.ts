/**
 * A terminal epic's worktree can be reclaimed safely — the branch keeps every commit — but the
 * removal must not be SILENT when work never reached trunk.
 *
 * MEASURED 2026-08-11: six `done` epics held worktrees for weeks. Their raw `rev-list` distance
 * read 1-8 "unlanded commits" each, which looked like wholesale abandonment; `git cherry` showed
 * that most of it was forward-integration MERGE commits carrying no unique patch. One real orphan
 * hid in that noise: 9ab4b72f, a base-red repair, on a terminal epic, absent from master, with
 * nothing anywhere pointing at it. Counting the wrong thing hid the one case that mattered.
 *
 * These tests pin the distinction against real git, because the whole property is a property of
 * git's patch-id equivalence — a mocked runner would assert my belief about `git cherry`, not
 * its behaviour.
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set up supervisor dir BEFORE importing modules that depend on it
const supervisorDir = mkdtempSync(join(tmpdir(), 'orphan-report-test-'));
const oldSupervisorDir = process.env.MERMAID_SUPERVISOR_DIR;
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

// Now import modules that need the supervisor dir
import { reportOrphanedEpicCommits } from '../leaf-worktree-reaper';
import { listTodos, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';

let repo: string;

function git(args: string[], cwd = repo): string {
  const p = Bun.spawnSync(['git', ...args], {
    cwd,
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
  // THROW on a failed git. A helper that swallows stderr turns a broken fixture into a wrong
  // assertion: `cherry-pick -q` is not a real flag, and discarding the error made the setup
  // silently no-op while the test reported a false orphan count.
  if (p.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${p.exitCode}): ${new TextDecoder().decode(p.stderr)}`);
  }
  return new TextDecoder().decode(p.stdout);
}

function commit(file: string, body: string, msg: string) {
  writeFileSync(join(repo, file), body);
  git(['add', '-A']);
  git(['commit', '-q', '-m', msg]);
}

/** The production predicate: `+` lines from `git cherry`, merges excluded by git itself. */
function orphanShas(trunk: string, branch: string): string[] {
  return git(['cherry', trunk, branch])
    .split('\n').map((l) => l.trim())
    .filter((l) => l.startsWith('+ '))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
}

// Each case builds its OWN repo explicitly. These assertions are about one branch's
// relationship to trunk, and any shared repo carries the previous case's commits into the
// next one's counts — which is exactly the confusion this file exists to prevent.
const made: string[] = [];
function freshRepo() {
  repo = mkdtempSync(join(tmpdir(), 'orphan-detect-'));
  made.push(repo);
  git(['init', '-q', '-b', 'master']);
  commit('base.txt', 'base\n', 'base');
}
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('orphan detection counts PATCHES, not commits', () => {
  it('reports nothing when the epic only carries forward-integration merges', () => {
    freshRepo();
    git(['checkout', '-q', '-b', 'epic/merges-only']);
    git(['checkout', '-q', 'master']);
    commit('trunk1.txt', 'a\n', 'trunk moves');
    git(['checkout', '-q', 'epic/merges-only']);
    git(['merge', '--no-ff', '--no-edit', '-q', 'master']);
    git(['checkout', '-q', 'master']);
    commit('trunk2.txt', 'b\n', 'trunk moves again');
    git(['checkout', '-q', 'epic/merges-only']);
    git(['merge', '--no-ff', '--no-edit', '-q', 'master']);

    // Raw distance says "ahead", which is what made six epics look abandoned...
    const ahead = Number(git(['rev-list', '--count', 'master..epic/merges-only']).trim());
    expect(ahead).toBeGreaterThan(0);
    // ...but there is no unique WORK here, so nothing must be filed.
    expect(orphanShas('master', 'epic/merges-only')).toEqual([]);
  });

  it('reports a commit whose content never reached trunk', () => {
    freshRepo();
    git(['checkout', '-q', 'master']);
    git(['checkout', '-q', '-b', 'epic/real-orphan']);
    commit('orphan.txt', 'never landed\n', 'fix: the one that got away');
    const sha = git(['rev-parse', 'HEAD']).trim();

    const found = orphanShas('master', 'epic/real-orphan');
    expect(found).toHaveLength(1);
    expect(sha.startsWith(found[0])).toBe(true);
  });

  it('does NOT report a commit that landed on trunk under a different sha', () => {
    freshRepo();
    git(['checkout', '-q', 'master']);
    git(['checkout', '-q', '-b', 'epic/cherry-picked']);
    commit('picked.txt', 'same content\n', 'feat: content that also lands');
    const sha = git(['rev-parse', 'HEAD']).trim();
    git(['checkout', '-q', 'master']);
    git(['cherry-pick', sha]);

    // Different sha, identical patch — patch-id equivalence is exactly why we use `git cherry`
    // instead of comparing shas, which would file a false orphan on every cherry-pick.
    expect(orphanShas('master', 'epic/cherry-picked')).toEqual([]);
  });

  it('cannot see a RE-IMPLEMENTATION, so triage stays a human call', () => {
    freshRepo();
    git(['checkout', '-q', 'master']);
    git(['checkout', '-q', '-b', 'epic/reimplemented']);
    commit('feature.txt', 'version A\n', 'feat: approach A');
    git(['checkout', '-q', 'master']);
    commit('feature.txt', 'version B, same idea\n', 'feat: approach B');

    // Same intent, different bytes ⇒ different patch-id ⇒ still reported. This is a KNOWN
    // false positive and the filed todo says so, rather than the GC pretending to judge intent.
    expect(orphanShas('master', 'epic/reimplemented')).toHaveLength(1);
  });
});

describe('orphan reporting — supersede-check recipe', () => {
  beforeAll(() => {
    _closeSupervisorDb();
  });

  afterEach(() => {
    _closeProject(repo);
    for (const d of made.splice(0)) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  afterAll(() => {
    _closeSupervisorDb();
    rmSync(supervisorDir, { recursive: true, force: true });
    if (oldSupervisorDir) {
      process.env.MERMAID_SUPERVISOR_DIR = oldSupervisorDir;
    } else {
      delete process.env.MERMAID_SUPERVISOR_DIR;
    }
  });

  it('filed description includes repo-wide supersede-check recipe with per-commit subjects', async () => {
    freshRepo();
    git(['checkout', '-q', 'master']);
    git(['checkout', '-q', '-b', 'epic/orphaned']);
    commit('orphan.txt', 'unique content\n', 'fix: the fix that got away');
    const orphanSha = git(['rev-parse', 'HEAD']).trim();

    // Call reportOrphanedEpicCommits directly
    const epicId = '12345678abcdefgh';
    const result = await reportOrphanedEpicCommits(
      repo,
      epicId,
      'Test Epic',
      'epic/orphaned',
      [orphanSha],
      repo,
    );
    expect(result).toBe(true);

    // Fetch the filed todo and verify its description
    const todos = listTodos(repo, { includeCompleted: true, includeArchived: true });
    const filed = todos.find((t) => t.title?.includes('Orphaned commits'));
    expect(filed).toBeDefined();
    const desc = filed?.description ?? '';

    // 1. Must contain a repo-wide grep instruction (not path-scoped to the old commit's files)
    expect(desc).toMatch(/repo-wide/i);
    expect(desc).toMatch(/git\s+(log|grep)/);

    // 2. Must contain explicit do-NOT-path-scope clause
    expect(desc).toMatch(/must\s+NOT\s+be\s+scoped/i);
    expect(desc).toMatch(/re-implement/i);

    // 3. Per-sha line must include the commit's exact subject
    expect(desc).toContain(orphanSha.slice(0, 8));
    expect(desc).toContain('fix: the fix that got away');

    // 4. Files line should list the touched file
    expect(desc).toContain('orphan.txt');
  });
});
