import { describe, it, expect } from 'vitest';
import { createArtifactKindResolver, ArtifactKindError } from '../artifact-kind-resolver';
import type { ArtifactKind } from '../domain-plugin';

// Neutral, domain-free fixture kinds — the resolver carries no domain knowledge;
// kinds always arrive from registered plugins, so the test supplies its own.
const KINDS: ArtifactKind[] = [
  { kind: 'alpha:spec', baseType: 'document', ext: 'spec', folder: 'specs' },
  { kind: 'beta:sheet', baseType: 'spreadsheet', ext: 'csv', folder: 'sheets' },
  { kind: 'alpha:plan', baseType: 'diagram', ext: 'mmd', folder: 'plans' },
];

describe('artifact-kind-resolver', () => {
  it('maps a known kind to its base type, ext, and folder', () => {
    const r = createArtifactKindResolver(KINDS);
    expect(r.resolve('alpha:spec')).toEqual({ baseType: 'document', ext: 'spec', folder: 'specs' });
    expect(r.resolve('beta:sheet')).toEqual({ baseType: 'spreadsheet', ext: 'csv', folder: 'sheets' });
    expect(r.resolve('alpha:plan')).toEqual({ baseType: 'diagram', ext: 'mmd', folder: 'plans' });
  });

  it('fails closed on an unknown kind (throws, no permissive fallback)', () => {
    const r = createArtifactKindResolver(KINDS);
    expect(() => r.resolve('gamma:unknown')).toThrow(ArtifactKindError);
    expect(() => r.resolve('gamma:unknown')).toThrow(/unknown artifact kind/);
  });

  it('has() is the soft check that does not throw', () => {
    const r = createArtifactKindResolver(KINDS);
    expect(r.has('alpha:spec')).toBe(true);
    expect(r.has('gamma:unknown')).toBe(false);
  });

  it('kinds() lists every registered kind, sorted', () => {
    const r = createArtifactKindResolver(KINDS);
    expect(r.kinds()).toEqual(['alpha:plan', 'alpha:spec', 'beta:sheet']);
  });

  it('an empty registry resolves nothing (still fail-closed)', () => {
    const r = createArtifactKindResolver([]);
    expect(r.kinds()).toEqual([]);
    expect(() => r.resolve('alpha:spec')).toThrow(ArtifactKindError);
  });

  it('rejects a duplicate kind at build time (ambiguous overlay)', () => {
    const dup: ArtifactKind[] = [
      { kind: 'alpha:spec', baseType: 'document', ext: 'spec', folder: 'specs' },
      { kind: 'alpha:spec', baseType: 'diagram', ext: 'mmd', folder: 'plans' },
    ];
    expect(() => createArtifactKindResolver(dup)).toThrow(ArtifactKindError);
    expect(() => createArtifactKindResolver(dup)).toThrow(/duplicate artifact kind/);
  });
});
