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
  /** Declared project areas that must never share a commit (e.g. ["bsync-viewer/", "bsync-tools/"]).
   *  The executor emits one commit per area a leaf touched. */
  commitBoundaries?: string[];
  /** The project's mechanical acceptance gate command (e.g. a pytest invocation
   *  for a Python repo where `npx tsc` does not apply). Advisory metadata the
   *  Coordinator-side gate can consult. */
  gateCommand?: string;
  /** Acceptance gate command for FRONTEND/UI leaves (`type: frontend|ui`). Unlike
   *  `gateCommand` (whose whole-tree failures are change-set-narrowed, so a leaf
   *  that regresses OTHER files can still be accepted — the "narrow gate" bug),
   *  this command runs the FULL suite and its failures are judged against
   *  `frontendBaselineFailures` (the epic-branch baseline) rather than narrowed to
   *  the change-set. Net-new failures REJECT. Absent → FE leaves fall through to
   *  the generic `gateCommand` (today's behavior — no change for projects that
   *  don't declare it). Include `tsc --noEmit` in the command if you want it. */
  frontendGateCommand?: string;
  /** Known pre-existing test failures on the epic/main baseline (e.g. flaky or
   *  long-red tests like `ws_bridge.query`). Each entry is a substring matched
   *  against the FE suite's failing-test descriptors; a failure matching ANY entry
   *  is treated as a pre-existing baseline red, not a regression this leaf caused.
   *  Only failures matching NONE of these (net-new) reject the leaf. */
  frontendBaselineFailures?: string[];
  /** Acceptance-gate command for FRONTEND/UI leaves that runs ONLY the leaf's OWN
   *  change-set spec files (added/modified `*.test.*` / `*.spec.*`), so a leaf can
   *  never be accepted while a test IT added is red (the f5cab8d4 escape: tsc was
   *  clean but the leaf's new vitest spec failed and the gate never ran it). The
   *  `{files}` placeholder is replaced with the change-set's spec paths (relative
   *  to `changeSetTestCwd`), space-separated and shell-quoted. Run via `sh -c` in
   *  `<laneCwd|gateProject>/<changeSetTestCwd>`. A non-zero exit REJECTS. Absent →
   *  ui/frontend leaves fall through to the generic `gateCommand` (today's
   *  behavior). Distinct from `frontendGateCommand`: that runs the FULL suite vs a
   *  baseline; this runs only the touched specs (fast, no baseline to maintain). */
  changeSetTestCommand?: string;
  /** Subdirectory (relative to the gate repo / lane worktree) the
   *  `changeSetTestCommand` runs in, and the prefix stripped from change-set spec
   *  paths before `{files}` substitution (e.g. `ui` so vitest sees `src/...`
   *  paths it can resolve). Omitted → repo root, no prefix stripped. */
  changeSetTestCwd?: string;
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
  /** The MECHANICAL leaf gate (G2). Unlike `gateCommand` (the completion-gate plugin, which
   *  runs AFTER the review node already accepted and change-set-narrows its failures), these
   *  commands run in the EXECUTOR, at the leaf worktree HEAD, BEFORE the review node is spent.
   *  A non-zero exit is 'fail' and is final: no LLM output can overturn it. A command that
   *  cannot RUN is 'error' → park blocked + escalate, never 'fail'.
   *  Absent ⇒ no mechanical gate (the LLM verdict alone decides — pre-G2 behaviour). */
  gate?: {
    /** Static check, run at leaf HEAD and once at the epic base. e.g. `npx tsc --noEmit`. */
    typecheck?: string;
    /** LEGACY single-runner form. Mutually exclusive with `tests`. Run ONCE PER change-set
     *  spec file; `{file}` ← one shell-quoted path. e.g. `bun test {file}`. */
    test?: string;
    /** cwd for `test` (relative to the worktree root) + prefix stripped from spec paths. */
    testCwd?: string;
    /** Multi-lane form for a repo whose specs need DIFFERENT runners (e.g. `bun test` for src/,
     *  `bunx vitest --run` for ui/). Each change-set spec is routed to the FIRST lane whose
     *  `match` (a RegExp source, tested against the repo-root-relative path) accepts it. A spec
     *  matching NO lane is a config gap → 'error' (park + escalate), never a silent pass. */
    tests?: Array<{
      /** RegExp source, e.g. `^ui/`. Tested against the root-relative spec path. */
      match: string;
      /** `{file}` ⇒ run once per spec; `{files}` ⇒ run once with all lane specs.
       *  Exactly one of the two placeholders. */
      command: string;
      /** cwd for `command`, relative to the worktree root; also the prefix stripped
       *  from the spec paths before substitution. Omitted ⇒ worktree root. */
      cwd?: string;
    }>;
    /** Change-set-scoped project typecheck lanes: the FULL command runs once, in
     *  `cwd`, whenever ANY change-set path matches `match` — no {file}/{files}
     *  substitution (unlike `tests`). For a project sub-tree with its own
     *  tsconfig.json (e.g. ui/) that the whole-repo `typecheck` does not cover. */
    typechecks?: Array<{ match: string; command: string; cwd?: string }>;
    /** Full-suite command run ONLY at the epic base, once per epic. */
    baseTest?: string;
  };
}

const MANIFEST_REL = join('.collab', 'project.json');
const cache = new Map<string, ProjectManifest | null>();

/** Where the manifest was looked for, and what was found there. `'malformed'` means the
 *  file EXISTS but is not a JSON object — a config error, never a silent default. */
export interface ManifestSource {
  /** Absolute path consulted — `<project>/.collab/project.json`. Always set, even when absent. */
  path: string;
  state: 'absent' | 'ok' | 'malformed';
  manifest: ProjectManifest | null; // non-null iff state === 'ok'
}

const sourceCache = new Map<string, ManifestSource>();

/** Load + classify `<project>/.collab/project.json`, distinguishing an ABSENT manifest
 *  (no file, or no `gate`-relevant content) from a MALFORMED one (file exists but is not
 *  valid JSON / not an object) — the two read identically through {@link loadProjectManifest}
 *  but must never be conflated by a caller that needs to tell "no gate declared" apart from
 *  "gate declaration is broken". */
export function loadManifestSource(project: string): ManifestSource {
  const cached = sourceCache.get(project);
  if (cached !== undefined) return cached;
  const path = join(project, MANIFEST_REL);
  let src: ManifestSource;
  if (!existsSync(path)) {
    src = { path, state: 'absent', manifest: null };
  } else {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        src = { path, state: 'ok', manifest: parsed as ProjectManifest };
      } else {
        src = { path, state: 'malformed', manifest: null };
      }
    } catch {
      src = { path, state: 'malformed', manifest: null };
    }
  }
  sourceCache.set(project, src);
  return src;
}

/** Load + cache `<project>/.collab/project.json`. Returns null when the file is
 *  absent or unparseable — a bad manifest must never take down the defaults. */
export function loadProjectManifest(project: string): ProjectManifest | null {
  const cached = cache.get(project);
  if (cached !== undefined) return cached;
  const manifest = loadManifestSource(project).manifest;
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
  sourceCache.delete(project); // force a fresh loadManifestSource read on next call
  return packs;
}

/** Test seam: drop the cached manifest for a project (or all projects). */
export function _clearManifestCache(project?: string): void {
  if (project) {
    cache.delete(project);
    sourceCache.delete(project);
  } else {
    cache.clear();
    sourceCache.clear();
  }
}
