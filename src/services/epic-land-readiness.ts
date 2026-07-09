/**
 * Epic → land readiness (read-only presence check).
 *
 * For an [EPIC] and its full descendant set, proves that every descendant which is
 * `accepted`/`done` and is a CODE leaf (not a container, gate, land leaf, or epic)
 * has a commit carrying its `Collab-Todo: <id>` trailer reachable from the epic's
 * accumulation branch collab/epic/<id8>.
 *
 * Presence ≠ correctness: this proves work LANDED, says nothing about whether it
 * is CORRECT (that is G2's mechanical gate). Complements the acceptance gate.
 *
 * The git probe is injected (default: real `git` runner via Bun.spawnSync) so the
 * assembly logic — descendant walk with exemptions, missing-vs-stranded findings,
 * duplicate counts — is hermetically unit-testable without a repo.
 */
import type { Todo } from './todo-store';
import { listTodos } from './todo-store';
import { isEpicTodo, isLandTodo } from './invariant-check';
import { epicBranchName } from './epic-branch-status';

/** [GATE] / [GATE:<kind>] — a decision node that authors no code. */
export function isGateTodo(t: Todo): boolean {
  return /^\s*\[GATE[:\]]/i.test(t.title ?? '');
}

/** Per-leaf commit facts from the `Collab-Todo: <id>` trailer. */
export interface CommitProbeResult {
  /** shas carrying the trailer that are REACHABLE from the epic tip. */
  onEpicTip: string[];
  /** shas carrying the trailer anywhere in the repo (any ref). */
  anyRef: string[];
}
export type CommitProbe = (todoId: string) => CommitProbeResult;

export type ExemptReason = 'container' | 'gate' | 'land-leaf' | 'epic';
export type FindingKind = 'missing' | 'stranded';

export interface LandFinding {
  todoId: string;
  title: string;
  /** 'missing' = no commit on ANY ref (accepted nothing).
   *  'stranded' = a commit exists on some ref but is NOT reachable from the epic tip. */
  kind: FindingKind;
  /** Populated for 'stranded': where the work actually sits. */
  strayShas: string[];
  reason: string;
}
export interface LandExemption {
  todoId: string;
  title: string;
  reason: ExemptReason;
  childCount: number;
}
export interface DuplicateCommit {
  todoId: string;
  title: string;
  count: number;
  shas: string[];
}

export interface LandReadinessReport {
  project: string;
  epicId: string;
  epicBranch: string;
  checked: number; // accepted code leaves actually required to carry a commit
  findings: LandFinding[]; // BLOCKING
  exemptions: LandExemption[];
  /** Informational ONLY — never blocking (60e99489: duplicate dispatch is safe recovery). */
  duplicateCommits: DuplicateCommit[];
  blocking: boolean; // findings.length > 0
}

/** Hard cap on any single git probe. */
const GIT_PROBE_TIMEOUT_MS = 15_000;

/** Run git in `cwd`, returning { code, stdout }. Never throws; never hangs (timeout). */
function runGit(cwd: string, gitArgs: string[]): { code: number; stdout: string } {
  try {
    const p = Bun.spawnSync(['git', ...gitArgs], {
      cwd,
      stdout: 'pipe',
      stderr: 'ignore',
      timeout: GIT_PROBE_TIMEOUT_MS,
    });
    return { code: p.exitCode ?? 1, stdout: p.stdout?.toString() ?? '' };
  } catch {
    return { code: 1, stdout: '' };
  }
}

/**
 * Pure assembly: given the work-graph + a commit probe, build the land-readiness report.
 * No DB or git access of its own — both are injected, so unit tests feed a hand-built
 * Todo[] and a fake probe.
 */
