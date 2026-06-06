import { describe, it, expect } from 'vitest';
// Importing the seed plugins registers them (side-effect) into the global
// plugin registry + gate-runner. Vitest isolates module state per test file, so
// this file's registry contains exactly the cad + saas seeds.
import { cadPlugin } from '../../plugins/cad';
import { saasPlugin } from '../../plugins/saas';
import { resolvePlugins, listDomainPlugins } from '../plugin-registry';
import { createArtifactKindResolver } from '../artifact-kind-resolver';
import { listGatePlugins } from '../gate-runner';

describe('seed plugins (cad + saas) register through the registry', () => {
  it('both domains are registered in the global base', () => {
    const domains = listDomainPlugins().map((p) => p.domain);
    expect(domains).toContain('cad');
    expect(domains).toContain('saas');
  });

  it('their SystemObjectTypes resolve through resolvePlugins', () => {
    const { types } = resolvePlugins();
    expect(types.get('cad:Part')?.requiredArtifacts).toContain('cad:step');
    expect(types.get('cad:Assembly')?.allowedChildTypes).toContain('cad:Part');
    expect(types.get('saas:Service')?.requiredArtifacts).toContain('saas:openapi');
    expect(types.get('saas:Component')?.requiredArtifacts).toContain('saas:storybook');
  });

  it('their ArtifactKinds resolve through the overlay resolver', () => {
    const kinds = listDomainPlugins().flatMap((p) => p.artifactKinds);
    const resolver = createArtifactKindResolver(kinds);
    expect(resolver.resolve('cad:step')).toEqual({ baseType: 'document', ext: 'step', folder: 'parts' });
    expect(resolver.resolve('saas:openapi').folder).toBe('openapi');
    expect(resolver.has('saas:storybook')).toBe(true);
  });

  it('their gates register in gate-runner (runCadGate as #1 + the saas subprocess adapter)', () => {
    const ids = listGatePlugins().map((g) => g.id);
    expect(ids).toContain('cad-step'); // runCadGate wired via cad-gate-plugin
    expect(ids).toContain('manifest-command'); // saas binds the generic gateCommand adapter
  });

  it('each plugin binds its declared gate', () => {
    expect(cadPlugin.gates.map((g) => g.id)).toContain('cad-step');
    expect(saasPlugin.gates.map((g) => g.id)).toContain('manifest-command');
  });
});
