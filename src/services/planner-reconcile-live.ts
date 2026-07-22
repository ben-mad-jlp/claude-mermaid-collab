import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ReconcileDeps, ReconcileInputs, PlanNode } from './planner-reconcile';

/**
 * Live wiring for the reconciliation harness (the injected `llmMerge`). The
 * semantic merge runs as a SPAWNED session, exactly like a worker:
 *
 *   llmMerge → write inputs to .collab/reconcile/<id>.json → spawn a session
 *   bound to the `reconcile` skill with the id → session reads the file, does
 *   the merge, calls submit_reconcile_result(id, …) → that resolves the pending
 *   promise here → llmMerge returns the merged graph.
 *
 * The spawn has no live default (tmux-backed launch was removed) — a caller
 * MUST inject `opts.launch`. The file-write + pending-promise read-model below
 * stays so `submit_reconcile_result` can still resolve an in-flight merge
 * however the session was actually started.
 */

export interface ReconcileOutput {
  mergedGraph: PlanNode[];
  newConstraints?: Array<{ title: string; rationale?: string }>;
}

type Pending = { resolve: (r: ReconcileOutput) => void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, Pending>();

/** Called by the submit_reconcile_result MCP tool when a session reports its merge.
 *  Returns false if there's no in-flight request for that id (timed out / unknown). */
export function resolveReconcile(id: string, result: ReconcileOutput): boolean {
  const p = pending.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(result);
  return true;
}

export function isReconcilePending(id: string): boolean { return pending.has(id); }

const DEFAULT_TOOLS = 'Bash Edit Write Read mcp__plugin_mermaid-collab_mermaid';

export interface MakeReconcileDepsOpts {
  /** The spawn mechanism (no live default — tmux-backed launch was removed).
   *  Tests inject a fake that drives resolveReconcile; a real caller must
   *  supply its own headless spawn. */
  launch: (args: { project: string; session: string; allowedTools: string; invokeSkill: string }) => Promise<{ started: boolean; reason?: string }>;
  /** Max wait for the session to report back (default 10 min). */
  timeoutMs?: number;
}

/** Build live ReconcileDeps for a project: llmMerge spawns a reconcile session. */
export function makeReconcileDeps(project: string, opts: MakeReconcileDepsOpts): ReconcileDeps {
  const launch = opts.launch;
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  return {
    llmMerge: async (inputs: ReconcileInputs): Promise<ReconcileOutput> => {
      const id = crypto.randomUUID();
      const session = `reconcile-${id.slice(0, 8)}`;
      // Hand the inputs to the session via a file it reads (no size limit, no
      // MCP round-trip to fetch them).
      const dir = join(project, '.collab', 'reconcile');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${id}.json`), JSON.stringify(inputs, null, 2));

      const result = new Promise<ReconcileOutput>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`reconcile timeout after ${timeoutMs}ms (id ${id})`));
        }, timeoutMs);
        (timer as { unref?: () => void }).unref?.();
        pending.set(id, { resolve, timer });
      });

      const r = await launch({ project, session, allowedTools: DEFAULT_TOOLS, invokeSkill: `/mermaid-collab:reconcile ${id}` });
      if (!r.started) {
        const p = pending.get(id);
        if (p) { clearTimeout(p.timer); pending.delete(id); }
        throw new Error(`reconcile session failed to start: ${r.reason ?? 'unknown'}`);
      }
      return result;
    },
  };
}

/** Path a reconcile session reads its inputs from (exposed for the skill/docs). */
export function reconcileInputPath(project: string, id: string): string {
  return join(project, '.collab', 'reconcile', `${id}.json`);
}

/** Whether the inputs file for a reconcile id exists (used by the submit tool to validate). */
export function reconcileInputExists(project: string, id: string): boolean {
  return existsSync(reconcileInputPath(project, id));
}