export function buildLandReadiness(
  todos: Todo[],
  epicId: string,
  probe: CommitProbe,
  project: string = '',
): LandReadinessReport {
  const epicBranch = epicBranchName(epicId);

  // Children grouped by parentId, to find containers and descendants.
  const childrenOf = new Map<string, Todo[]>();
  for (const t of todos) {
    if (t.parentId) {
      const arr = childrenOf.get(t.parentId) ?? [];
      arr.push(t);
      childrenOf.set(t.parentId, arr);
    }
  }

  /** Transitive descendants of an epic, cycle-safe. */
  const descendantsOf = (epic: Todo): Todo[] => {
    const result: Todo[] = [];
    const stack = [...(childrenOf.get(epic.id) ?? [])];
    const seen = new Set<string>();
    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      result.push(node);
      stack.push(...(childrenOf.get(node.id) ?? []));
    }
    return result;
  };

  const findings: LandFinding[] = [];
  const exemptions: LandExemption[] = [];
  const duplicateCommits: DuplicateCommit[] = [];
  let checked = 0;

  const epic = todos.find((t) => t.id === epicId);
  if (!epic || !isEpicTodo(epic)) {
    return { project, epicId, epicBranch, checked: 0, findings, exemptions, duplicateCommits, blocking: false };
  }

  for (const desc of descendantsOf(epic)) {
    // Skip dropped descendants.
    if (desc.status === 'dropped') continue;

    // In scope iff accepted or done.
    const inScope = desc.acceptanceStatus === 'accepted' || desc.status === 'done';
    if (!inScope) continue;

    // Exempt, in order:
    // 1. Container — has non-dropped children
    const nonDroppedChildren = (childrenOf.get(desc.id) ?? []).filter((c) => c.status !== 'dropped');
    if (nonDroppedChildren.length >= 1) {
      exemptions.push({
        todoId: desc.id,
        title: desc.title ?? '',
        reason: 'container',
        childCount: nonDroppedChildren.length,
      });
      continue;
    }

    // 2. Gate — [GATE] decision node
    if (isGateTodo(desc)) {
      exemptions.push({
        todoId: desc.id,
        title: desc.title ?? '',
        reason: 'gate',
        childCount: 0,
      });
      continue;
    }

    // 3. Land leaf — [LAND] leaf
    if (isLandTodo(desc)) {
      exemptions.push({
        todoId: desc.id,
        title: desc.title ?? '',
        reason: 'land-leaf',
        childCount: 0,
      });
      continue;
    }

    // 4. Epic — nested epic
    if (isEpicTodo(desc)) {
      exemptions.push({
        todoId: desc.id,
        title: desc.title ?? '',
        reason: 'epic',
        childCount: nonDroppedChildren.length,
      });
      continue;
    }

    // Otherwise it is a code leaf.
    checked++;
    const p = probe(desc.id);

    if (p.onEpicTip.length > 0) {
      // Landed on the epic tip. Check for duplicates.
      if (p.onEpicTip.length > 2) {
        duplicateCommits.push({
          todoId: desc.id,
          title: desc.title ?? '',
          count: p.onEpicTip.length,
          shas: p.onEpicTip,
        });
      }
    } else if (p.anyRef.length > 0) {
      // Commit exists but not on the epic tip.
      findings.push({
        todoId: desc.id,
        title: desc.title ?? '',
        kind: 'stranded',
        strayShas: p.anyRef,
        reason: `stranded: ${p.anyRef.join(', ')}`,
      });
    } else {
      // No commit anywhere.
      findings.push({
        todoId: desc.id,
        title: desc.title ?? '',
        kind: 'missing',
        strayShas: [],
        reason: 'accepted with no commit on any ref',
      });
    }
  }

  // Deterministic ordering: sort findings by todoId.
  findings.sort((a, b) => a.todoId.localeCompare(b.todoId));

  return {
    project,
    epicId,
    epicBranch,
    checked,
    findings,
    exemptions,
    duplicateCommits,
    blocking: findings.length > 0,
  };
}

/**
 * A real commit probe rooted at `project` and `epicBranch`.
 * Searches the epic tip first (reachability), then all refs (stray detection).
 */
export function makeCommitProbe(project: string, epicBranch: string): CommitProbe {
  return (todoId: string): CommitProbeResult => {
    const grep = (ref: string[]) => {
      const res = runGit(project, [
        'log',
        '--format=%H',
        '--fixed-strings',
        `--grep=Collab-Todo: ${todoId}`,
        ...ref,
      ]);
      if (res.code !== 0) return [];
      return res.stdout
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);
    };

    // Reachable from the epic tip.
    const onEpicTip = grep([`refs/heads/${epicBranch}`]);
    // Anywhere in the repo (only when tip is empty, for stray detection).
    const anyRef = onEpicTip.length > 0 ? onEpicTip : grep(['--all']);

    return { onEpicTip, anyRef };
  };
}

/** DB-backed wrapper: load the project's work-graph and report land readiness. */
export function getEpicLandReadiness(project: string, epicId: string): LandReadinessReport {
  const todos = listTodos(project, { includeCompleted: true });
  const epicBranch = epicBranchName(epicId);
  return buildLandReadiness(todos, epicId, makeCommitProbe(project, epicBranch), project);
}
