/**
 * Electrical domain plugin (design-system-object-primitive §8, Phase 4).
 *
 * Seeds the `electrical` domain: a Board composed of Components, the
 * `electrical:datasheet` and `electrical:schematic` ArtifactKinds (per §8), and
 * the generic subprocess gate (`manifestCommandGatePlugin`) — an electrical
 * design's mechanical gate is its own project `gateCommand` (an ERC/DRC run), so
 * it binds the fail-closed manifest gate rather than a bespoke one, mirroring the
 * SaaS plugin. A per-domain fleet-graph view is surfaced via the open `views`
 * seam. Importing this module registers the domain; the core never names "electrical".
 */
import type { DomainPlugin, SystemObjectType, ArtifactKind, FleetViewContribution } from '../../services/domain-plugin';
import { registerDomainPlugin } from '../../services/plugin-registry';
import { manifestCommandGatePlugin } from '../../services/gate-runner';

/** A part's datasheet (stored as a document). */
const ELECTRICAL_DATASHEET: ArtifactKind = { kind: 'electrical:datasheet', baseType: 'document', ext: 'pdf', folder: 'datasheets' };
/** A board's schematic (stored as a diagram). */
const ELECTRICAL_SCHEMATIC: ArtifactKind = { kind: 'electrical:schematic', baseType: 'diagram', ext: 'mmd', folder: 'schematics' };

const ELECTRICAL_TYPES: SystemObjectType[] = [
  {
    id: 'electrical:Board',
    version: 1,
    domain: 'electrical',
    attributeSchema: {},
    allowedChildTypes: ['electrical:Component'], // a board composes components
    requiredArtifacts: ['electrical:schematic'], // released only with its schematic attached
    gateBinding: manifestCommandGatePlugin.id, // 'manifest-command' — the project gateCommand (ERC/DRC)
    agentProfile: 'electrical',
  },
  {
    id: 'electrical:Component',
    version: 1,
    domain: 'electrical',
    attributeSchema: {},
    allowedChildTypes: [], // a leaf part
    requiredArtifacts: ['electrical:datasheet'], // a part needs its datasheet attached
    gateBinding: manifestCommandGatePlugin.id,
    agentProfile: 'electrical',
  },
];

/** Per-domain fleet-graph view seam (consumed by the view layer later). */
const ELECTRICAL_VIEW: FleetViewContribution = { id: 'electrical:fleet', label: 'Electrical objects', domain: 'electrical' };

export const electricalPlugin: DomainPlugin = {
  domain: 'electrical',
  types: ELECTRICAL_TYPES,
  artifactKinds: [ELECTRICAL_DATASHEET, ELECTRICAL_SCHEMATIC],
  gates: [manifestCommandGatePlugin],
  views: [ELECTRICAL_VIEW],
};

registerDomainPlugin(electricalPlugin);
