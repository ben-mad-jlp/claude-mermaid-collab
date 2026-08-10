/**
 * store-paths.ts — the ONLY place a database file path is computed.
 *
 * WHY THIS EXISTS (audit, 2026-08-10). Every store used to derive its own path inline —
 * `join(project, '.collab', 'todos.db')` in todo-store, `join(homedir(), '.mermaid-collab',
 * 'worker-ledger.db')` in worker-ledger, and so on — and every one of them opened it with
 * `mkdirSync(recursive) + new Database(path)`, which CREATES both the directory and the file.
 * Two consequences, both measured on a live machine:
 *
 *   1. 18 of 32 .db files were zero bytes. Any caller that computed a slightly wrong path
 *      minted an empty database there instead of failing.
 *   2. Five logical stores existed as files in BOTH scopes — `worker-ledger.db` was 0 bytes
 *      project-local and 882MB global, `todos.db` the reverse. Opening the wrong twin returns
 *      a valid, EMPTY database, so callers silently concluded "no data" rather than erroring.
 *      That false-absence class cost a full night of debugging.
 *
 * The fixes are structural, not defensive:
 *   - Every store is declared ONCE, with its scope. Asking for a project store globally (or a
 *     global store project-locally) is a programming error and throws. The twin-file class
 *     cannot recur.
 *   - Project roots are CANONICALISED (realpath, agent-session worktrees, linked git worktrees)
 *     rather than regex-trimmed, so one repo is one project no matter which path names it.
 *   - Opening does not create by default. A store springs into existence only where a caller
 *     explicitly says so (registration/migration), never as a side effect of a typo.
 */
