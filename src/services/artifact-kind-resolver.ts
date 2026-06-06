/**
 * Artifact-kind resolver (design-system-object-primitive §6, Phase 2 #5).
 *
 * An OVERLAY over the closed base storage vocabulary: it maps a domain-qualified
 * ArtifactKind name (e.g. "<domain>:<flavor>") onto how that flavor is actually
 * stored/rendered — { baseType, ext, folder }. The closed `ArtifactType` union
 * (routes/artifact-api.ts / domain-plugin.ts) is NEVER edited; this resolver sits
 * on top of it, so adding a new domain flavor is migration-free.
 *
 * CORE PURITY (core-purity.test.ts): this file is core and carries ZERO domain
 * literals in CODE — it never names a domain or flavor. The kinds it resolves
 * come entirely from registered DomainPlugins (ArtifactKind[]), not from any
 * table baked in here. A domain name may appear only in a comment.
 *
 * FAIL-CLOSED (design open-Q #2, RESOLVED → fail-closed): resolving an
 * unregistered kind THROWS. There is no permissive fallback to a base type — an
 * unknown overlay is a programming/registration error, and silently storing it
 * under a guessed folder/ext would corrupt the artifact store. Callers that want
 * a soft check use `has()` first.
 */
import type { ArtifactKind, ArtifactType } from './domain-plugin';

/** The resolved storage facts for a kind — the overlay minus its own name. */
export interface ResolvedArtifactKind {
  baseType: ArtifactType;
  ext: string;
  folder: string;
}

/** Thrown when a kind is not registered (fail-closed) or a duplicate is registered. */
export class ArtifactKindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactKindError';
  }
}

export interface ArtifactKindResolver {
  /** Resolve a kind to its storage overlay. Throws ArtifactKindError if unknown (fail-closed). */
  resolve(kind: string): ResolvedArtifactKind;
  /** True iff `kind` is registered — the soft check before resolve(). */
  has(kind: string): boolean;
  /** All registered kind names (sorted), for diagnostics/listing. */
  kinds(): string[];
}

/**
 * Build a resolver from the ArtifactKinds contributed by registered domain
 * plugins. Pass `plugin.artifactKinds` flattened across every registered plugin
 * — the resolver itself stays domain-free.
 *
 * Registration is fail-closed on collisions too: two entries claiming the same
 * `kind` name are an ambiguous overlay and throw at build time, rather than
 * letting last-write-wins silently shadow one domain's flavor.
 */
export function createArtifactKindResolver(kinds: readonly ArtifactKind[]): ArtifactKindResolver {
  const map = new Map<string, ResolvedArtifactKind>();
  for (const k of kinds) {
    if (map.has(k.kind)) {
      throw new ArtifactKindError(`duplicate artifact kind registered: "${k.kind}"`);
    }
    map.set(k.kind, { baseType: k.baseType, ext: k.ext, folder: k.folder });
  }
  return {
    resolve(kind: string): ResolvedArtifactKind {
      const hit = map.get(kind);
      if (!hit) {
        throw new ArtifactKindError(`unknown artifact kind: "${kind}" (not registered by any domain plugin)`);
      }
      return hit;
    },
    has(kind: string): boolean {
      return map.has(kind);
    },
    kinds(): string[] {
      return [...map.keys()].sort();
    },
  };
}
