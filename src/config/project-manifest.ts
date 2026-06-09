/**
 * Per-project manifest: `<project>/.collab/project.json` (SEAM·collab, plan-point #1).
 *
 * The declarative adapter that lets a project ship its OWN agent profiles, gate
 * command, and metric vocabulary references AS DATA in its repo — collab learns
 * zero domain specifics (CAD, ML, whatever); it just injects whatever the project
 * declares. This generalizes the hard-coded `agent-profiles.ts` registry (web/TS
 * roles with identical allowedTools) into a per-project, override-the-defaults
 * format: e.g. build123d-ocp-mcp ships a `cad` profile (with .step/.parts path
 * rules, a CAD/viewer allowedTools surface, and a contextPrompt) that lives WITH
 * the build123d repo instead of being baked into collab.
 *
 * Schema (all fields optional; a missing field falls back to the global default):
 *   {
 *     "version": 1,
 *     "profiles": {
 *       "cad": {
 *         "allowedTools": "Bash Edit Write Read mcp__mermaid ...",
 *         "contextPrompt": "You are working in build123d-ocp-mcp ...",
 *         "model": "claude-opus-4-8",
 *         "runtimeMode": "edit",
 *         "pathRules": [{ "type": "cad", "test": "\\.(step|stp|parts)$|(^|/)parts/" }]
 *       }
 *     },
 *     "gateCommand": "python3.10 -m pytest bsync-tools/tests -q",
 *     "metricRefs": ["workspace_vol_cm3", "median_cond", "n_dims_moved"]
 *   }
 *
 * A malformed/absent manifest NEVER breaks the global defaults — it just yields
 * null and the hard-coded profiles stand.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RuntimeMode } from '../agent/contracts';
import type { Capability } from './agent-profiles';

/** One profile declared (or overridden) by a project manifest. Every field is
 *  optional; whatever is omitted falls back to the global profile of the same
 *  type when merged (see agent-profiles.resolveProfile). */
export interface ManifestProfile {
  /** Space-separated allowedTools string for the worker launch. */
  allowedTools?: string;
  /** Injected into the worker's CLI as an appended system prompt (no cold start:
   *  the worker already knows the project's domain/conventions on first turn). */
  contextPrompt?: string;
  /** Model override. */
  model?: string;
  /** Runtime permission mode. */
  runtimeMode?: RuntimeMode;
  /** Requested capability (edit/reviewer/headless), resolved independently of the
   *  routing `type`. Omitted → `edit`. `headless` only takes effect when `trusted`
   *  is also true (constraint 64f813bd — no headless bypass by default). */
  capability?: Capability;
  /** Opt-in trust flag that allows a `headless` capability request to resolve;
   *  without it a `headless` request is downgraded to `edit`. */
  trusted?: boolean;
  /** Project-scoped path→type inference rules. `test` is a RegExp source string
   *  (the manifest stays plain JSON); first match wins. Lets a project route its
   *  own file shapes (.step/.parts) to a profile collab has never heard of. */
  pathRules?: Array<{ type: string; test: string }>;
}

export interface ProjectManifest {
  version?: number;
  /** type → profile overrides/additions. */
  profiles?: Record<string, ManifestProfile>;
  /** Shared tech-pack ids this project uses (Profile L2). Each id references a
   *  framework/domain pack in the cross-project registry (src/config/tech-packs.ts)
   *  — the project declares WHICH packs apply; the pack bodies live in collab, not
   *  here. Unknown ids resolve to nothing (degrade gracefully). */
  packs?: string[];
  /** Which declared pack is the project's primary domain pack (usually one of
   *  `packs`). A primary not listed in `packs` is still honoured if it resolves. */
  primaryPack?: string;
  /** The project's mechanical acceptance gate command (e.g. a pytest invocation
   *  for a Python repo where `npx tsc` does not apply). Advisory metadata the
   *  Coordinator-side gate can consult. */
  gateCommand?: string;
  /** Which metric-vocabulary entries (from a project's fitness/analysis tools)
   *  the gate references — documents the seam between the gate and the metrics. */
  metricRefs?: string[];
  /** System-object plugin overlays (design-system-object-primitive §7.2): each
   *  entry NARROWS a globally-registered type's composition grammar for this
   *  project (subset its `allowedChildTypes`/`requiredArtifacts`). Consumed by
   *  plugin-registry.resolvePlugins; widening throws. Plain JSON — the shape
   *  mirrors plugin-registry's PluginTypeOverlay (kept structural to avoid a
   *  config→service import cycle). */
  plugins?: Array<{ id: string; allowedChildTypes?: string[]; requiredArtifacts?: string[] }>;
}

const MANIFEST_REL = join('.collab', 'project.json');
const cache = new Map<string, ProjectManifest | null>();

/** Load + cache `<project>/.collab/project.json`. Returns null when the file is
 *  absent or unparseable — a bad manifest must never take down the defaults. */
export function loadProjectManifest(project: string): ProjectManifest | null {
  const cached = cache.get(project);
  if (cached !== undefined) return cached;
  let manifest: ProjectManifest | null = null;
  try {
    const path = join(project, MANIFEST_REL);
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        manifest = parsed as ProjectManifest;
      }
    }
  } catch {
    manifest = null;
  }
  cache.set(project, manifest);
  return manifest;
}

/** The manifest's profile override for `type`, or null. */
export function manifestProfile(project: string, type?: string | null): ManifestProfile | null {
  if (!type) return null;
  const manifest = loadProjectManifest(project);
  return manifest?.profiles?.[type] ?? null;
}

/** Infer a profile type from touched files using the project's declared pathRules
 *  (first-match-wins, scanned across all profiles' rules). Returns the matched
 *  type string, or null when no manifest rule matches — callers fall back to the
 *  global inferProfileType. Bad regex sources are skipped, never thrown. */
export function inferTypeFromManifest(project: string, files?: string[] | null): string | null {
  if (!files || files.length === 0) return null;
  const manifest = loadProjectManifest(project);
  const profiles = manifest?.profiles;
  if (!profiles) return null;
  const rules: Array<{ type: string; re: RegExp }> = [];
  for (const profile of Object.values(profiles)) {
    for (const rule of profile.pathRules ?? []) {
      try {
        rules.push({ type: rule.type, re: new RegExp(rule.test) });
      } catch {
        /* skip an unparseable regex source rather than crash inference */
      }
    }
  }
  for (const f of files) {
    for (const rule of rules) {
      if (rule.re.test(f)) return rule.type;
    }
  }
  return null;
}

/**
 * Declare a tech-pack id in a project's manifest (the L4d ADOPT path — attach an
 * approved/adopted pack to THIS project so its resolver picks it up). Idempotent:
 * an id already present is a no-op. Preserves any other manifest fields, creates
 * `.collab/project.json` (with `version: 1`) when absent, and invalidates the
 * cache so a subsequent {@link loadProjectManifest} sees the write. Returns the
 * resulting packs[] list.
 */
export function addManifestPack(project: string, packId: string): string[] {
  const id = packId.trim();
  if (!id) throw new Error('addManifestPack: packId is required');
  const existing = loadProjectManifest(project);
  const manifest: ProjectManifest = existing ? { ...existing } : { version: 1 };
  const packs = [...(manifest.packs ?? [])];
  if (!packs.includes(id)) packs.push(id);
  manifest.packs = packs;
  const path = join(project, MANIFEST_REL);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf8');
  cache.set(project, manifest);
  return packs;
}

/** Test seam: drop the cached manifest for a project (or all projects). */
export function _clearManifestCache(project?: string): void {
  if (project) cache.delete(project);
  else cache.clear();
}
