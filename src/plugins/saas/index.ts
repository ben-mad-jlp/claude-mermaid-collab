/**
 * SaaS domain plugin (design-system-object-primitive §7.4, Phase 2 #6c).
 *
 * Seeds the `saas` domain: SaaS `SystemObjectType`s, the `saas:openapi` and
 * `saas:storybook` ArtifactKinds, and the generic subprocess gate — a SaaS repo's
 * mechanical gate is its own `gateCommand` (pytest/tsc/etc.), so it binds the
 * fail-closed `manifestCommandGatePlugin` (parseTrailingVerdict over the trailing
 * gate output) already registered in gate-runner, rather than a bespoke gate.
 * Importing this module registers the domain; the core never names "saas".
 */
import type { DomainPlugin, SystemObjectType, ArtifactKind } from '../../services/domain-plugin';
import { registerDomainPlugin } from '../../services/plugin-registry';
import { manifestCommandGatePlugin } from '../../services/gate-runner';

/** OpenAPI contract for a service (stored as a document). */
const SAAS_OPENAPI: ArtifactKind = { kind: 'saas:openapi', baseType: 'document', ext: 'yaml', folder: 'openapi' };
/** Storybook stories for a component (stored as an embed). */
const SAAS_STORYBOOK: ArtifactKind = { kind: 'saas:storybook', baseType: 'embed', ext: 'json', folder: 'storybook' };

const SAAS_TYPES: SystemObjectType[] = [
  {
    id: 'saas:Service',
    version: 1,
    domain: 'saas',
    attributeSchema: {},
    allowedChildTypes: ['saas:Service', 'saas:Component'],
    requiredArtifacts: ['saas:openapi'],
    gateBinding: manifestCommandGatePlugin.id, // 'manifest-command' — the project gateCommand
    agentProfile: 'backend',
  },
  {
    id: 'saas:Component',
    version: 1,
    domain: 'saas',
    attributeSchema: {},
    allowedChildTypes: [],
    requiredArtifacts: ['saas:storybook'],
    gateBinding: manifestCommandGatePlugin.id,
    agentProfile: 'frontend',
  },
];

export const saasPlugin: DomainPlugin = {
  domain: 'saas',
  types: SAAS_TYPES,
  artifactKinds: [SAAS_OPENAPI, SAAS_STORYBOOK],
  gates: [manifestCommandGatePlugin],
};

registerDomainPlugin(saasPlugin);
