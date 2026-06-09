/**
 * Tech-pack library (Profile L2, per e8fddf63).
 *
 * A SHARED, cross-project registry of domain/framework *context packs*. Where an
 * {@link AgentProfile} is per-project (a repo ships its own `cad` profile in
 * `.collab/project.json`), a tech-pack is the opposite: a reusable bundle of
 * framework knowledge that spans projects. A "ros2 expert" pack helps ANY ros2
 * repo; a "cad"/opencascade pack helps any build123d-style repo. So packs live
 * HERE, in collab (cross-project), and projects merely DECLARE which packs they
 * use (and a primary) by id in their manifest — they don't redefine the pack.
 *
 * Each pack is a small bundle of *fragments* that L3 composes onto a worker
 * launch (alongside the project's own contextPrompt and the resolved capability):
 *   - `contextPrompt` — a domain knowledge fragment appended to the system prompt
 *   - `allowedTools`   — extra tools the domain needs, ADDED to the base surface
 *   - `model`          — an optional model the domain prefers
 *
 * This module owns the registry + resolution (declared ids → resolved packs). It
 * deliberately does NOT do the composition itself — that is L3's job; L2 only has
 * to make the fragments *available for composition*.
 *
 * Distinct from project-context: the per-repo conventions ("here's how THIS repo
 * builds/tests") stay in the manifest's `profiles[].contextPrompt`. A tech-pack
 * is framework-level and shared; project-context is repo-level and local.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadProjectManifest } from './project-manifest';

/** One shared, cross-project framework/domain context pack. */
export interface TechPack {
  /** Stable id projects reference from their manifest (e.g. `cad`, `web-react`). */
  id: string;
  /** Short human description of what domain this pack covers. */
  description: string;
  /** Domain-knowledge fragment appended to a worker's system prompt. Composed
   *  with (not replacing) the project's own contextPrompt by L3. */
  contextPrompt: string;
  /** allowedTools fragment (space-separated) ADDED to the base tool surface — the
   *  extra tools/MCP servers this domain needs. May be empty when the domain adds
   *  no tools beyond the base. */
  allowedTools: string;
  /** Optional model this domain prefers (e.g. a stronger model for geometry). */
  model?: string;
}

/**
 * The shared registry. Seeded with the two domains we already have evidence for
 * (build123d → `cad`; the collab UI → `web-react`). New framework packs are added
 * here, once, and become available to every project that declares them.
 */
export const TECH_PACKS: Record<string, TechPack> = {
  cad: {
    id: 'cad',
    description: 'OpenCascade / build123d parametric CAD modeling (geometry, assemblies, joints).',
    contextPrompt:
      'You are working in a build123d / OpenCascade CAD codebase via the build123d-ocp-mcp ' +
      'and bsync-desktop MCP servers. Start with this domain model so you do NOT re-derive it ' +
      'cold:\n' +
      '\n' +
      '• SESSION / PARTS / INSTANCES / FACE_INDEX. A bsync SESSION holds named PARTS (each a ' +
      'solid body) and INSTANCES (placed copies of a part in an assembly, each with its own ' +
      'transform). Geometry verbs address faces/edges by a stable FACE_INDEX into the part\'s ' +
      'topology — capture the index from get_faces / get_topology and reuse it; never assume ' +
      'face ordering is stable across a re-build. When several workers share a session, pass ' +
      'session_id on EVERY call so lanes don\'t stomp each other.\n' +
      '• SCRIPT vs DISPATCHER VERBS. Prefer the dispatcher MCP verbs (create_primitive, ' +
      'make_hole, fuse, add_connection, add_motor, analyze_dof, check_clearance, ' +
      'validate_geometry, step_save/export_*, get_cut_list, auto_drawing, …) for modeling steps ' +
      '— they are gated, observable, and undo-able. Drop to run_script (raw build123d Python) ' +
      'ONLY for logic the dispatcher verbs can\'t express; a free-form script is harder to ' +
      'verify and bypasses the gate.\n' +
      '• AUTHOR A PART + EXPORT STEP. Build the solid with the modeling verbs (or run_script), ' +
      'confirm it is a valid non-empty body, then export with step_save / export_* — the STEP ' +
      'must re-import clean, because the assembly stage consumes your part through it.\n' +
      '• GEOMETRY GATE (P1) — a script that RUNS is not a part that EXISTS. Before reporting ' +
      'done, verify the geometry, not just the code: validate_geometry (valid, non-empty solid), ' +
      'get_model_info / get_mass_properties (volume > 0, bounding box within the declared ' +
      'envelope), analyze_dof (exactly the DOF the spec declares — a revolute joint adds 1, a ' +
      'coupled gripper nets 1), check_clearance (zero interference in the declared pose), and a ' +
      'reproducible STEP export. An empty / invalid / wrong-scale / wrong-DOF / interfering part ' +
      'is a FAIL. A SOLVER/tool limitation (a coupled mechanism that can\'t be driven, a ' +
      'constraint verb that crashes) is an ESCALATION, not a rejection — name the verb and its ' +
      'return.\n' +
      '• COORDINATE CONVENTION. build123d / OpenCascade is right-handed, +Z up, millimetres; ' +
      'global origin is the assembly datum unless the spec says otherwise.\n' +
      '• TEST / RUN. Use the project\'s OWN interpreter — run the bsync/build123d test suite with ' +
      'pytest under the project\'s pinned Python (e.g. `python3.10 -m pytest`), NOT ambient ' +
      'python3; the wrong runtime false-fails passing geometry. tsc/vitest say nothing about ' +
      'whether a solid is valid — for geometry deliverables the geometry gate above is the bar.',
    allowedTools: 'mcp__build123d-ocp-mcp mcp__bsync-desktop',
  },
  'web-react': {
    id: 'web-react',
    description: 'React + TypeScript web frontend (components, hooks, Vite/Bun-managed UI).',
    contextPrompt:
      'You are working in a React + TypeScript frontend. Follow the existing component, ' +
      'hook, and styling conventions of neighbouring files. Type-check changes with the ' +
      "project's tsc and run the scoped UI tests — never npm install in a Bun-managed " +
      'ui/ tree (it corrupts node_modules and produces spurious JSX type errors).',
    allowedTools: 'mcp__chrome-devtools',
  },
};

