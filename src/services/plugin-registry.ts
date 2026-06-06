/**
 * Plugin registry — global ⟵ org ⟵ project merge (design-system-object-primitive
 * §7.2, Phase 2 #4). Mirrors `resolveProfile` (agent-profiles.ts): a global base
 * is overlaid by an org layer and then by the project's `.collab/project.json`
 * `plugins[]`, with the firm rule that a project (or org) may only **NARROW** a
 * type's composition grammar — subset its `allowedChildTypes`/`requiredArtifacts`
 * — never WIDEN it. A widening overlay throws.
 *
 * Plus the pure composition-grammar check `validateChild(parentType, childType)`:
 * a child type is permitted under a parent iff it is in the parent's (already
 * narrowed) `allowedChildTypes`.
 *
 * CORE PURITY (core-purity.test.ts): this file is core and must contain ZERO
 * domain literals in CODE — it speaks only in generic type ids (strings). Domains
 * live in their own `plugins/<domain>/index.ts` and register via
 * `registerDomainPlugin`; the core learns nothing about them.
 */
import type { DomainPlugin, SystemObjectType } from './domain-plugin';
import { loadProjectManifest } from '../config/project-manifest';

// ─── Global base registry ────────────────────────────────────────────────────
// The global set of domain plugins, registered (idempotently by domain) from
// each plugin's own module — mirroring gate-runner's registerGatePlugin pattern.

const globalPlugins: DomainPlugin[] = [];

/** Register a domain plugin into the global base. Idempotent by `domain` so a
 *  module side-effect registration never double-counts. */
export function registerDomainPlugin(plugin: DomainPlugin): void {
  if (globalPlugins.some((p) => p.domain === plugin.domain)) return;
  globalPlugins.push(plugin);
}

/** The registered global base plugins (registration order). */
export function listDomainPlugins(): ReadonlyArray<DomainPlugin> {
  return globalPlugins.slice();
}

/** Test helper: empty the global registry so a test starts from a known base. */
export function clearDomainPlugins(): void {
  globalPlugins.length = 0;
}

// ─── Narrowing overlays (org + project layers) ───────────────────────────────

/** A narrowing overlay on one already-registered type. An org config or a
 *  project's `.collab/project.json` `plugins[]` entry may subset a type's grammar
 *  to be stricter locally; it can never add new entries (that would widen). */
export interface PluginTypeOverlay {
  /** The `SystemObjectType.id` this overlay narrows (must already be registered). */
  id: string;
  /** Subset of the base `allowedChildTypes`. Any element not already allowed → throw. */
  allowedChildTypes?: string[];
  /** Subset of the base `requiredArtifacts`. Any element not already required → throw. */
  requiredArtifacts?: string[];
}

/** Fail loudly if `candidate` is not a subset of `base` — the narrowing-only rule. */
function assertSubset(candidate: string[], base: string[], typeId: string, field: string): void {
  const allowed = new Set(base);
  const widened = candidate.filter((x) => !allowed.has(x));
  if (widened.length > 0) {
    throw new Error(
      `plugin-registry: an overlay may only NARROW ${field} of "${typeId}" (subset of the ` +
      `global grammar) — it tried to WIDEN with [${widened.join(', ')}], which is forbidden.`,
    );
  }
}

/** Apply one overlay to a base type, returning a narrowed copy. Throws on widening. */
function narrowType(base: SystemObjectType, overlay: PluginTypeOverlay): SystemObjectType {
  const next: SystemObjectType = { ...base };
  if (overlay.allowedChildTypes) {
    assertSubset(overlay.allowedChildTypes, base.allowedChildTypes, base.id, 'allowedChildTypes');
    next.allowedChildTypes = [...overlay.allowedChildTypes];
  }
  if (overlay.requiredArtifacts) {
    assertSubset(overlay.requiredArtifacts, base.requiredArtifacts, base.id, 'requiredArtifacts');
    next.requiredArtifacts = [...overlay.requiredArtifacts];
  }
  return next;
}

/** Apply a list of overlays in order to the resolved type map (mutating it).
 *  An overlay referencing an unregistered type id throws — you cannot narrow
 *  (or, by implication, add) a type that the global base never declared. */
function applyOverlays(types: Map<string, SystemObjectType>, overlays: PluginTypeOverlay[]): void {
  for (const overlay of overlays) {
    const base = types.get(overlay.id);
    if (!base) {
      throw new Error(
        `plugin-registry: overlay references unknown type "${overlay.id}" — a project/org may ` +
        `only narrow types declared by the global base, never introduce new ones here.`,
      );
    }
    types.set(overlay.id, narrowType(base, overlay));
  }
}

// ─── Resolution ──────────────────────────────────────────────────────────────

/** The resolved type catalog after the global ⟵ org ⟵ project merge. */
export interface ResolvedPlugins {
  /** type id → resolved (post-narrowing) `SystemObjectType`. */
  types: Map<string, SystemObjectType>;
}

/**
 * Resolve the effective type catalog for a project: the global base plugins'
 * types, narrowed first by any `orgOverlays`, then by the project's
 * `.collab/project.json` `plugins[]`. Mirrors `resolveProfile(type, project)`.
 *
 * The `org` layer is intentionally an injected overlay list (default none): the
 * design defers a durable org-catalog source as premature for single-user, so it
 * is a real-but-empty seam here rather than a fabricated config format. When an
 * org catalog lands it feeds this same narrowing path.
 */
export function resolvePlugins(project?: string, orgOverlays: PluginTypeOverlay[] = []): ResolvedPlugins {
  // 1. Global base: flatten every registered plugin's types by id (copied so the
  //    registry's own objects are never mutated by narrowing).
  const types = new Map<string, SystemObjectType>();
  for (const plugin of globalPlugins) {
    for (const t of plugin.types) {
      types.set(t.id, { ...t, allowedChildTypes: [...t.allowedChildTypes], requiredArtifacts: [...t.requiredArtifacts] });
    }
  }
  // 2. Org layer (narrowing).
  applyOverlays(types, orgOverlays);
  // 3. Project layer: `.collab/project.json` `plugins[]` (narrowing).
  if (project) {
    const overlays = loadProjectManifest(project)?.plugins ?? [];
    applyOverlays(types, overlays);
  }
  return { types };
}

/**
 * Pure composition-grammar check: is `childType` permitted as a direct child of
 * `parentType`? True iff it is in the parent's (already narrowed) allowedChildTypes.
 * A type with no grammar (empty `allowedChildTypes`) permits no children.
 */
export function validateChild(parentType: SystemObjectType, childType: string): boolean {
  return parentType.allowedChildTypes.includes(childType);
}
