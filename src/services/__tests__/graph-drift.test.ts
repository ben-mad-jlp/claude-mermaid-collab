import { describe, it, expect } from 'bun:test';
import { detectGraphDrift, extractImportSpecifiers, resolveImport, type DriftNode } from '../graph-drift';

const nodes: DriftNode[] = [
  { id: 'A', title: 'route', dependsOn: [], files: ['src/routes/api.ts'] },
  { id: 'B', title: 'service', dependsOn: [], files: ['src/services/foo.ts'] },
  { id: 'C', title: 'helper', dependsOn: [], files: ['src/util/x.ts'] },
];

describe('detectGraphDrift', () => {
  it('flags a missing dependency when code crosses todos without dependsOn', () => {
    const f = detectGraphDrift(nodes, [{ fromFile: 'src/routes/api.ts', toFile: 'src/services/foo.ts' }]);
    expect(f.length).toBe(1);
    expect(f[0]).toMatchObject({ kind: 'missing-dependency', fromTodo: 'A', toTodo: 'B' });
  });

  it('no finding when the dependsOn already covers it', () => {
    const withDep = nodes.map((n) => (n.id === 'A' ? { ...n, dependsOn: ['B'] } : n));
    expect(detectGraphDrift(withDep, [{ fromFile: 'src/routes/api.ts', toFile: 'src/services/foo.ts' }])).toEqual([]);
  });

  it('respects TRANSITIVE dependsOn (A→C→B covers A importing B)', () => {
    const ns = [
      { id: 'A', dependsOn: ['C'], files: ['a.ts'] },
      { id: 'B', dependsOn: [], files: ['b.ts'] },
      { id: 'C', dependsOn: ['B'], files: ['c.ts'] },
    ];
    expect(detectGraphDrift(ns, [{ fromFile: 'a.ts', toFile: 'b.ts' }])).toEqual([]);
  });

  it('ignores imports within the same todo', () => {
    const ns = [{ id: 'A', dependsOn: [], files: ['a1.ts', 'a2.ts'] }];
    expect(detectGraphDrift(ns, [{ fromFile: 'a1.ts', toFile: 'a2.ts' }])).toEqual([]);
  });

  it('dedupes multiple edges between the same todo pair', () => {
    const ns = [
      { id: 'A', dependsOn: [], files: ['a.ts', 'a2.ts'] },
      { id: 'B', dependsOn: [], files: ['b.ts', 'b2.ts'] },
    ];
    const f = detectGraphDrift(ns, [
      { fromFile: 'a.ts', toFile: 'b.ts' },
      { fromFile: 'a2.ts', toFile: 'b2.ts' },
    ]);
    expect(f.length).toBe(1);
  });

  it('ignores edges to/from files not owned by any todo', () => {
    expect(detectGraphDrift(nodes, [{ fromFile: 'src/routes/api.ts', toFile: 'node_modules/x.ts' }])).toEqual([]);
  });
});

describe('extractImportSpecifiers', () => {
  it('pulls import / export-from / require specifiers', () => {
    const src = `import a from './a';\nimport { b } from "../b";\nexport { c } from './c';\nconst d = require('./d');\nimport './side';`;
    expect(extractImportSpecifiers(src).sort()).toEqual(['../b', './a', './c', './d', './side'].sort());
  });
});

describe('resolveImport', () => {
  const known = new Set(['src/services/foo.ts', 'src/util/index.ts', 'src/x.tsx']);
  it('resolves a relative import with extension inference', () => {
    expect(resolveImport('src/routes/api.ts', '../services/foo', known)).toBe('src/services/foo.ts');
  });
  it('resolves a directory index import', () => {
    expect(resolveImport('src/routes/api.ts', '../util', known)).toBe('src/util/index.ts');
  });
  it('resolves .tsx', () => {
    expect(resolveImport('src/routes/api.ts', '../x', known)).toBe('src/x.tsx');
  });
  it('returns null for package/alias specifiers', () => {
    expect(resolveImport('src/routes/api.ts', 'react', known)).toBeNull();
    expect(resolveImport('src/routes/api.ts', '@/foo', known)).toBeNull();
  });
  it('returns null when nothing matches', () => {
    expect(resolveImport('src/routes/api.ts', './nope', known)).toBeNull();
  });
});
