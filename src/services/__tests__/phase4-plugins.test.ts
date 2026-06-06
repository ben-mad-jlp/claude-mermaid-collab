import { describe, it, expect } from 'vitest';
// Importing the barrel registers the full built-in domain set (side-effect) into
// the global plugin registry + gate-runner. Vitest isolates module state per test
// file, so this file's registry contains exactly the cad + saas + robotics +
// electrical + requirements seeds.
import { roboticsPlugin, electricalPlugin, requirementsPlugin } from '../../plugins';
import { resolvePlugins, listDomainPlugins } from '../plugin-registry';
import { createArtifactKindResolver } from '../artifact-kind-resolver';
import { listGatePlugins } from '../gate-runner';

describe('Phase 4 plugins (robotics + electrical + requirements) register through the registry', () => {
  it('all three new domains are registered in the global base (alongside cad + saas)', () => {
    const domains = listDomainPlugins().map((p) => p.domain);
    expect(domains).toEqual(expect.arrayContaining(['cad', 'saas', 'robotics', 'electrical', 'requirements']));
  });

  it('their SystemObjectTypes resolve through resolvePlugins with the declared composition grammar', () => {
    const { types } = resolvePlugins();
    expect(types.get('robotics:Robot')?.allowedChildTypes).toEqual(expect.arrayContaining(['robotics:Axis', 'robotics:Link']));
    expect(types.get('robotics:Robot')?.requiredArtifacts).toContain('robotics:urdf');
    expect(types.get('electrical:Board')?.allowedChildTypes).toContain('electrical:Component');
    expect(types.get('electrical:Component')?.requiredArtifacts).toContain('electrical:datasheet');
    expect(types.get('requirements:Requirement')?.allowedChildTypes).toContain('requirements:Requirement');
  });

  it('their ArtifactKinds resolve through the overlay resolver (incl. electrical:datasheet/schematic)', () => {
    const kinds = listDomainPlugins().flatMap((p) => p.artifactKinds);
    const resolver = createArtifactKindResolver(kinds);
    expect(resolver.resolve('robotics:urdf')).toEqual({ baseType: 'document', ext: 'urdf', folder: 'urdf' });
    expect(resolver.resolve('electrical:datasheet').baseType).toBe('document');
    expect(resolver.resolve('electrical:schematic')).toEqual({ baseType: 'diagram', ext: 'mmd', folder: 'schematics' });
    expect(resolver.has('requirements:spec')).toBe(true);
  });

  it('each new domain binds the predicate-bound subprocess gate (manifest-command)', () => {
    const ids = listGatePlugins().map((g) => g.id);
    expect(ids).toContain('manifest-command');
    for (const p of [roboticsPlugin, electricalPlugin, requirementsPlugin]) {
      expect(p.gates.map((g) => g.id)).toContain('manifest-command');
    }
  });

  it('each new domain surfaces a per-domain fleet-graph view contribution', () => {
    expect(roboticsPlugin.views?.[0]).toMatchObject({ id: 'robotics:fleet', domain: 'robotics' });
    expect(electricalPlugin.views?.[0]).toMatchObject({ id: 'electrical:fleet', domain: 'electrical' });
    expect(requirementsPlugin.views?.[0]).toMatchObject({ id: 'requirements:fleet', domain: 'requirements' });
  });
});
