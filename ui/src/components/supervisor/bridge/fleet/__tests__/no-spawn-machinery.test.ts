import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import fg from 'fast-glob';

describe('spawn machinery removed', () => {
  it('no file under ui/src references source === \'spawn\' or source==="spawn"', async () => {
    const uiSrcDir = join(__dirname, '../../../../..');
    const testFile = join(__dirname, 'no-spawn-machinery.test.ts');
    const files = await fg(['**/*.{ts,tsx,js,jsx}'], {
      cwd: uiSrcDir,
      absolute: true,
    });

    const spawned: string[] = [];
    for (const path of files) {
      // Skip this test file itself to avoid self-reference in the pattern
      if (path === testFile) continue;

      try {
        const content = await readFile(path, 'utf-8');
        if (/source\s*===\s*['"]spawn['"]/.test(content)) {
          spawned.push(path.replace(uiSrcDir, ''));
        }
      } catch {
        // Skip files that can't be read
      }
    }

    expect(spawned, `Expected no files with source === 'spawn', but found: ${spawned.join(', ')}`).toHaveLength(0);
  });

  it('SupervisedSessions.tsx does not exist', () => {
    const filepath = join(__dirname, '../../SupervisedSessions.tsx');
    expect(existsSync(filepath), `SupervisedSessions.tsx should not exist at ${filepath}`).toBe(false);
  });
});
