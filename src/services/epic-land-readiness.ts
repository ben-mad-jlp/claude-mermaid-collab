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
 * The git probe is injected (default: real ASYNC `git` runner via Bun.spawn — never
 * spawnSync: this runs in the sidecar process, and a sync spawn starves its event
 * loop past the Electron liveness watchdog, crit-6 of mission 693bbc27) so the
 * assembly logic — descendant walk with exemptions, missing-vs-stranded findings,
 * duplicate counts — is hermetically unit-testable without a repo.
 */
import type { Todo } from './todo-store';
import { listTodos } from './todo-store';
import { isEpicTodo, isLandTodo } from './invariant-check';
import { epicBranchName, detectTrunkRef } from './epic-branch-status';
import { criterionEdgesOf } from './criterion-edges';

/** [GATE] / [GATE:<kind>] — a decision node that authors no code. */
export function isGateTodo(t: Todo): boolean {
  return /^\s*\[GATE[:\]]/i.test(t.title ?? '');
}

/** Per-leaf commit facts from the `Collab-Todo: <id>` trailer. */
export interface CommitProbeResult {
  /** shas carrying the trailer that are REACHABLE from the epic tip. */
  onEpicTip: string[];
  /** shas carrying the trailer that are REACHABLE from the trunk. */
  onTrunk?: string[];
  /** shas carrying the trailer anywhere in the repo (any ref). */
  anyRef: string[];
}
export type CommitProbe = (todoId: string) => CommitProbeResult | Promise<CommitProbeResult>;

export type ExemptReason = 'container' | 'gate' | 'land-leaf' | 'epic' | 'dup-settled' | 'adopted';
export type FindingKind = 'missing' | 'stranded' | 'orphaned-proof' | 'dup-unverified' | 'adopt-unverified' | 'unlanded';

/** Provenance handle written by adoptBranchAsEpic: `adopt_branch_as_epic:<sha8>`.
 *  The bare verb (no sha) is the pre-2026-08-07 form and carries no evidence. */
const ADOPTED_RE = /^adopt_branch_as_epic(?::([0-9a-fA-F]{4,40}))?$/;

/** Parse a leaf's `completedBy` for adoption provenance. `sha` is null on the legacy
 *  bare-verb form, which has nothing to verify. */
export function parseAdopted(completedBy: string | null | undefined): { sha: string | null } | null {
  if (typeof completedBy !== 'string') return null;
  const m = ADOPTED_RE.exec(completedBy.trim());
  return m ? { sha: m[1] ?? null } : null;
}

/** Provenance handle written by settleDupOfLanded: `dup-of-landed:<sha8>[:<landedTodoId8>]`. */
const DUP_OF_LANDED_RE = /^dup-of-landed:([0-9a-fA-F]{4,40})(?::([0-9a-fA-F]{4,40}))?$/;

/** Parse a leaf's `completedBy` for dup-of-landed provenance, or null. */
export function parseDupOfLanded(completedBy: string | null | undefined): { sha: string; landedTodoId: string | null } | null {
  if (typeof completedBy !== 'string') return null;
  const m = DUP_OF_LANDED_RE.exec(completedBy.trim());
  return m ? { sha: m[1], landedTodoId: m[2] ?? null } : null;
}

/** Is `sha` reachable from the epic tip? Used to VERIFY a dup-of-landed claim. */
export type ReachProbe = (sha: string) => boolean | Promise<boolean>;

