import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerDomainPlugin,
  clearDomainPlugins,
  listDomainPlugins,
  resolvePlugins,
  validateChild,
  type PluginTypeOverlay,
} from '../plugin-registry';
import type { DomainPlugin, SystemObjectType } from '../domain-plugin';

/** A bare type with a given grammar — only the fields the registry touches matter. */
function makeType(id: string, allowedChildTypes: string[], requiredArtifacts: string[] = []): SystemObjectType {
  return {
    id,
    version: 1,
    domain: 'test',
    attributeSchema: {},
    allowedChildTypes,
    requiredArtifacts,
    gateBinding: null,
    agentProfile: null,
  };
}

function makePlugin(domain: string, types: SystemObjectType[]): DomainPlugin {
  return { domain, types, artifactKinds: [], gates: [] };
}

describe('plugin-registry — global base + registration', () => {
  beforeEach(() => clearDomainPlugins());

  it('registers plugins and resolves their types into the catalog', () => {
    registerDomainPlugin(makePlugin('alpha', [makeType('alpha:Root', ['alpha:Leaf'])]));
    const { types } = resolvePlugins();
    expect(types.get('alpha:Root')?.allowedChildTypes).toEqual(['alpha:Leaf']);
  });

  it('registration is idempotent by domain', () => {
    const p = makePlugin('alpha', [makeType('alpha:Root', [])]);
    registerDomainPlugin(p);
    registerDomainPlugin(p);
    expect(listDomainPlugins()).toHaveLength(1);
  });

  it('does not mutate the registered plugin objects when narrowing', () => {
    const base = makeType('alpha:Root', ['a', 'b', 'c']);
    registerDomainPlugin(makePlugin('alpha', [base]));
    resolvePlugins(undefined, [{ id: 'alpha:Root', allowedChildTypes: ['a'] }]);
    expect(base.allowedChildTypes).toEqual(['a', 'b', 'c']); // original untouched
  });
});

describe('plugin-registry — narrowing-only merge', () => {
  beforeEach(() => {
    clearDomainPlugins();
    registerDomainPlugin(makePlugin('alpha', [makeType('alpha:Root', ['a', 'b', 'c'], ['art:x', 'art:y'])]));
  });

  it('NARROWING allowedChildTypes (subset) is allowed', () => {
    const overlay: PluginTypeOverlay = { id: 'alpha:Root', allowedChildTypes: ['a', 'b'] };
    const { types } = resolvePlugins(undefined, [overlay]);
    expect(types.get('alpha:Root')?.allowedChildTypes).toEqual(['a', 'b']);
  });

  it('NARROWING requiredArtifacts (subset) is allowed', () => {
    const overlay: PluginTypeOverlay = { id: 'alpha:Root', requiredArtifacts: ['art:x'] };
    const { types } = resolvePlugins(undefined, [overlay]);
    expect(types.get('alpha:Root')?.requiredArtifacts).toEqual(['art:x']);
  });

  it('WIDENING allowedChildTypes (new entry) THROWS', () => {
    const overlay: PluginTypeOverlay = { id: 'alpha:Root', allowedChildTypes: ['a', 'd'] };
    expect(() => resolvePlugins(undefined, [overlay])).toThrow(/narrow.*allowedChildTypes|WIDEN/i);
  });

  it('WIDENING requiredArtifacts (new entry) THROWS', () => {
    const overlay: PluginTypeOverlay = { id: 'alpha:Root', requiredArtifacts: ['art:x', 'art:z'] };
    expect(() => resolvePlugins(undefined, [overlay])).toThrow(/narrow.*requiredArtifacts|WIDEN/i);
  });

  it('an overlay on an unregistered type THROWS', () => {
    expect(() => resolvePlugins(undefined, [{ id: 'ghost:Type', allowedChildTypes: [] }])).toThrow(/unknown type/i);
  });

  it('layers narrow in order: org then project both subset the global base', () => {
    // org narrows c→{a,b}, then a second (project-equivalent) overlay narrows to {a}
    const { types } = resolvePlugins(undefined, [
      { id: 'alpha:Root', allowedChildTypes: ['a', 'b'] },
      { id: 'alpha:Root', allowedChildTypes: ['a'] },
    ]);
    expect(types.get('alpha:Root')?.allowedChildTypes).toEqual(['a']);
  });
});

describe('plugin-registry — validateChild', () => {
  it('accepts a child in the parent grammar', () => {
    const parent = makeType('alpha:Root', ['alpha:Leaf', 'alpha:Node']);
    expect(validateChild(parent, 'alpha:Leaf')).toBe(true);
  });

  it('rejects a child NOT in the parent grammar', () => {
    const parent = makeType('alpha:Root', ['alpha:Leaf']);
    expect(validateChild(parent, 'alpha:Other')).toBe(false);
  });

  it('a type with empty grammar permits no children', () => {
    expect(validateChild(makeType('alpha:Leaf', []), 'anything')).toBe(false);
  });

  it('validates against the POST-NARROWING grammar', () => {
    clearDomainPlugins();
    registerDomainPlugin(makePlugin('alpha', [makeType('alpha:Root', ['a', 'b'])]));
    const narrowed = resolvePlugins(undefined, [{ id: 'alpha:Root', allowedChildTypes: ['a'] }]).types.get('alpha:Root')!;
    expect(validateChild(narrowed, 'a')).toBe(true);
    expect(validateChild(narrowed, 'b')).toBe(false); // b was narrowed away
  });
});
