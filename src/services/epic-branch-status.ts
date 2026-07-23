/**
 * Epic → branch landing status (read-only git health report).
 *
 * For every epic (kind==='epic') in a project's work-graph, reports the state of its
 * `collab/epic/<id8>` accumulation branch versus master:
 *   - exists?        the branch is present at all
 *   - ahead          commits the branch carries that master does NOT (unlanded work)
 *   - behind         commits master carries that the branch does NOT (base drift)
 *   - mergeable      a trial merge into master produces no conflicts
 *   - landLeafDone   the epic's land leaf (kind==='land') → master is marked done
 *
 * The signal that matters: an epic that looks DONE on the graph but whose branch
 * is still ahead>0 with landLeafDone:false is the BP0 stranding — accepted,
 * gate-green work that never landed on master. This tool surfaces exactly that.
 *
 * Pure git reads only (rev-list / merge-tree / rev-parse) — never a merge, push,
 * or any mutation. Pairs with design-epic-landing / design-epic-git-integration.
 *
 * The git probe is injected (default: a real `git` runner via Bun.spawnSync) so
 * the assembly logic — branch-name derivation, ahead/behind/mergeable mapping,
 * land-leaf join — is hermetically unit-testable without a repo.
 */
import type { Todo } from './todo-store';
import { listTodos } from './todo-store';
import { isEpic, isLand } from './todo-kind';

/** Raw git facts for one epic branch — null fields mean "the probe couldn't tell". */
export interface BranchProbe {
  /** Does refs/heads/collab/epic/<id8> exist? */
  exists: boolean;
  /** Commits on the branch not on baseRef (unlanded work); null if not probeable. */
  ahead: number | null;
  /** Commits on baseRef not on the branch (base drift); null if not probeable. */
  behind: number | null;
  /** True/false from a trial merge; null when the branch is missing or the probe failed. */
  mergeable: boolean | null;
}

/** A git probe: given an epic branch + base ref, return the raw counts/flags. */
export type GitProbe = (branch: string, baseRef: string) => BranchProbe;

/**
 * One-shot branch enumerator: all existing local `collab/epic/*` short refs, or null
 * when enumeration itself failed (fall back to probing every epic). Injected so the
 * prefilter is hermetically testable; the real one is `listEpicBranchesIn`.
 */
export type BranchLister = () => string[] | null;

export interface EpicBranchStatus {
  epicId: string;
  title: string;
  status: string;
  branch: string;
  exists: boolean;
  ahead: number | null;
  behind: number | null;
  mergeable: boolean | null;
  /** Whether the epic's land leaf is done. null when the epic has no land leaf. */
  landLeafDone: boolean | null;
  /** Id of the epic's land leaf, if any — the reopen target for a corrupt epic. */
  landLeafId: string | null;
  /**
   * True when the branch carries unlanded commits (ahead>0) — the git fact of
   * "work not on master". Independent of the land-leaf stamp (a falsely-stamped
   * done land leaf does NOT clear this).
   */
  stranded: boolean;
  /**
   * True when the land leaf claims done (landLeafDone===true) YET the branch is
   * still ahead>0 — a FALSELY-STAMPED land leaf. Strictly git-derived; the
   * reconcile pass reopens the land leaf on this flag.
   */
  corrupt: boolean;
}

export interface EpicBranchStatusReport {
  project: string;
  baseRef: string;
  epics: EpicBranchStatus[];
  /** Count of epics flagged `stranded` — the one-glance "unlanded work" signal. */
  strandedCount: number;
  /** Count of epics flagged `corrupt` (land leaf done yet branch ahead>0). */
  corruptCount: number;
}

/** First-8 slug of an epic id — the branch token. Mirrors worktree-manager.epicId8
 *  (a UUID → its 8-char prefix; the sentinel 'inbox' → 'inbox'). */
export function epicId8(epicId: string): string {
  const cleaned = epicId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (cleaned.length > 0 ? cleaned : 'epic').slice(0, 8);
}

