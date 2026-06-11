import type { Todo } from './todo-store';
import { listTodos } from './todo-store';
import { listSupervisorAudit, type SupervisorAuditEntry } from './supervisor-store';
import { loadProjectManifest } from '../config/project-manifest';

/**
 * gate_status — per-project acceptance-gate visibility (read-only).
 *
 * Answers "why is this todo blocked / how is the gate configured?" without
 * spelunking the DB or the manifest. Two things the steward wants in one place:
 *
 *  1. The CONFIGURED gate command — the project's `.collab/project.json`
 *     `gateCommand` (the tsc/test invocation the Coordinator-side completion gate
 *     runs). When a project declares none, the gate falls back to the worker's
 *     own change-set-scoped `tsc --noEmit` + scoped tests (gate-runner), so we
 *     report `gateCommand: null` + `gateConfigured: false` and name that default.
 *
 *  2. Recent gate pass/fail PER TODO — derived from the durable supervisor audit
 *     trail. Every `completeTodo` records a `kind: 'complete'` entry whose detail
 *     is `{ todoId, acceptance, promoted, rolledUp }` (coordinator-live), so the
 *     last N of those ARE the recent gate results: `accepted` = pass, `rejected`
 *     = fail. Each result is enriched with the todo's current title +
 *     acceptanceStatus from the store.
 *
 * The core (`summarizeGate`) is a PURE function over already-fetched inputs so it
 * is trivially unit-testable; `gateStatus` is the thin DB/manifest-backed wrapper
 * the MCP tool calls.
 */

/** The default gate when a project declares no `gateCommand` in its manifest. */
export const DEFAULT_GATE_DESC =
  "worker change-set-scoped `tsc --noEmit` + scoped tests (no project gateCommand declared)";

export interface GateResult {
  /** The completed todo this gate result is for. */
  todoId: string;
  /** Current title from the store, or null if the todo no longer exists. */
  title: string | null;
  /** Pass = acceptance 'accepted'; fail = anything else (rejected/pending/null). */
  passed: boolean;
  /** The acceptance recorded at completion ('accepted' | 'rejected' | null). */
  acceptance: string | null;
  /** The todo's current acceptanceStatus in the store (may differ if re-run). */
  acceptanceStatus: string | null;
  /** Epoch-ms the completion was audited. */
  ts: number;
  /** Human-readable reason for the pass/fail verdict. */
  reason: string;
}

export interface GateStatus {
  project: string;
  /** The configured gate command from `.collab/project.json`, or null. */
  gateCommand: string | null;
  /** True when the project declares its own `gateCommand`. */
  gateConfigured: boolean;
  /** Describes the effective gate (the command, or the default fallback). */
  gateDescription: string;
  /** Most-recent-first gate pass/fail results per todo. */
  recent: GateResult[];
}

/** Parse a `kind: 'complete'` audit detail into { todoId, acceptance }. */
function parseCompleteDetail(detail: string | null): { todoId: string; acceptance: string | null } | null {
  if (!detail) return null;
  try {
    const obj = JSON.parse(detail) as { todoId?: unknown; acceptance?: unknown };
    if (typeof obj.todoId !== 'string' || !obj.todoId) return null;
    const acceptance = typeof obj.acceptance === 'string' ? obj.acceptance : null;
    return { todoId: obj.todoId, acceptance };
  } catch {
    return null;
  }
}

/** A pass/fail reason string from the recorded acceptance. */
function reasonFor(acceptance: string | null): string {
  if (acceptance === 'accepted') return 'gate passed (mechanical acceptance accepted)';
  if (acceptance === 'rejected') return 'gate failed (mechanical acceptance rejected)';
  return 'completed without an explicit accept/reject verdict';
}

/**
 * Pure gate summary — judges already-fetched inputs and returns the gate config +
 * recent per-todo results. No DB/manifest access, so unit tests feed hand-built
 * audit entries and todos.
 */
export function summarizeGate(
  project: string,
  gateCommand: string | null,
  completeAudit: SupervisorAuditEntry[],
  todos: Todo[],
): GateStatus {
  const byId = new Map<string, Todo>(todos.map((t) => [t.id, t]));
  const recent: GateResult[] = [];
  for (const entry of completeAudit) {
    const parsed = parseCompleteDetail(entry.detail);
    if (!parsed) continue;
    const todo = byId.get(parsed.todoId);
    recent.push({
      todoId: parsed.todoId,
      title: todo?.title ?? null,
      passed: parsed.acceptance === 'accepted',
      acceptance: parsed.acceptance,
      acceptanceStatus: todo?.acceptanceStatus ?? null,
      ts: entry.ts,
      reason: reasonFor(parsed.acceptance),
    });
  }
  const trimmed = gateCommand?.trim() || null;
  return {
    project,
    gateCommand: trimmed,
    gateConfigured: Boolean(trimmed),
    gateDescription: trimmed ?? DEFAULT_GATE_DESC,
    recent,
  };
}

/**
 * DB/manifest-backed wrapper the MCP tool calls. Reads the project's manifest
 * `gateCommand`, the last `limit` `kind:'complete'` audit entries, and the
 * current todos (to enrich titles/acceptanceStatus), then delegates to the pure
 * {@link summarizeGate}.
 */
export function gateStatus(project: string, limit = 20): GateStatus {
  const n = Math.min(Math.max(limit, 1), 200);
  const manifest = loadProjectManifest(project);
  const completeAudit = listSupervisorAudit({ project, kind: 'complete', limit: n });
  const todos = listTodos(project);
  return summarizeGate(project, manifest?.gateCommand ?? null, completeAudit, todos);
}
