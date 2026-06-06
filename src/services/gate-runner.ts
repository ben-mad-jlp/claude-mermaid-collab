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
      const passed = proc.code === 0;
      return { passed, reasons: passed ? [] : [`gate command exited ${proc.code}: ${lastLines(out, 20)}`] };
    } catch (e) {
      // Fail CLOSED — an un-runnable gate blocks acceptance, never passes it.
      return { passed: false, reasons: [`gate could not run (${cmd}): ${e instanceof Error ? e.message : String(e)}`] };
    }
  },
};

registerGatePlugin(manifestCommandGatePlugin);