/** The accumulation branch for an epic: collab/epic/<id8>. */
export function epicBranchName(epicId: string): string {
  return `collab/epic/${epicId8(epicId)}`;
}

/**
 * Pure assembly: given the work-graph + a git probe, build the per-epic report.
 * No DB or git access of its own — both are injected, so unit tests feed a
 * hand-built Todo[] and a fake probe.
 */
export function buildEpicBranchStatus(
  todos: Todo[],
  probe: GitProbe,
  baseRef: string = 'master',
  project: string = '',
  listBranches?: BranchLister,
): EpicBranchStatusReport {
  // PREFILTER (crit-5, watchdog starvation 2026-07-22): with a real synchronous git
  // probe, probing EVERY epic todo (2-3 spawns each) scales with TODO COUNT (211 rows
  // → ~500+ blocking Bun.spawnSync calls, >45s event-loop hold → the Electron liveness
  // watchdog kills the sidecar). Enumerate existing collab/epic/* branches ONCE and
  // only probe epics whose branch actually exists — a branchless epic already reports
  // exists:false today; we just skip the pointless spawn. Enumeration failure (null)
  // falls back to probing everything (never a false all-clear from a broken git).
  let existing: Set<string> | null | undefined; // undefined = not yet enumerated
  const branchKnownMissing = (branch: string): boolean => {
    if (!listBranches) return false;
    if (existing === undefined) {
      const listed = listBranches(); // exactly one enumeration per report
      existing = listed == null ? null : new Set(listed);
    }
    return existing != null && !existing.has(branch);
  };
  // Children grouped by parentId, to find each epic's land leaf descendant.
  const childrenOf = new Map<string, Todo[]>();
  for (const t of todos) {
    if (t.parentId) {
      const arr = childrenOf.get(t.parentId) ?? [];
      arr.push(t);
      childrenOf.set(t.parentId, arr);
    }
  }

  /** The land leaf (kind==='land') among an epic's transitive descendants, if any. Cycle-safe. */
  const landLeafOf = (epic: Todo): Todo | null => {
    const stack = [...(childrenOf.get(epic.id) ?? [])];
    const seen = new Set<string>();
    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      if (isLand(node)) return node;
      stack.push(...(childrenOf.get(node.id) ?? []));
    }
    return null;
  };

  const epics: EpicBranchStatus[] = [];
  for (const t of todos) {
    if (!isEpic(t)) continue;
    const branch = epicBranchName(t.id);
    const p: BranchProbe = branchKnownMissing(branch)
      ? { exists: false, ahead: null, behind: null, mergeable: null }
      : probe(branch, baseRef);
    const land = landLeafOf(t);
    const landLeafDone = land ? land.status === 'done' : null;
    const stranded = p.exists && (p.ahead ?? 0) > 0;
    const corrupt = p.exists && (p.ahead ?? 0) > 0 && landLeafDone === true;
    epics.push({
      epicId: t.id,
      title: t.title,
      status: t.status,
      branch,
      exists: p.exists,
      ahead: p.ahead,
      behind: p.behind,
      mergeable: p.mergeable,
      landLeafDone,
      landLeafId: land ? land.id : null,
      stranded,
      corrupt,
    });
  }

  return { project, baseRef, epics, strandedCount: epics.filter((e) => e.stranded).length, corruptCount: epics.filter((e) => e.corrupt).length };
}

/** Hard cap on any single git probe. `git merge-tree` on a badly-conflicted /
 *  far-diverged branch (e.g. an epic branch 100s of commits stale) can run for a very
 *  long time; because this runner is SYNCHRONOUS (Bun.spawnSync), an unbounded git call
 *  blocks the whole event loop — which wedges the orchestrator tick for ALL projects.
 *  The timeout kills the git process and we report the probe as "couldn't tell" (null). */
const GIT_PROBE_TIMEOUT_MS = 15_000;

