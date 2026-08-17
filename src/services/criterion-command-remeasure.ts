/**
 * Grading-time re-measurement of a criterion's named command(s). A criterion whose text
 * carries a backtick-delimited, allowlisted command (`bun test …`, `bun run …`, `npm run …`,
 * `tsc`) is re-run at grading time — a stale claim of "met" backed by a command that no
 * longer passes must not be gradeable.
 *
 * No spawnSync/execSync — uses async execFile via node:child_process.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { trackingProjectRoot } from './project-registry.js';
import { listTodos } from './todo-store.js';
import { getEpicLandRecord } from './epic-land-record-store.js';
import { isEpicTodo } from './invariant-check.js';
import { todoServesCriterion } from './criterion-edges.js';
import { missionIdOfCriterion, listCriteria } from './mission-store.js';

const execFileAsync = promisify(execFile);

/** Extract every backtick-delimited span from criterion prose, keeping only spans that
 *  (a) match an allowlisted head, anchored at the start, and (b) contain no shell
 *  metacharacter. Deny-by-default: anything not matching is dropped. De-duped, first-seen order. */
export function parseNamedCommands(text: string): string[] {
  const ALLOWLIST_HEAD = /^(?:bun (?:test|run)|npm run|tsc)(?:\s|$)/;
  const METACHAR = /[;|&$`><]/;
  const spans = text.match(/`([^`\n]+)`/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of spans) {
    const cmd = raw.slice(1, -1).trim();
    if (!cmd) continue;
    if (!ALLOWLIST_HEAD.test(cmd)) continue;
    if (METACHAR.test(cmd)) continue;
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    out.push(cmd);
  }
  return out;
}

/** First-8 slug of an epic id — mirrors WorktreeManager's private `epicId8` helper. */
function epicId8(epicId: string): string {
  const cleaned = epicId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (cleaned.length > 0 ? cleaned : 'epic').slice(0, 8);
}

type RunResult = { code: number; stdout: string; stderr: string };
type Runner = (cmd: string[], cwd: string) => Promise<RunResult>;

let remeasureRunnerOverride: Runner | null = null;

/** Test hook: install/clear a module-level runner override consulted when `deps?.run` is
 *  absent. Required because the wired `set_mission_criterion` call site passes no deps. */
export function _setRemeasureRunner(fn: Runner | null): void {
  remeasureRunnerOverride = fn;
}

async function defaultRunner(cmd: string[], cwd: string): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd[0], cmd.slice(1), { cwd, timeout: 5 * 60 * 1000 });
    return { code: 0, stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (e: any) {
    return { code: typeof e?.code === 'number' ? e.code : 1, stdout: e?.stdout?.toString() ?? '', stderr: e?.stderr?.toString() ?? String(e?.message ?? e) };
  }
}

/** Guard for the grading path: re-runs every allowlisted named command in a criterion's text
 *  and throws `criterion cannot grade met: …` if any fails or cannot be re-measured. A
 *  criterion with no parseable command, or that cannot be resolved, is fail-open (returns). */
export async function assertNamedCommandGreen(
  project: string,
  criterionId: string,
  deps?: { run?: Runner },
): Promise<void> {
  try {
    const missionId = missionIdOfCriterion(project, criterionId);
    if (!missionId) return;
    const crit = listCriteria(project, missionId).find((c) => c.id === criterionId);
    if (!crit) return;

    const commands = parseNamedCommands(crit.text);
    if (commands.length === 0) return;

    // Resolve the measurement root.
    const todos = listTodos(project);
    const servingEpics = todos.filter(
      (t) => isEpicTodo(t) && t.status !== 'dropped' && todoServesCriterion(t, criterionId),
    );

    let root: string | null = null;
    let unlandedEpicId8: string | null = null;
    for (const epic of servingEpics) {
      let landedSha: string | undefined;
      try {
        landedSha = getEpicLandRecord(project, epic.id)?.landedMergeSha ?? undefined;
      } catch {
        landedSha = undefined;
      }
      if (!landedSha) {
        unlandedEpicId8 = epicId8(epic.id);
        break;
      }
    }

    if (unlandedEpicId8) {
      const worktreePath = join(project, '.collab', 'agent-sessions', 'worktrees', `__epic-${unlandedEpicId8}__`);
      if (existsSync(worktreePath)) {
        root = worktreePath;
      } else {
        throw new Error(
          `criterion cannot grade met: cannot re-measure \`${commands[0]}\` — serving epic ${unlandedEpicId8} is unlanded and its shared artifact is unavailable`,
        );
      }
    } else {
      root = trackingProjectRoot(project);
    }

    const run = deps?.run ?? remeasureRunnerOverride ?? defaultRunner;
    for (const cmd of commands) {
      const argv = cmd.split(/\s+/).filter(Boolean);
      const result = await run(argv, root);
      if (result.code !== 0) {
        throw new Error(`criterion cannot grade met: \`${cmd}\` exited ${result.code} at ${root}`);
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('criterion cannot grade met')) {
      throw e;
    }
    // Any other error is indeterminate — fail open.
    return;
  }
}
