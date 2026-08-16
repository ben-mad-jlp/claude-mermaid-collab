import { describe, it, expect } from 'bun:test';
import path from 'path';
import { restrictToRequestedFiles } from '../test-backend';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const abs = (p: string) => path.join(ROOT, p);

describe('restrictToRequestedFiles (--files=)', () => {
  const partition = {
    fast: [abs('src/services/a.test.ts'), abs('src/services/b.test.ts')],
    serial: [abs('src/services/serial.test.ts')],
    nested: [abs('src/services/nested.test.ts')],
  };

  it('keeps only requested files, preserving lane classification', () => {
    const r = restrictToRequestedFiles(partition, ['src/services/a.test.ts', 'src/services/serial.test.ts']);
    expect(r.fast).toEqual([abs('src/services/a.test.ts')]);
    expect(r.serial).toEqual([abs('src/services/serial.test.ts')]);
    expect(r.nested).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it('accepts absolute paths', () => {
    const r = restrictToRequestedFiles(partition, [abs('src/services/nested.test.ts')]);
    expect(r.nested).toEqual([abs('src/services/nested.test.ts')]);
    expect(r.fast).toEqual([]);
  });

  it('reports requested files that are not collected candidates as missing', () => {
    const r = restrictToRequestedFiles(partition, ['src/services/a.test.ts', 'src/services/typo.test.ts']);
    expect(r.fast).toEqual([abs('src/services/a.test.ts')]);
    expect(r.missing).toEqual(['src/services/typo.test.ts']);
  });
});
