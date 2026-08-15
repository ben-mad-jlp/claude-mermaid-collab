import { describe, it, expect } from 'bun:test';
import { attributeFloorFailures } from '../epic-land-gate';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('attributeFloorFailures', () => {
  it('answers trunk-red with the file list when every floor failure reproduces at the merge-base', () => {
    const result = attributeFloorFailures({
      command: 'bun test',
      failing: ['(218/501) src/foo.test.ts', '(219/501) src/bar.test.ts'],
      regressed: [],
      inherited: ['(218/501) src/foo.test.ts', '(219/501) src/bar.test.ts'],
    });

    expect(result.verdict).toBe('trunk-red');
    expect(result.files).toEqual(['src/bar.test.ts', 'src/foo.test.ts']); // sorted
  });

  it('answers gate-regression naming only the newly failing file', () => {
    const result = attributeFloorFailures({
      command: 'bun test',
      failing: [
        '(218/501) src/foo.test.ts',
        '(219/501) src/bar.test.ts',
        '(220/501) src/new.test.ts',
      ],
      regressed: ['(220/501) src/new.test.ts'],
      inherited: ['(218/501) src/foo.test.ts', '(219/501) src/bar.test.ts'],
    });

    expect(result.verdict).toBe('gate-regression');
    expect(result.files).toEqual(['src/new.test.ts']);
  });

  it('wiring: attributeFloorFailures is called in the floor-fail branch', () => {
    // Read the source file and verify the function is called within the floor?.status === 'fail' branch
    const sourceFile = join(import.meta.dir, '..', 'epic-land-gate.ts');
    const content = readFileSync(sourceFile, 'utf-8');

    // Verify attributeFloorFailures appears in the file
    expect(content).toContain('attributeFloorFailures');

    // Verify it's called within the conditional block by checking the context
    const floorFailBlock = content.match(/if \(floor\?\.status === 'fail'\)[\s\S]*?^  \}/m);
    expect(floorFailBlock).toBeDefined();
    expect(floorFailBlock?.[0]).toContain('attributeFloorFailures');
  });
});
