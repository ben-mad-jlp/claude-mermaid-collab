/**
 * Gate-plugin registry (design-system-object-primitive §7.1, §8 Phase 1).
 *
 * The authoritative acceptance gate used to be a single inlined subprocess in
 * coordinator-live.runGate: load the manifest gateCommand, exec it, parse a
 * trailing verdict. That hard-wired ONE strategy (run a shell command) and left
 * the PURE, TESTED `runCadGate` (cad-gate-runner.ts) orphaned — no way to plug a
 * code-level deterministic gate in front of the generic command runner.
 *
 * This module is the seam: a predicate-bound plugin registry. A `GatePlugin`
 * declares { id, tier, appliesTo(obj, type), run(ctx) }. For a given subject the
 * registry resolves the FIRST applicable plugin deterministically — by tier
 * (core → domain → project), ties broken by registration order — and runs it.
 *
 * CORE PURITY (core-purity.test.ts enforces this): this file is the domain-FREE
 * core. It knows about tiers, resolution, and the GENERIC manifest-command
 * adapter (which runs whatever command a project declares — no domain knowledge).
 * It must contain ZERO domain literals (no "cad", "step", "bsync", "dof", …).
 * Domain gates live in their own files (e.g. cad-gate-plugin.ts) and register
 * themselves via `registerGatePlugin` — collab core learns no domain specifics.
 *
 * Ships on today's code, ZERO durable schema: a plugin's appliesTo/run read only
 * what already exists (the todo, the manifest, on-disk artifacts a worker wrote).
 */
import type { Todo } from './todo-store';
import type { ProjectManifest } from '../config/project-manifest';
import type { GateVerdict } from './coordinator-daemon';

/** Resolution tiers, most-specific-LAST in number but resolved core-first. A
 *  core plugin (collab-shipped, domain-free) is considered before a domain plugin
 *  (e.g. CAD), which is considered before a project's catch-all command adapter. */
export type GateTier = 'core' | 'domain' | 'project';

const TIER_ORDER: Record<GateTier, number> = { core: 0, domain: 1, project: 2 };

/** Run a subprocess and capture its output. Injectable so plugins (and tests)
 *  don't hard-depend on Bun.spawn; coordinator-live passes its own implementation. */
