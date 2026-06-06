/**
 * Requirements domain plugin (design-system-object-primitive §8, Phase 4).
 *
 * Seeds the `requirements` domain: a Requirement that may compose sub-Requirements
 * (a requirement tree), the `requirements:spec` ArtifactKind, and the generic
 * subprocess gate (`manifestCommandGatePlugin`) — a requirement's mechanical gate
 * is a predicate-bound check (its `{metric, op, target}` asserted by a project
 * `gateCommand`), so it binds the fail-closed manifest gate rather than a bespoke
 * one, mirroring the SaaS plugin. A per-domain fleet-graph view is surfaced via the
 * open `views` seam. Importing this module registers the domain; the core never
 * names "requirements".
 */
import type { DomainPlugin, SystemObjectType, ArtifactKind, FleetViewContribution } from '../../services/domain-plugin';
import { registerDomainPlugin } from '../../services/plugin-registry';
import { manifestCommandGatePlugin } from '../../services/gate-runner';

/** The requirement's specification (metric/op/target + rationale; stored as a document). */
const REQUIREMENTS_SPEC: ArtifactKind = { kind: 'requirements:spec', baseType: 'document', ext: 'md', folder: 'requirements' };

const REQUIREMENTS_TYPES: SystemObjectType[] = [
  {
    id: 'requirements:Requirement',
    version: 1,
    domain: 'requirements',
    attributeSchema: {},
    allowedChildTypes: ['requirements:Requirement'], // requirements decompose into sub-requirements
    requiredArtifacts: ['requirements:spec'], // released only with its spec attached
    gateBinding: manifestCommandGatePlugin.id, // 'manifest-command' — the predicate-bound project gateCommand
    agentProfile: 'planner',
  },
];

/** Per-domain fleet-graph view seam (consumed by the view layer later). */
const REQUIREMENTS_VIEW: FleetViewContribution = { id: 'requirements:fleet', label: 'Requirements', domain: 'requirements' };

export const requirementsPlugin: DomainPlugin = {
  domain: 'requirements',
  types: REQUIREMENTS_TYPES,
  artifactKinds: [REQUIREMENTS_SPEC],
  gates: [manifestCommandGatePlugin],
  views: [REQUIREMENTS_VIEW],
};

registerDomainPlugin(requirementsPlugin);