import { existsSync, statSync, readFileSync, realpathSync, readdirSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export type StoreScope = 'project' | 'global';

/** Canonical registry: the complete set of databases and where each one legitimately lives. */
export const STORES = {
  // --- per-project: the work-graph and everything derived from this repo ---
  todos: { file: 'todos.db', scope: 'project' },
  mission: { file: 'mission.db', scope: 'project' },
  friction: { file: 'friction.db', scope: 'project' },
  findings: { file: 'findings.db', scope: 'project' },
  decisionRecords: { file: 'decision-records.db', scope: 'project' },
  epicLandRecord: { file: 'epic-land-record.db', scope: 'project' },
  sessionStatus: { file: 'session-status.db', scope: 'project' },
  systemObjects: { file: 'system-objects.db', scope: 'project' },
  replayCorpus: { file: 'replay-corpus.db', scope: 'project' },
  agentCheckpoints: { file: 'agent-checkpoints.db', scope: 'project' },
  agentReceipts: { file: 'agent-receipts.db', scope: 'project' },
  asyncJob: { file: 'async-job.db', scope: 'project' },
  // --- global: genuinely cross-project state ---
  supervisor: { file: 'supervisor.db', scope: 'global' },
  workerLedger: { file: 'worker-ledger.db', scope: 'global' },
  subscriptions: { file: 'subscriptions.db', scope: 'global' },
} as const satisfies Record<string, { file: string; scope: StoreScope }>;

export type StoreName = keyof typeof STORES;

/** Every filename the app legitimately owns, for the ghost-file sweeper. */
export function knownStoreFiles(scope: StoreScope): string[] {
  return Object.values(STORES).filter((s) => s.scope === scope).map((s) => s.file);
}

/** The global store directory. Env override exists for tests and for isolated runs. */
export function globalStoreDir(): string {
  return process.env.MERMAID_SUPERVISOR_DIR ?? join(homedir(), '.mermaid-collab');
}

/**
 * Resolve any path that names a project to THE canonical root for that project.
 *
 * Handles, in order: realpath (so `/tmp` and its `/private/tmp` twin, and any symlinked
 * checkout, agree); leaf/epic worktrees under `.collab/agent-sessions/`; and LINKED GIT
 * WORKTREES anywhere on disk, whose `.git` is a file containing `gitdir: <main>/.git/worktrees/<n>`.
 * The previous helper was a single regex covering only the second case, so a `git worktree add
 * /tmp/wt-fix` became its own "project" with its own empty databases.
 *
 * Pure fs — no subprocess. A sync spawn here would block the sidecar's event loop, which the
 * no-sync-spawn tripwire exists to prevent.
 */
export function canonicalProjectRoot(input: string): string {
  if (!input || typeof input !== 'string') {
    throw new Error('canonicalProjectRoot: project path is required');
  }
  let p = input.replace(/[/\\]+$/, '');

  // Relative paths resolve against cwd. This function is PURE PATH IDENTITY — it does not
  // police where a project string came from, because a store legitimately creates a project
  // that does not exist yet (bootstrap), so "must already exist" cannot live here.
  //
  // The related bug — an MCP `project` argument holding a project NAME ("claude-mermaid-collab")
  // rather than a path, silently resolving against cwd and opening an empty store, so
  // list_missions answered {count: 0} for a project full of work — is a defect of the API
  // BOUNDARY, not of canonicalisation. It belongs where a name can be looked up in the registry
  // and rejected when it matches neither a registered project nor a real path.
  if (!isAbsolute(p)) p = resolve(process.cwd(), p);
  try { p = realpathSync(p); } catch { /* not on disk yet — fall through with the literal path */ }

  const agentSession = p.match(/^(.*?)[/\\]\.collab[/\\]agent-sessions[/\\]/);
  if (agentSession) p = agentSession[1];

  p = mainRepoRootForWorktree(p);
  return p.replace(/[/\\]+$/, '');
}

/** If `p` is a linked git worktree, return its MAIN repository root; otherwise `p` unchanged. */
function mainRepoRootForWorktree(p: string): string {
  const dotGit = join(p, '.git');
  try {
    if (!existsSync(dotGit) || !statSync(dotGit).isFile()) return p;
    const m = readFileSync(dotGit, 'utf8').trim().match(/^gitdir:\s*(.+)$/m);
    if (!m) return p;
    const gitDir = resolve(p, m[1].trim());
    // <main>/.git/worktrees/<name>  ⇒  the main root is the parent of <main>/.git
    const wt = gitDir.match(/^(.*)[/\\]worktrees[/\\][^/\\]+$/);
    if (!wt) return p;
    return dirname(wt[1]);
  } catch {
    return p; // unreadable .git ⇒ treat as its own root rather than guessing
  }
}

/**
 * Best-effort canonicalisation for CLEANUP paths (cache eviction, teardown), which run against
 * projects that may not exist yet or any more and must never throw. Opening stays strict: a bad
 * path there silently opens the wrong data, which is the failure this module exists to stop.
 * Returns the raw (trimmed) string when the project cannot be resolved.
 */
export function canonicalProjectRootLoose(input: string): string {
  try {
    return canonicalProjectRoot(input);
  } catch {
    return (input ?? '').replace(/[/\\]+$/, '');
  }
}

/**
 * The canonical absolute path of one store. Scope is enforced: asking for a project store
 * without a project (or a global store with one) is a programming error, not a fallback.
 */
export function storePath(name: StoreName, projectRoot?: string): string {
  const spec = STORES[name];
  if (spec.scope === 'global') {
    if (projectRoot !== undefined) {
      throw new Error(
        `storePath: '${name}' is a GLOBAL store and takes no project (got ${projectRoot}). ` +
        `A project-local ${spec.file} is never the source of truth.`,
      );
    }
    return join(globalStoreDir(), spec.file);
  }
  if (!projectRoot) {
    throw new Error(`storePath: '${name}' is a PROJECT store and requires a project root`);
  }
  return join(canonicalProjectRoot(projectRoot), '.collab', spec.file);
}

/**
 * Path of a store that must already exist. Throws with the resolved path when it does not,
 * instead of letting the caller open (and thereby create) an empty database.
 */
export function existingStorePath(name: StoreName, projectRoot?: string): string {
  const p = storePath(name, projectRoot);
  if (!existsSync(p)) {
    throw new Error(
      `store '${name}' does not exist at ${p}. ` +
      `Refusing to create it implicitly — an empty database reads as "no data" and hides the ` +
      `real failure. Register/migrate the project first.`,
    );
  }
  return p;
}

/**
 * Move unowned database files out of a store directory into `<dir>/.trash/<stamp>/`.
 *
 * Quarantine, never unlink: if this misclassifies something, the data is still on disk and the
 * move is trivially reversible. Deletion stays a separate, explicit human act.
 *
 * A ghost is only moved when it is EMPTY (0 bytes). A non-empty unowned database is reported
 * instead — that is a store nobody declared but something is writing, which is a finding, not
 * litter, and quarantining it could hide live data.
 */
export function quarantineGhostStores(
  dir: string,
  scope: StoreScope,
  stamp: string,
): { moved: string[]; skippedNonEmpty: string[] } {
  const moved: string[] = [];
  const skippedNonEmpty: string[] = [];
  const ghosts = ghostStoreFiles(dir, scope);
  if (ghosts.length === 0) return { moved, skippedNonEmpty };

  const trash = join(dir, '.trash', stamp);
  for (const g of ghosts) {
    let size = -1;
    try { size = statSync(g).size; } catch { continue; }
    if (size > 0) { skippedNonEmpty.push(g); continue; }
    try {
      mkdirSync(trash, { recursive: true });
      renameSync(g, join(trash, g.split(/[/\\]/).pop()!));
      moved.push(g);
    } catch { /* best-effort: a file we cannot move is reported by the next sweep */ }
  }
  return { moved, skippedNonEmpty };
}

/**
 * Database files sitting in a store directory that the registry does not own — the ghosts.
 * Returned rather than deleted so a caller can report before removing.
 */
export function ghostStoreFiles(dir: string, scope: StoreScope): string[] {
  const owned = new Set(knownStoreFiles(scope));
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch { return []; }
  return entries.filter((f) => f.endsWith('.db') && !owned.has(f)).map((f) => join(dir, f));
}
