/**
 * Robotics domain plugin (design-system-object-primitive §8, Phase 4).
 *
 * Seeds the `robotics` domain through the generic plugin machinery with ZERO core
 * edits: it contributes robotics `SystemObjectType`s (a Robot composed of Axes and
 * Links), the `robotics:urdf` ArtifactKind, and binds the generic subprocess gate
 * (`manifestCommandGatePlugin`) — a robot's mechanical gate is its own project
 * `gateCommand` (a URDF validator / sim smoke test), so it reuses the fail-closed
 * manifest gate rather than a bespoke one, mirroring the SaaS plugin. A per-domain
 * fleet-graph view is surfaced via the open `views` seam. Importing this module
 * registers the domain; the core never names "robotics".
 */
import type { DomainPlugin, SystemObjectType, ArtifactKind, FleetViewContribution } from '../../services/domain-plugin';
import { registerDomainPlugin } from '../../services/plugin-registry';
import { manifestCommandGatePlugin } from '../../services/gate-runner';

/** The URDF model describing the robot's links/joints (stored as a document). */
const ROBOTICS_URDF: ArtifactKind = { kind: 'robotics:urdf', baseType: 'document', ext: 'urdf', folder: 'urdf' };

const ROBOTICS_TYPES: SystemObjectType[] = [
  {
    id: 'robotics:Robot',
    version: 1,
    domain: 'robotics',
    attributeSchema: {},
    allowedChildTypes: ['robotics:Axis', 'robotics:Link'], // a robot composes axes + links
    requiredArtifacts: ['robotics:urdf'], // released only with its URDF attached
    gateBinding: manifestCommandGatePlugin.id, // 'manifest-command' — the project gateCommand
    agentProfile: 'robotics',
  },
  {
    id: 'robotics:Axis',
    version: 1,
    domain: 'robotics',
    attributeSchema: {},
    allowedChildTypes: [], // a leaf actuated joint/axis
    requiredArtifacts: [],
    gateBinding: manifestCommandGatePlugin.id,
    agentProfile: 'robotics',
  },
  {
    id: 'robotics:Link',
    version: 1,
    domain: 'robotics',
    attributeSchema: {},
    allowedChildTypes: [], // a leaf rigid member
    requiredArtifacts: [],
    gateBinding: manifestCommandGatePlugin.id,
    agentProfile: 'robotics',
  },
];

/** Per-domain fleet-graph view seam (consumed by the view layer later). */
const ROBOTICS_VIEW: FleetViewContribution = { id: 'robotics:fleet', label: 'Robotics objects', domain: 'robotics' };

export const roboticsPlugin: DomainPlugin = {
  domain: 'robotics',
  types: ROBOTICS_TYPES,
  artifactKinds: [ROBOTICS_URDF],
  gates: [manifestCommandGatePlugin],
  views: [ROBOTICS_VIEW],
};

registerDomainPlugin(roboticsPlugin);
