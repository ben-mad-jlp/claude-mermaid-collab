/**
 * System-object core interfaces (design-system-object-primitive §3, Phase 2 #1).
 *
 * The PURE, domain-FREE type vocabulary for the system-object primitive: the
 * durable instance/type/revision shapes and the plugin contract a domain
 * (CAD, SaaS, robotics, …) implements to contribute its types/artifacts/gates.
 *
 * CORE PURITY (core-purity.test.ts): like gate-runner.ts, this file is core and
 * must contain ZERO domain literals in CODE — a domain name may appear only in a
 * comment. Domains live in their own plugin files and register via DomainPlugin.
 *
 * Nothing here is a class or carries behavior; it is the shared type surface the
 * store (system-object-store.ts), the registry (plugin-registry.ts), and the
 * resolvers build on. The gate contract is re-exported from gate-runner.ts (the
 * Phase-1 registry) so a DomainPlugin's gates ARE the registry's gates — one
 * GatePlugin type across collab, never a divergent second copy.
 */
import type { GatePlugin } from './gate-runner';
import type { GateVerdict } from './coordinator-daemon';

// Re-export the Phase-1 gate contract so domain plugins and the store share the
// single canonical GatePlugin/GateVerdict rather than redeclaring them.
export type { GatePlugin, GateVerdict };

/** A JSON-Schema document (validates a SystemObject's `attributes`). Kept as an
 *  open record — the core does not bundle a validator; a plugin/store may. */
export type JSONSchema = Record<string, unknown>;

/** The base artifact storage types collab already understands (mirrors the union
 *  in routes/artifact-api.ts). A domain's ArtifactKind overlays a richer kind
 *  name onto one of these for storage/rendering. */
export type ArtifactType =
  | 'diagram'
  | 'document'
  | 'snippet'
  | 'design'
  | 'spreadsheet'
  | 'embed';

/**
 * A domain's artifact flavor overlaid onto a base storage type. The overlay
 * `kind` is the domain-qualified name a type's `requiredArtifacts` reference;
 * `baseType`/`ext`/`folder` say how it is actually stored and rendered.
 * Example (in a plugin, not here): { kind: "<domain>:step", baseType: "document", ext: "step", folder: "parts" }.
 */
export interface ArtifactKind {
  /** Domain-qualified kind, e.g. "<domain>:<flavor>". */
  kind: string;
  baseType: ArtifactType;
  /** File extension (no dot), for storage + syntax/render selection. */
  ext: string;
  /** Sub-folder under the session/object artifact store. */
  folder: string;
}

/**
 * Type-registry entry — the schema, composition grammar, gate binding, and agent
 * profile for a kind of object. Seeded from plugins and resolved global ⟵ org ⟵
 * project (a project may only NARROW the grammar, never widen it).
 */
export interface SystemObjectType {
  /** Domain-qualified id, e.g. "<domain>:<TypeName>". */
  id: string;
  /** Schema version; a SystemObject pins this at create and does not float. */
  version: number;
  /** The plugin domain that contributed this type. */
  domain: string;
  /** Validates a SystemObject's `attributes`. */
  attributeSchema: JSONSchema;
  /** Composition grammar: type ids permitted as direct children. */
  allowedChildTypes: string[];
  /** ArtifactKind.kind values that must attach before the object is "released". */
  requiredArtifacts: string[];
  /** Gate id resolved in the gate registry, or null for no bound gate. */
  gateBinding: string | null;
  /** Agent profile key (→ resolveProfile), or null. */
  agentProfile: string | null;
}

/**
 * A durable object instance — identity + composition + attributes ONLY. By
 * construction it carries NO work-graph lifecycle (no status/claim/lease): that
 * is the work-vs-durable firewall (§4). Work to build/change it lives on a Todo
 * via the one-directional Todo.objectRef link.
 */
export interface SystemObject {
  /** Stable referent identity. */
  id: string;
  /** → SystemObjectType.id. */
  typeId: string;
  /** Pinned at create; the instance does not float to newer type versions. */
  typeVersion: number;
  /** Recursive composition parent, or null for a root. */
  parentObjectId: string | null;
  /** Multiplicity within the parent (for BOM rollup). */
  qty: number;
  name: string;
  /** Validated against the type's attributeSchema. */
  attributes: Record<string, unknown>;
  /** → SystemRevision.id of the current content snapshot, or null. */
  currentRevisionId: string | null;
}

/**
 * Immutable, content-addressed snapshot of an object's content. Identical content
 * ⇒ identical `contentHash` ⇒ reuse. The latest gate result for this exact
 * content is cached on the revision (not stored as a separate verdict table).
 */
export interface SystemRevision {
  id: string;
  objectId: string;
  /** Hash over { attributes, sorted child refs+qty, attached artifact hashes }. */
  contentHash: string;
  createdAt: number;
  /** Last gate result for this exact content. */
  gateVerdict: 'pass' | 'fail' | 'unknown';
}

/**
 * An optional FleetView contribution a plugin may surface. Shape is intentionally
 * open at this phase — the consuming view layer narrows it later.
 */
export interface FleetViewContribution {
  id: string;
  [key: string]: unknown;
}

/**
 * The contract a domain implements to extend collab with its own object types,
 * artifact flavors, and gates. Registered via the plugin registry; the core
 * learns no domain specifics beyond what these generic fields carry.
 */
export interface DomainPlugin {
  /** Domain identifier, e.g. "<domain>". */
  domain: string;
  types: SystemObjectType[];
  artifactKinds: ArtifactKind[];
  /** Gates this domain registers (the Phase-1 GatePlugin contract). */
  gates: GatePlugin[];
  views?: FleetViewContribution[];
}