/**
 * Writable, cross-project pack store (Profile L4b — the substrate L4d's approve
 * writes into). The seed {@link TECH_PACKS} above ships in code; this store is the
 * mutable other half: an APPROVED pack (drafted by L4c) is persisted here so it
 * lands cross-project — every project's resolver sees it without a code change.
 *
 * Persistence is a single JSON map ({ [id]: TechPack }) at
 * `~/.mermaid-collab/tech-packs.json`, overridable via MERMAID_TECH_PACKS_PATH
 * (tests + alternate homes). Reads fail SOFT (missing/corrupt file → empty store)
 * so a worker launch never breaks on a bad store; writes are id-keyed upserts.
 */
const STORE_PATH_ENV = 'MERMAID_TECH_PACKS_PATH';

function storePath(): string {
  return process.env[STORE_PATH_ENV] ?? join(homedir(), '.mermaid-collab', 'tech-packs.json');
}

/** Read the persisted store as an id→pack map. Never throws — a missing or
 *  unparseable file yields an empty store. */
function readStore(): Record<string, TechPack> {
  const path = storePath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, TechPack>;
    }
  } catch {
    /* corrupt store → treat as empty, never break a launch */
  }
  return {};
}

function writeStore(store: Record<string, TechPack>): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf8');
}

const PACK_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Persist (upsert by id) an approved tech-pack into the writable store and return
 *  it. Validates the pack shape — the store is the L4 adoption substrate, so a
 *  malformed pack must fail loudly rather than corrupt the cross-project library.
 *  A stored pack with the same id as a seed pack OVERRIDES the seed (see listPacks). */
export function registerPack(pack: TechPack): TechPack {
  if (!pack || typeof pack !== 'object') throw new Error('registerPack: pack must be an object');
  const id = (pack.id ?? '').trim();
  if (!PACK_ID.test(id)) throw new Error(`registerPack: id must be kebab-case (got "${pack.id}")`);
  if (!pack.description?.trim()) throw new Error('registerPack: description is required');
  if (typeof pack.contextPrompt !== 'string') throw new Error('registerPack: contextPrompt must be a string');
  if (typeof pack.allowedTools !== 'string') throw new Error('registerPack: allowedTools must be a string');
  const clean: TechPack = {
    id,
    description: pack.description.trim(),
    contextPrompt: pack.contextPrompt,
    allowedTools: pack.allowedTools,
    ...(pack.model ? { model: pack.model } : {}),
  };
  const store = readStore();
  store[id] = clean;
  writeStore(store);
  return clean;
}

/** The full pack library: the seed {@link TECH_PACKS} MERGED with the writable
 *  store, where a stored pack overrides a seed pack of the same id (the seed stays
 *  the default; an approved override or new pack wins). This is the set the L2/L3
 *  resolver reads. */
export function listPacks(): TechPack[] {
  const merged = new Map<string, TechPack>();
  for (const p of Object.values(TECH_PACKS)) merged.set(p.id, p);
  for (const p of Object.values(readStore())) {
    if (p && typeof p === 'object' && typeof p.id === 'string') merged.set(p.id, p);
  }
  return [...merged.values()];
}

/** A pack id this project declares in its manifest is "known" only if it resolves
 *  against the merged library ({@link listPacks} — seed + writable store). Unknown
 *  ids are dropped (never throw) so a stale or typo'd reference degrades gracefully
 *  rather than breaking a worker launch. */
export function resolveTechPacks(ids?: readonly string[] | null): TechPack[] {
  if (!ids || ids.length === 0) return [];
  const library = new Map(listPacks().map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: TechPack[] = [];
  for (const id of ids) {
    const pack = library.get(id);
    if (pack && !seen.has(id)) {
      seen.add(id);
      out.push(pack);
    }
  }
  return out;
}

/** A project's declared pack selection, resolved against the shared registry. */
export interface ResolvedManifestPacks {
  /** The resolved packs the project declared (unknown ids dropped). */
  packs: TechPack[];
  /** The project's primary domain pack, if it declared one AND it resolves. */
  primary?: TechPack;
}

/**
 * Read a project's manifest pack declaration and resolve it against the shared
 * registry. The manifest declares ids only (`packs: ["cad"]`, optional
 * `primaryPack: "cad"`); the pack bodies live here, cross-project. A `primaryPack`
 * that isn't in `packs` is still honoured if it resolves (and is folded into the
 * resolved list). Returns empty packs when the project declares none.
 */
export function resolveManifestPacks(project: string): ResolvedManifestPacks {
  const manifest = loadProjectManifest(project);
  const declared = manifest?.packs ?? [];
  const primaryId = manifest?.primaryPack;
  // Fold a primary that wasn't listed in `packs` into the resolution set so it is
  // never silently dropped just because it was only named as the primary.
  const ids = primaryId && !declared.includes(primaryId) ? [...declared, primaryId] : declared;
  const packs = resolveTechPacks(ids);
  const primary = primaryId ? packs.find((p) => p.id === primaryId) : undefined;
  return { packs, primary };
}