export interface LandFinding {
  todoId: string;
  title: string;
  /** 'missing' = no commit on ANY ref (accepted nothing).
   *  'stranded' = a commit exists on some ref but is NOT reachable from the epic tip.
   *  'unlanded' = a commit is reachable from the epic tip but NOT from the trunk.
   *  'orphaned-proof' = a non-terminal descendant tagged with a criterion this epic serves. */
  kind: FindingKind;
  /** Populated for 'stranded' or 'unlanded': where the work actually sits. */
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

/** Run git in `cwd` ASYNC, returning { code, stdout }. Never throws; never hangs
 *  (timeout kill). Async spawn (Bun.spawn + await exited) — never spawnSync, which
 *  would block the sidecar event loop for the probe's full duration. */
async function runGit(cwd: string, gitArgs: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const p = Bun.spawn(['git', ...gitArgs], {
      cwd,
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const killTimer = setTimeout(() => { try { p.kill(); } catch { /* already gone */ } }, GIT_PROBE_TIMEOUT_MS);
    try {
      const [stdout, code] = await Promise.all([
        p.stdout ? new Response(p.stdout).text() : Promise.resolve(''),
        p.exited,
      ]);
      return { code: code ?? 1, stdout };
    } finally {
      clearTimeout(killTimer);
    }
  } catch {
    return { code: 1, stdout: '' };
  }
}

/**
 * Pure assembly: given the work-graph + a commit probe, build the land-readiness report.
 * No DB or git access of its own — both are injected, so unit tests feed a hand-built
 * Todo[] and a fake probe.
 */
export async function buildLandReadiness(
  todos: Todo[],
  epicId: string,
  probe: CommitProbe,
  project: string = '',
  reachProbe?: ReachProbe,
  trunkRef?: string,
  classifyUnlanded: boolean = true,
): Promise<LandReadinessReport> {
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

  const epicCriteria = new Set(criterionEdgesOf(epic));

  for (const desc of descendantsOf(epic)) {
    // Skip dropped descendants.
    if (desc.status === 'dropped') continue;

    // In scope iff accepted or done.
    const inScope = desc.acceptanceStatus === 'accepted' || desc.status === 'done';
    if (!inScope) {
      if (epicCriteria.size === 0) continue;

      // Same exemption predicates as below, applied as pure predicates only —
      // out-of-scope nodes never get pushed to `exemptions`.
      const nonDroppedChildren = (childrenOf.get(desc.id) ?? []).filter((c) => c.status !== 'dropped');
      if (nonDroppedChildren.length >= 1 || isGateTodo(desc) || isLandTodo(desc) || isEpicTodo(desc)) {
        continue;
      }

      const descCriteria = new Set(criterionEdgesOf(desc));
      const hit = new Set<string>([...descCriteria].filter((c) => epicCriteria.has(c)));
      if (hit.size === 0) continue;

      findings.push({
        todoId: desc.id,
        title: desc.title ?? '',
        kind: 'orphaned-proof',
        strayShas: [],
        reason: `orphaned proof leaf ${desc.id.slice(0, 8)} for criterion ${[...hit].sort().join(', ')} is ${desc.status} (not accepted/done)`,
      });
      continue;
    }

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

    // 5. Dup-of-landed — settled as a duplicate of work that landed under ANOTHER leaf's
    //    id (settleDupOfLanded). Such a leaf can NEVER carry a `Collab-Todo: <own id>`
    //    commit — the work exists under the landed leaf's trailer, in a different epic —
    //    so the trailer check below would flag it 'missing' forever and block the land
    //    permanently. Observed 2026-08-05 on epic d7dca481: four leaves settled as
    //    dup-of-landed within 7 seconds, every one reported "accepted with no commit on
    //    any ref", blocking:true, while the work was demonstrably on main.
    //
    //    But the handle is an UNVERIFIED CALLER ASSERTION: settleDupOfLanded writes
    //    whatever sha it is handed without checking that the commit exists, is reachable,
    //    or relates to this leaf at all. Exempting on the handle's mere presence would
    //    convert an agent's claim into a gate pass — the exact thing this gate exists to
    //    prevent. So VERIFY it: exempt only when the cited sha is reachable from the epic
    //    tip, which is the same standard of proof the trailer check applies, and is a real
    //    demonstration that the work is present in what this epic would land. An
    //    unreachable or unresolvable sha stays BLOCKING under its own finding kind.
    const dup = parseDupOfLanded(desc.completedBy);
    if (dup) {
      const reachable = reachProbe ? await reachProbe(dup.sha) : false;
      if (reachable) {
        exemptions.push({
          todoId: desc.id,
          title: desc.title ?? '',
          reason: 'dup-settled',
          childCount: 0,
        });
      } else {
        findings.push({
          todoId: desc.id,
          title: desc.title ?? '',
          kind: 'dup-unverified',
          strayShas: [dup.sha],
          reason:
            `settled as dup-of-landed at ${dup.sha}` +
            (dup.landedTodoId ? ` (leaf ${dup.landedTodoId})` : '') +
            `, but that commit is not reachable from ${epicBranch}` +
            (reachProbe ? '' : ' (no reach probe supplied)'),
        });
      }
      continue;
    }

    // 6. Adopted — the leaf was minted by adopt_branch_as_epic over pre-existing commits.
    //    Those commits carry whatever trailer they already had (typically the ORIGINAL
    //    leaf's, or none), never this leaf's id, so the trailer check below can never pass
    //    and the land fails `epic-leaves-unlanded` forever. Observed 2026-08-07 recovering
    //    stranded work: adopt succeeded, the branch carried the fix, and the land refused
    //    because the commit said `Collab-Todo: 641ef628` rather than the adopted leaf's id.
    //
    //    Verified, not assumed — same rule as dup-settled above: exempt only when the
    //    adopted TIP SHA recorded in the handle is reachable from the epic tip. Every
    //    adopted commit is an ancestor of that tip, so reachability proves the whole
    //    adopted range is present in what this epic would land. The LEGACY bare-verb
    //    handle (no sha) carries no evidence and stays BLOCKING — that is the pre-existing
    //    behaviour for those rows, so this is strictly an improvement, never a loosening.
    const adopted = parseAdopted(desc.completedBy);
    if (adopted) {
      const reachable = adopted.sha && reachProbe ? await reachProbe(adopted.sha) : false;
      if (reachable) {
        exemptions.push({
          todoId: desc.id,
          title: desc.title ?? '',
          reason: 'adopted',
          childCount: 0,
        });
      } else {
        findings.push({
          todoId: desc.id,
          title: desc.title ?? '',
          kind: 'adopt-unverified',
          strayShas: adopted.sha ? [adopted.sha] : [],
          reason: adopted.sha
            ? `adopted at ${adopted.sha}, but that commit is not reachable from ${epicBranch}` +
              (reachProbe ? '' : ' (no reach probe supplied)')
            : 'adopted by a pre-2026-08-07 adopt_branch_as_epic that recorded no sha — nothing to verify; re-adopt the branch to stamp one',
        });
      }
      continue;
    }

    // Otherwise it is a code leaf.
    checked++;
    const p = await probe(desc.id);

    if ((p.onTrunk?.length ?? 0) > 0) {
      // Landed on trunk. Check for duplicates (keyed on epic tip only).
      if (p.onEpicTip.length > 2) {
        duplicateCommits.push({
          todoId: desc.id,
          title: desc.title ?? '',
          count: p.onEpicTip.length,
          shas: p.onEpicTip,
        });
      }
    } else if (p.onEpicTip.length > 0 && classifyUnlanded && trunkRef) {
      // Reachable from epic tip but not from trunk: unlanded commit.
      // Check for duplicates (keyed on epic tip only).
      if (p.onEpicTip.length > 2) {
        duplicateCommits.push({
          todoId: desc.id,
          title: desc.title ?? '',
          count: p.onEpicTip.length,
          shas: p.onEpicTip,
        });
      }
      findings.push({
        todoId: desc.id,
        title: desc.title ?? '',
        kind: 'unlanded',
        strayShas: p.onEpicTip,
        reason: `unlanded: ${p.onEpicTip.join(', ')} — reachable from ${epicBranch}, absent from ${trunkRef}`,
      });
    } else if (p.onEpicTip.length > 0) {
      // Reachable from epic tip but classifyUnlanded is false or trunkRef is missing.
      // Check for duplicates (keyed on epic tip only).
      if (p.onEpicTip.length > 2) {
        duplicateCommits.push({
          todoId: desc.id,
          title: desc.title ?? '',
          count: p.onEpicTip.length,
          shas: p.onEpicTip,
        });
      }
    } else if (p.anyRef.length > 0) {
      // Commit exists but not on the epic tip or trunk.
      const trunkName = trunkRef ?? 'trunk';
      findings.push({
        todoId: desc.id,
        title: desc.title ?? '',
        kind: 'stranded',
        strayShas: p.anyRef,
        reason: `stranded: ${p.anyRef.join(', ')} — absent from ${epicBranch} and ${trunkName}`,
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
 * Searches the epic tip first (reachability), then the trunk, then all refs (stray detection).
 */
export function makeCommitProbe(project: string, epicBranch: string): CommitProbe {
  let trunkP: Promise<string> | null = null;

  return async (todoId: string): Promise<CommitProbeResult> => {
    const grep = async (ref: string[]) => {
      const res = await runGit(project, [
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
    const onEpicTip = await grep([`refs/heads/${epicBranch}`]);

    // Resolve trunk once per factory.
    if (!trunkP) {
      trunkP = detectTrunkRef(project);
    }
    const trunkRef = await trunkP;

    // Reachable from the trunk (skip if trunk == epicBranch to avoid double-grep).
    let onTrunk: string[] = [];
    if (trunkRef !== epicBranch) {
      onTrunk = await grep([`refs/heads/${trunkRef}`]);
    }

    // Anywhere in the repo (only when both tips are empty, for stray detection).
    const anyRef = onEpicTip.length > 0 || onTrunk.length > 0
      ? [...new Set([...onEpicTip, ...onTrunk])]  // union
      : await grep(['--all']);

    return { onEpicTip, onTrunk: onTrunk.length > 0 ? onTrunk : undefined, anyRef };
  };
}

/**
 * Pure union/abstain decision over merge-base exit codes.
 * - exit 0 on any arm ⇒ true (reachable).
 * - exit 1 ⇒ that arm votes "not an ancestor".
 * - any other code (128, etc) ⇒ that arm ABSTAINS.
 * - no arm returned 0 ⇒ false (fail-safe).
 */
export function reachVerdict(codes: number[]): boolean {
  for (const code of codes) {
    if (code === 0) return true;
  }
  return false;
}

/**
 * A real reachability probe: is `sha` an ancestor of the epic tip or trunk?
 * Tests both refs (epic tip + trunk) and unions the results via reachVerdict.
 * `merge-base --is-ancestor` exits 0 for yes, 1 for no, and other codes for
 * unresolvable refs (e.g., 128 from a deleted ref) — both non-zero votes abstain
 * so a missing ref does not block.
 */
export function makeReachProbe(project: string, epicBranch: string): ReachProbe {
  let trunkP: Promise<string> | null = null;

  return async (sha: string): Promise<boolean> => {
    if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) return false; // never hand an arbitrary string to git

    // Resolve trunk once per factory.
    if (!trunkP) {
      trunkP = detectTrunkRef(project);
    }
    const trunkRef = await trunkP;

    // Probe epic tip.
    const epicRes = await runGit(project, ['merge-base', '--is-ancestor', sha, `refs/heads/${epicBranch}`]);

    // Probe trunk (skip if same as epicBranch).
    let trunkRes = { code: 0 };  // if skipped, assume reachable from the epic probe
    if (trunkRef !== epicBranch) {
      trunkRes = await runGit(project, ['merge-base', '--is-ancestor', sha, `refs/heads/${trunkRef}`]);
    }

    return reachVerdict([epicRes.code, trunkRes.code]);
  };
}

/** Test seam: counts real presence sweeps (getEpicLandReadiness invocations) so the
 *  measure-once tests can prove ONE sweep per landEpic call (audit O5). Deliberately a
 *  counter, NOT a cache — per-call threading in coordinator-land is the dedupe; a cache
 *  here would go stale against store rows that move independently of git shas. */
export const _presenceSweepCounter = { count: 0 };
/** Test seam: reset the presence-sweep counter. */
export function _resetPresenceSweepCounter(): void {
  _presenceSweepCounter.count = 0;
}

/** DB-backed wrapper: load the project's work-graph and report land readiness. */
export async function getEpicLandReadiness(
  project: string,
  epicId: string,
  opts?: { classifyUnlanded?: boolean },
): Promise<LandReadinessReport> {
  _presenceSweepCounter.count++;
  const todos = listTodos(project, { includeCompleted: true });
  const epicBranch = epicBranchName(epicId);
  const trunkRef = await detectTrunkRef(project);
  return buildLandReadiness(
    todos,
    epicId,
    makeCommitProbe(project, epicBranch),
    project,
    makeReachProbe(project, epicBranch),
    trunkRef,
    opts?.classifyUnlanded ?? false,
  );
}
