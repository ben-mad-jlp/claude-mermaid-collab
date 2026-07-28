// Invariant test: terminal missions' epics are properly reaped by runLandedEpicSweep
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo,
  getTodo,
  listTodos,
  _closeProject,
  type Todo,
} from '../todo-store';
import {
  upsertMission,
  setMissionAbandoned,
  setMissionClosed,
  listMissions,
  _resetMissionDbCache,
} from '../mission-store';
import { runLandedEpicSweep } from '../landed-epic-sweep';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { getWorktreeManager } from '../coordinator-live';
import { epicBranchName } from '../epic-branch-status.js';

// Mock claude-launch so coordinator-live can load without starting a real session
mock.module('../claude-launch', () => ({
  ensureSession: async () => ({ ready: true, tmux: 'tmux-mock' }),
  runTodoInSession: async () => ({ sent: true }),
}));

let project: string;
let repo: string;

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code: code ?? 0, stdout, stderr };
}

/** Create a mission node and upsert it into mission-store */
async function createMission(title = 'Test Mission') {
  const t = await createTodo(project, {
    allowOrphan: true,
    ownerSession: 's1',
    title,
    kind: 'mission',
  });
  upsertMission(project, t.id);
  return t;
}

beforeEach(async () => {
  project = mkdtempSync(join(tmpdir(), 'terminal-invariant-'));
  repo = project; // Same directory for project and repo
  process.env.MERMAID_SUPERVISOR_DIR = project;
  _closeSupervisorDb();

  // Initialize git repo
  await runGit(repo, ['init', '-q', '-b', 'master']);
  await runGit(repo, ['config', 'user.email', 't@t']);
  await runGit(repo, ['config', 'user.name', 'T']);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-q', '-m', 'base']);
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  try {
    rmSync(project, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('terminal-mission-epic-invariant', () => {
  test('terminal missions are reaped; open missions are preserved', async () => {
    // Setup: create three missions
    const closedMission = await createMission('Closed Mission');
    const abandonedMission = await createMission('Abandoned Mission');
    const controlMission = await createMission('Open Mission');

    // Mark two as terminal
    const now = Date.now();
    setMissionClosed(project, closedMission.id, now);
    setMissionAbandoned(project, abandonedMission.id, now);
    // Leave controlMission open (no closedAt/abandonedAt)

    // Create epic children for each mission
    const closedEpic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] closed',
      kind: 'epic',
      parentId: closedMission.id,
      status: 'todo',
    });

    const abandonedEpic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] abandoned',
      kind: 'epic',
      parentId: abandonedMission.id,
      status: 'todo',
    });

    const controlEpic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] control',
      kind: 'epic',
      parentId: controlMission.id,
      status: 'todo',
    });

    // Create worktrees for each epic with one extra commit (so aheadCount > 0)
    const wm = getWorktreeManager(project);
    mkdirSync(wm.baseDir(), { recursive: true });

    // Helper to create epic worktree with one extra commit
    const createEpicWorktree = async (epic: Todo) => {
      const id8 = epic.id.slice(0, 8);
      const branchName = epicBranchName(epic.id);
      const workTreeDir = join(wm.baseDir(), `__epic-${id8}__`);
      await runGit(repo, ['worktree', 'add', '-b', branchName, workTreeDir]);
      // Add one commit to keep it ahead of master
      writeFileSync(join(workTreeDir, 'epic-file.txt'), `content for ${id8}\n`);
      await runGit(workTreeDir, ['add', '-A']);
      await runGit(workTreeDir, ['commit', '-q', '-m', `work for ${id8}`]);
      return workTreeDir;
    };

    const closedEpicDir = await createEpicWorktree(closedEpic);
    const abandonedEpicDir = await createEpicWorktree(abandonedEpic);
    const controlEpicDir = await createEpicWorktree(controlEpic);

    // Exercise: run the sweep
    const result = await runLandedEpicSweep(project, { force: true });

    // Assert: reap result should show the two terminal epics were reaped
    expect(result.reap.reaped).toContain(closedEpic.id);
    expect(result.reap.reaped).toContain(abandonedEpic.id);
    expect(result.reap.reaped).not.toContain(controlEpic.id);

    // Enumerate terminal missions generically
    const missions = listMissions(project, { includeArchived: true });
    const terminalIds = missions
      .filter((m) => m.mission.closedAt != null || m.mission.abandonedAt != null)
      .map((m) => m.node.id);

    // Verify we found both terminal missions
    expect(terminalIds).toEqual(expect.arrayContaining([closedMission.id, abandonedMission.id]));
    expect(terminalIds).not.toContain(controlMission.id);

    // For each terminal mission, assert their epic child is reaped
    for (const terminalMissionId of terminalIds) {
      // Find this mission's epic child
      const allTodos = listTodos(project, { includeCompleted: true });
      const terminalEpic = allTodos.find((t) => t.parentId === terminalMissionId && t.kind === 'epic');
      expect(terminalEpic).toBeTruthy();

      if (terminalEpic) {
        const id8 = terminalEpic.id.slice(0, 8);

        // Assert worktree is gone
        const wtRes = await runGit(repo, ['worktree', 'list', '--porcelain']);
        expect(wtRes.stdout).not.toContain(`__epic-${id8}__`);

        // Assert branch is gone
        const brRes = await runGit(repo, ['branch', '--list', 'collab/epic/*']);
        expect(brRes.stdout).not.toContain(`collab/epic/${id8}`);

        // Assert epic status is no longer 'todo' or 'planned'
        const reaped = getTodo(project, terminalEpic.id);
        expect(!['todo', 'planned'].includes(reaped!.status)).toBe(true);
      }
    }

    // For the control mission, assert its epic is NOT reaped
    const controlId8 = controlEpic.id.slice(0, 8);
    const controlBranchName = epicBranchName(controlEpic.id);

    // Assert worktree still exists
    const wtRes = await runGit(repo, ['worktree', 'list', '--porcelain']);
    expect(wtRes.stdout).toContain(`__epic-${controlId8}__`);

    // Assert branch still exists
    const brRes = await runGit(repo, ['branch', '--list', 'collab/epic/*']);
    expect(brRes.stdout).toContain(`collab/epic/${controlId8}`);

    // Assert epic status is still 'todo'
    const controlEpicAfter = getTodo(project, controlEpic.id);
    expect(controlEpicAfter!.status).toBe('todo');
  });
});
