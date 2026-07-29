import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Scan production source files for `routedTo` references.
 *
 * routedTo on the live Escalation type is retired (epic drop-routedTo).
 * This test ensures no new references to the dead field creep back in.
 * The historical read-model EscalationHistoryRow.routedTo is explicitly
 * allowed (historical-display-only); epicHistory.ts is excluded.
 */
describe('routedToRetired', () => {
  it('no live routedTo references exist in production code', () => {
    const uiSrcDir = path.join(__dirname, '..');
    const offenders: string[] = [];

    // Allowlist: files where routedTo may appear in comments or code (non-live usage)
    const allowlist = [
      'escalationLifecycle.ts', // module header mentions the problem being fixed
      'components/supervisor/bridge/BridgeEscalationInbox.tsx', // comment only
    ];

    // Recursively walk all .ts/.tsx files under ui/src, excluding test files and epicHistory.ts
    function walkDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip node_modules, dist, and hidden directories
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }

        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if ((entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
          // Explicitly exclude epicHistory.ts (historical read-model, allowed)
          if (entry.name === 'epicHistory.ts') {
            continue;
          }

          const relPath = path.relative(uiSrcDir, fullPath);
          // Check if this file is in the allowlist
          const isAllowed = allowlist.some((pattern) => relPath.endsWith(pattern));
          if (isAllowed) {
            continue;
          }

          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Strip single-line comments to check only code
            const codeBeforeComment = line.split('//')[0];
            if (codeBeforeComment.includes('routedTo')) {
              offenders.push(`${relPath}:${i + 1}`);
            }
          }
        }
      }
    }

    walkDir(uiSrcDir);

    if (offenders.length > 0) {
      console.log('Found routedTo references in production code:', offenders);
    }
    expect(offenders).toHaveLength(0);
  });
});
