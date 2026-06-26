/**
 * E1 (epic e5acda93) — leaf subprocess registry + process-group kill.
 *
 * Each headless-leaf node is spawned `detached` (its own process group; on macOS/Linux
 * the child is the group leader so pgid == pid), so `process.kill(-pid, sig)` tears down
 * the WHOLE subtree — the `claude -p` / grok CLI AND the model subprocess it forks. We
 * track the live leader pid per leafId here so the daemon can stop a run on
 * level→off / leaf drop / leaf hold / server shutdown, instead of letting a zombie CLI
 * finish, merge, and accept a no-longer-owned todo.
 *
 * The kill is SAFE only because E2's ownership-CAS turns an aborted run's late
 * completion into a 0-row no-op (no merge, no accept) — see executor-lifecycle-design.
 * Best-effort throughout: a grandchild that re-`setpgid`s out of the group is an
 * accepted local-tool limitation (no cgroups). Every kill is wrapped — a dead/gone
 * group is not an error.
 *
 * Keyed per leaf (one live node at a time): node start registers (overwrites), node
 * finish unregisters. Between nodes there is no live subprocess and no entry.
 */

/** SIGTERM→SIGKILL grace, matching the node-invoker wall-clock kill + child-manager. */
const KILL_GRACE_MS = 3000;

interface TrackedProc {
  /** Process-group leader pid (== pgid, since the node is spawned detached). */
  pid: number;
  /** Tracking project — lets a per-project brake kill only that project's leaves. */
  project: string;
}

const tracked = new Map<string, TrackedProc>();

/**
 * E4 — run-level liveness. The per-node `tracked` map above is gappy (empty between a
 * leaf's nodes), so it can't answer "is this leaf's RUN still going?". This set is added
 * when the daemon launches a leaf run and removed in its finally (covering normal return,
 * abort, AND throw). It is the liveness source for the same-epoch orphan-inflight sweep:
 * a current-epoch leaf_inflight row whose leafId is NOT in here belongs to a run that
 * already ended without clearing its row (an aborted/errored run) → safe to drop.
 */
const liveRuns = new Set<string>();

/** Mark a leaf run live (daemon fire-and-track launch). */
export function markRunLive(leafId: string): void { liveRuns.add(leafId); }
/** Mark a leaf run done (the launch's finally — normal/abort/throw). */
export function markRunDone(leafId: string): void { liveRuns.delete(leafId); }
/** Is this leaf's run live in THIS process? */
export function isRunLive(leafId: string): boolean { return liveRuns.has(leafId); }

/** Record the live node subprocess for a leaf. No-op without a leafId/pid. */
export function registerLeafProc(leafId: string | undefined, pid: number | undefined, project: string): void {
  if (!leafId || !pid) return;
  tracked.set(leafId, { pid, project });
}

/** Forget a leaf's subprocess on node finish. Only clears if `pid` still matches the
 *  registered one — a fast next-node spawn may already have overwritten it (so a late
 *  finally from the prior node must not delete the new node's entry). */
export function unregisterLeafProc(leafId: string | undefined, pid?: number): void {
  if (!leafId) return;
  const cur = tracked.get(leafId);
  if (!cur) return;
  if (pid != null && cur.pid !== pid) return;
  tracked.delete(leafId);
}

/** SIGTERM a detached child's process group, escalating to SIGKILL after a grace. */
export function groupKillPid(pid: number | undefined): void {
  if (!pid) return;
  try { process.kill(-pid, 'SIGTERM'); } catch { /* group already gone */ }
  const t = setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }, KILL_GRACE_MS);
  // Don't keep the event loop alive just for the escalation timer.
  (t as { unref?: () => void }).unref?.();
}

/** Kill a single leaf's subprocess group and forget it. Returns true if one was tracked. */
export function killLeafSubtree(leafId: string): boolean {
  const cur = tracked.get(leafId);
  if (!cur) return false;
  tracked.delete(leafId);
  groupKillPid(cur.pid);
  return true;
}

/** Kill every tracked leaf in a project (the level→off / per-project brake path).
 *  Returns the leafIds killed. */
export function killLeafProcsForProject(project: string): string[] {
  const killed: string[] = [];
  for (const [leafId, t] of [...tracked]) {
    if (t.project === project) { killLeafSubtree(leafId); killed.push(leafId); }
  }
  return killed;
}

/** Kill every tracked leaf (server shutdown). Returns the leafIds killed. */
export function killAllLeafSubtrees(): string[] {
  const ids = [...tracked.keys()];
  for (const id of ids) killLeafSubtree(id);
  return ids;
}

/** Snapshot of tracked leaves (for the per-tick drop/hold reconcile + tests). */
export function listTrackedLeaves(): Array<{ leafId: string; pid: number; project: string }> {
  return [...tracked].map(([leafId, t]) => ({ leafId, pid: t.pid, project: t.project }));
}

/** TEST-ONLY: clear the registry between cases. */
export function _resetLeafProcRegistry(): void {
  tracked.clear();
  liveRuns.clear();
}