export type GateExec = (
  cmd: string[],
  opts: { cwd?: string; capture?: boolean },
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** The subject a gate runs against. Everything a plugin needs is here — the
 *  tracking project, the (possibly cross-project) repo to actually gate, the
 *  todo + its type, the loaded manifest, and an exec for command-running plugins. */
export interface GateSubject {
  /** Tracking project that owns the todo/work-graph. */
  project: string;
  /** Repo whose change-set + manifest the gate judges. Differs from `project`
   *  for a cross-project todo (a todo tracked in one repo, implemented in another). */
  gateProject: string;
  todoId: string;
  todo: Todo | null;
  /** Loaded manifest for `gateProject` (null when absent/unparseable). */
  manifest: ProjectManifest | null;
  /** Subprocess runner for command-running plugins. */
  exec: GateExec;
  /** LANE-LOCAL change-set (todo b78fd3f6): when worker isolation is ON, this is
   *  the absolute path to THIS todo's own git worktree. Present → the gate derives
   *  the change-set from this lane's worktree (its diff vs `integrationBase` + its
   *  own uncommitted edits) instead of the shared tree's `git status`, so a sibling
   *  lane's in-flight error never false-rejects green work. Absent (isolation off,
   *  single shared tree) → fall back to whole-tree `git status` on `gateProject`. */
  laneCwd?: string;
  /** The integration base ref the lane branched from (e.g. `collab/integration`).
   *  Only meaningful with `laneCwd`; the committed half of the change-set is
   *  `git diff --name-only <integrationBase>..HEAD` in the lane worktree. */
  integrationBase?: string;
}

/** A pluggable gate strategy. `appliesTo` is a SYNC predicate (cheap checks only —
 *  type, manifest fields, file existence); `run` does the actual (async) work and
 *  returns the authoritative verdict, or null to abstain (honor the self-report). */
export interface GatePlugin {
  id: string;
  tier: GateTier;
  appliesTo(obj: GateSubject, type: string | null): boolean;
  run(ctx: GateSubject): Promise<GateVerdict | null>;
}

/** Registration order is preserved and used as the within-tier tiebreaker, so
 *  resolution is fully deterministic regardless of import timing. */
const registry: GatePlugin[] = [];

/** Register a gate plugin. Idempotent by id — re-importing a self-registering
 *  domain module never double-registers (so a module side-effect is safe). */
export function registerGatePlugin(plugin: GatePlugin): void {
  if (registry.some((p) => p.id === plugin.id)) return;
  registry.push(plugin);
}

/** Test/diagnostic helper: the registered plugins in registration order. */
export function listGatePlugins(): ReadonlyArray<GatePlugin> {
  return registry.slice();
}

/** Resolve the single plugin that should gate this subject: the first applicable
 *  plugin by (tier, registration-order). Returns null when none applies. */
export function resolveGatePlugin(obj: GateSubject, type: string | null): GatePlugin | null {
  let best: { plugin: GatePlugin; tier: number; order: number } | null = null;
  for (let i = 0; i < registry.length; i++) {
    const plugin = registry[i];
    let applies = false;
    try {
      applies = plugin.appliesTo(obj, type);
    } catch {
      applies = false; // a throwing predicate never wins resolution
    }
    if (!applies) continue;
    const tier = TIER_ORDER[plugin.tier];
    if (best === null || tier < best.tier || (tier === best.tier && i < best.order)) {
      best = { plugin, tier, order: i };
    }
  }
  return best?.plugin ?? null;
}

/** Run the resolved gate for a subject. No applicable plugin → null (the worker's
 *  self-report stands, preserving prior no-gate behavior). A plugin that throws
 *  fails CLOSED — an un-runnable gate blocks acceptance, never passes it. */
export async function runRegistryGate(obj: GateSubject): Promise<GateVerdict | null> {
  const type = obj.todo?.type ?? null;
  const plugin = resolveGatePlugin(obj, type);
  if (!plugin) return null;
  try {
    return await plugin.run(obj);
  } catch (e) {
    return {
      passed: false,
      reasons: [`gate plugin "${plugin.id}" could not run: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}

// ─── Built-in PROJECT-tier adapter: the generic manifest command runner ──────────
//
// This is the domain-FREE fallback: if a project declares a `gateCommand`, run it
// in the gate repo and derive a verdict the worker cannot fake. It is the lowest
// resolution priority (project tier) so any core/domain plugin wins over it.

/** Scan the tail of gate output for a JSON object carrying a boolean `passed`.
 *  Lets a project's gate emit a structured {passed, reasons, metrics} verdict on
 *  its last line; anything else falls back to the exit code. */
export function parseTrailingVerdict(out: string): GateVerdict | null {
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj.passed === 'boolean') {
        return {
          passed: obj.passed,
          reasons: Array.isArray(obj.reasons) ? obj.reasons.map(String) : [],
          metrics: obj.metrics && typeof obj.metrics === 'object' ? obj.metrics : undefined,
        };
      }
    } catch { /* not JSON — keep scanning upward */ }
  }
  return null;
}

/** Last `n` non-empty lines of a string, joined — for compact failure reasons. */
export function lastLines(s: string, n: number): string {
  return s.split('\n').map((l) => l.trimEnd()).filter(Boolean).slice(-n).join('\n');
}

// ─── Change-set scoping (todo 63dcca2f) ──────────────────────────────────────
//
// The whole-tree completion gate (a project's opaque `gateCommand`, e.g.
// `npx tsc --noEmit` / project-wide pytest) runs over the SHARED/integration
// working tree, so ANY sibling lane's in-flight or committed error false-rejects
// an otherwise-green change-set — defeating the per-change-set worker contract
// (worker Step-3 gate is scoped; the completion gate was not). We can't rewrite
// an arbitrary command to gate only N files, but we CAN do exactly what the
// worker's Step-3 gate does: after the command fails, attribute each reported
// failure to a file and judge ONLY the change-set. A failure whose files are all
// OUTSIDE the change-set is foreign contamination → the change-set is green.

/** A file path is normalized for comparison by dropping a leading `./` and any
 *  surrounding quotes (git porcelain quotes paths with special chars). */
function normPath(p: string): string {
  return p.trim().replace(/^"(.*)"$/, '$1').replace(/^\.\//, '');
}

/** Parse `git status --porcelain` into the list of changed paths — the worker's
 *  own Step-3 definition of its change-set (modified/added/untracked/renamed).
 *  For a rename (`R  old -> new`) the NEW path is the change-set member. */
export function parseChangedFiles(porcelain: string): string[] {
  const out: string[] = [];
  for (const raw of porcelain.split('\n')) {
    if (!raw.trim()) continue;
    let p = raw.length > 3 ? raw.slice(3) : raw.trim(); // drop the `XY ` status prefix
    const arrow = p.indexOf(' -> ');
    if (arrow !== -1) p = p.slice(arrow + 4);
    out.push(normPath(p));
  }
  return out;
}

/** Extract the source files a gate's failure output points at. Matches the two
 *  diagnostic shapes the real gates emit: tsc/eslint `path(line,col)` or
 *  `path:line[:col]`, and pytest `FAILED path::test`. Restricted to known source
 *  extensions so version-like tokens (`node:18`) aren't misread as files. */
export function extractDiagnosticFiles(out: string): string[] {
  const EXT = '(?:tsx?|mts|cts|jsx?|mjs|cjs|py|json|svelte|vue)';
  const files = new Set<string>();
  const posRe = new RegExp(`([A-Za-z0-9_./@+-]+\\.${EXT})[(:]\\d+`, 'g');
  const failedRe = new RegExp(`FAILED\\s+([A-Za-z0-9_./@+-]+\\.${EXT})::`, 'g');
  let m: RegExpExecArray | null;
  while ((m = posRe.exec(out)) !== null) files.add(normPath(m[1]));
  while ((m = failedRe.exec(out)) !== null) files.add(normPath(m[1]));
  return [...files];
}

/** Whether a diagnostic file belongs to the change-set. Lenient on the
 *  cwd/repo-root prefix: an exact match, or either path being a path-suffix of
 *  the other (covers a gate run from a monorepo subdirectory). */
export function isInChangeSet(file: string, changeSet: readonly string[]): boolean {
  const f = normPath(file);
  return changeSet.some((c) => {
    const cc = normPath(c);
    return cc === f || cc.endsWith('/' + f) || f.endsWith('/' + cc);
  });
}

/**
 * Re-judge a FAILED whole-tree gate against the worker's change-set.
 *  - returns a PASS verdict when the failure references files but NONE are in the
 *    change-set (pure foreign contamination — the change-set is green);
 *  - returns a FAIL verdict (reasons filtered to the offending files) when at
 *    least one referenced file IS in the change-set (a real in-scope failure);
 *  - returns null when it cannot attribute (no change-set, or no parseable file
 *    paths) so the caller can FAIL CLOSED, preserving prior whole-tree behavior.
 */
export function scopeFailureToChangeSet(
  out: string,
  changeSet: readonly string[] | null,
): GateVerdict | null {
  if (!changeSet || changeSet.length === 0) return null;
  const files = extractDiagnosticFiles(out);
  if (files.length === 0) return null;
  const offending = files.filter((f) => isInChangeSet(f, changeSet));
  if (offending.length === 0) {
    return {
      passed: true,
      reasons: [],
      metrics: { scopedGate: true, foreignFailureFiles: files },
    };
  }
  const detail = out
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l && offending.some((f) => l.includes(f)))
    .slice(0, 20);
  return {
    passed: false,
    reasons: [
      `change-set gate failed (${offending.length} file(s)): ${offending.join(', ')}`,
      ...detail,
    ],
    metrics: { scopedGate: true, changeSetFailureFiles: offending },
  };
}

/** The change-set THIS todo touched, or null if it can't be read (caller then
 *  fails closed on a whole-tree failure).
 *
 *  LANE-LOCAL (todo b78fd3f6): under worker isolation each lane has its OWN git
 *  worktree, so `git status` in the SHARED/gate tree returns sibling lanes' files
 *  and the gate still scopes to the TREE, not the TODO — false-rejecting green
 *  work. When `laneCwd` is set we instead derive the change-set from the lane's
 *  own worktree: its committed diff vs the integration base UNION its uncommitted
 *  edits (which, in an isolated worktree, are this lane's alone). With isolation
 *  OFF (`laneCwd` absent), fall back to whole-tree `git status` on the gate repo —
 *  there is a single shared tree and one lane, so it IS the change-set. */
async function fetchChangeSet(ctx: GateSubject): Promise<string[] | null> {
  if (ctx.laneCwd) return fetchLaneChangeSet(ctx, ctx.laneCwd);
  try {
    const r = await ctx.exec(['git', '-C', ctx.gateProject, 'status', '--porcelain'], {
      cwd: ctx.gateProject,
      capture: true,
    });
    if (r.code !== 0) return null;
    return parseChangedFiles(r.stdout);
  } catch {
    return null;
  }
}

/** Lane-local change-set from an isolated worker worktree: committed work vs the
 *  integration base (`diff --name-only <base>..HEAD`) UNION uncommitted edits
 *  (`status --porcelain`). Returns the union, or null only when BOTH git reads
 *  fail (→ caller fails closed). An empty-but-readable result is a real empty
 *  change-set, not an error. */
async function fetchLaneChangeSet(ctx: GateSubject, cwd: string): Promise<string[] | null> {
  const set = new Set<string>();
  let read = false;
  const tryExec = async (args: string[]): Promise<{ code: number; stdout: string } | null> => {
    try { return await ctx.exec(args, { cwd, capture: true }); } catch { return null; }
  };
  if (ctx.integrationBase) {
    const d = await tryExec(['git', '-C', cwd, 'diff', '--name-only', `${ctx.integrationBase}..HEAD`]);
    if (d && d.code === 0) {
      read = true;
      for (const line of d.stdout.split('\n')) { const p = normPath(line); if (p) set.add(p); }
    }
  }
  const s = await tryExec(['git', '-C', cwd, 'status', '--porcelain']);
  if (s && s.code === 0) {
    read = true;
    for (const p of parseChangedFiles(s.stdout)) set.add(p);
  }
  return read ? [...set] : null;
}

export const manifestCommandGatePlugin: GatePlugin = {
  id: 'manifest-command',
  tier: 'project',
  appliesTo: (obj) => Boolean(obj.manifest?.gateCommand?.trim()),
  run: async (ctx): Promise<GateVerdict | null> => {
    const cmd = ctx.manifest?.gateCommand?.trim();
    if (!cmd) return null;
    try {
      // ASYNC (944408c2): the gate runs tsc + tests — seconds to minutes. Await it
      // so the single-threaded sidecar keeps serving while the gate child runs.
      const proc = await ctx.exec(['sh', '-c', cmd], { cwd: ctx.gateProject, capture: true });
      const out = proc.stdout + '\n' + proc.stderr;
      const structured = parseTrailingVerdict(out);
      if (structured) return structured;
      if (proc.code === 0) return { passed: true, reasons: [] };
      // FAILED whole-tree run: scope to the change-set (todo 63dcca2f) so a
      // sibling lane's foreign error doesn't false-reject green work. Attributable
      // foreign-only failure → pass; in-scope failure → keep reject; unattributable
      // → fall through and FAIL CLOSED with the full tail.
      const scoped = scopeFailureToChangeSet(out, await fetchChangeSet(ctx));
      if (scoped) return scoped;
      return { passed: false, reasons: [`gate command exited ${proc.code}: ${lastLines(out, 20)}`] };
    } catch (e) {
      // Fail CLOSED — an un-runnable gate blocks acceptance, never passes it.
      return { passed: false, reasons: [`gate could not run (${cmd}): ${e instanceof Error ? e.message : String(e)}`] };
    }
  },
};

registerGatePlugin(manifestCommandGatePlugin);