/** Run git in `cwd`, returning { code, stdout }. Never throws; never hangs (timeout). */
function runGit(cwd: string, gitArgs: string[]): { code: number; stdout: string } {
  try {
    const p = Bun.spawnSync(['git', ...gitArgs], {
      cwd,
      stdout: 'pipe',
      stderr: 'ignore',
      timeout: GIT_PROBE_TIMEOUT_MS, // kill a runaway git (e.g. merge-tree on a conflicted branch)
    });
    return { code: p.exitCode ?? 1, stdout: p.stdout?.toString() ?? '' };
  } catch {
    return { code: 1, stdout: '' };
  }
}

/**
 * Real branch enumerator for `project`: all local collab/epic/* short refs in ONE git
 * spawn (same for-each-ref recipe as landed-epic-sweep's BranchGcRunner.listEpicBranches).
 * Returns null when git itself failed, so callers fall back to per-epic probing rather
 * than reporting a false "no branches exist".
 */
export function listEpicBranchesIn(project: string): string[] | null {
  const r = runGit(project, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/collab/epic']);
  if (r.code !== 0) return null;
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** A real git probe rooted at `project`: exists / ahead / behind / mergeable. */
export function makeGitProbe(project: string): GitProbe {
  return (branch: string, baseRef: string): BranchProbe => {
    const exists =
      runGit(project, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).code === 0;
    if (!exists) return { exists: false, ahead: null, behind: null, mergeable: null };

    const count = (range: string): number | null => {
      const r = runGit(project, ['rev-list', '--count', range]);
      if (r.code !== 0) return null;
      const n = parseInt(r.stdout.trim() || '0', 10);
      return Number.isNaN(n) ? null : n;
    };
    const ahead = count(`${baseRef}..${branch}`);
    const behind = count(`${branch}..${baseRef}`);

    // Trial merge with no working-tree mutation: `git merge-tree --write-tree`
    // exits 0 on a clean merge, 1 when there are conflicts. A spawn/other failure
    // (e.g. baseRef missing, ancient git) leaves mergeable null rather than lying.
    let mergeable: boolean | null = null;
    const mt = runGit(project, ['merge-tree', '--write-tree', baseRef, branch]);
    if (mt.code === 0) mergeable = true;
    else if (mt.code === 1) mergeable = false;

    return { exists, ahead, behind, mergeable };
  };
}

/**
 * Pure base-ref picker: resolve the trunk to compare against. If the requested ref exists,
 * use it. Otherwise fall back to the repo's ACTUAL default branch — a `main`-default repo
 * (e.g. build123d) has no `master`, so a literal 'master' default made every probe null and
 * the report read strandedCount:0 against a nonexistent ref (a dangerous false all-clear).
 * Tries main/master, then origin/HEAD. Hermetic — git access is injected for unit tests.
 */
export function pickBaseRef(
  requested: string,
  refExists: (ref: string) => boolean,
  originHead: () => string | null,
): string {
  if (refExists(requested)) return requested;
  for (const cand of ['main', 'master']) {
    if (cand !== requested && refExists(cand)) return cand;
  }
  const head = originHead();
  if (head) return head;
  return requested; // give up — probes return null, exactly as before
}

/** DB-backed wrapper: load the project's work-graph and report each epic's branch status. */
export function getEpicBranchStatus(
  project: string,
  baseRef: string = 'master',
): EpicBranchStatusReport {
  const resolved = pickBaseRef(
    baseRef,
    (ref) => runGit(project, ['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`]).code === 0,
    () => {
      const r = runGit(project, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
      const short = r.code === 0 ? r.stdout.trim().replace(/^origin\//, '') : '';
      return short || null;
    },
  );
  const todos = listTodos(project, { includeCompleted: true });
  return buildEpicBranchStatus(todos, makeGitProbe(project), resolved, project, () =>
    listEpicBranchesIn(project),
  );
}
