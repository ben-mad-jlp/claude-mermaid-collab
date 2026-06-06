/**
 * CAD domain plugin (design-system-object-primitive §7.4, Phase 2 #6b).
 *
 * Seeds the `cad` domain through the generic plugin machinery with ZERO core
 * edits: it contributes CAD `SystemObjectType`s, the `cad:step` ArtifactKind, and
 * the deterministic CAD gate (runCadGate, wired as gate plugin #1 via gate-runner
 * — importing `cad-gate-plugin` self-registers `cadGatePlugin` there). The whole
 * domain is opt-in by importing this module; the core never names "cad".
 */
import type { DomainPlugin, SystemObjectType, ArtifactKind } from '../../services/domain-plugin';
import { registerDomainPlugin } from '../../services/plugin-registry';
import { cadGatePlugin } from '../../services/cad-gate-plugin';

/** The exported STEP solid attached to a CAD part/assembly (stored as a document). */
const CAD_STEP: ArtifactKind = { kind: 'cad:step', baseType: 'document', ext: 'step', folder: 'parts' };

const CAD_TYPES: SystemObjectType[] = [
  {
    id: 'cad:Part',
    version: 1,
    domain: 'cad',
    attributeSchema: {},
    allowedChildTypes: [], // a leaf part has no sub-objects
    requiredArtifacts: ['cad:step'], // a part is "released" only with its STEP attached
    gateBinding: cadGatePlugin.id, // 'cad-step' — the deterministic geometry gate
    agentProfile: 'cad',
  },
  {
    id: 'cad:Assembly',
    version: 1,
    domain: 'cad',
    attributeSchema: {},
    allowedChildTypes: ['cad:Part', 'cad:Assembly'], // composition grammar
    requiredArtifacts: [],
    gateBinding: cadGatePlugin.id,
    agentProfile: 'cad',
  },
];

export const cadPlugin: DomainPlugin = {
  domain: 'cad',
  types: CAD_TYPES,
  artifactKinds: [CAD_STEP],
  gates: [cadGatePlugin],
};

registerDomainPlugin(cadPlugin);
