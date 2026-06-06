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
      'You are working in a build123d / OpenCascade CAD codebase. Deliverables are ' +
      'geometry, not just code: a script that runs is not a part that exists — a part ' +
      'must validate as a non-empty solid (volume > 0), stay within its declared ' +
      'envelope, and export to a clean STEP. Verify with the build123d/bsync MCP verbs ' +
      '(validate_geometry, mass_properties, analyze_dof, check_clearance), not tsc/pytest alone.',
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

/** A pack id this project declares in its manifest is "known" only if it resolves
 *  against {@link TECH_PACKS}. Unknown ids are dropped (never throw) so a stale or
 *  typo'd reference degrades gracefully rather than breaking a worker launch. */
export function resolveTechPacks(ids?: readonly string[] | null): TechPack[] {
  if (!ids || ids.length === 0) return [];
  const seen = new Set<string>();
  const out: TechPack[] = [];
  for (const id of ids) {
    const pack = TECH_PACKS[id];
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
