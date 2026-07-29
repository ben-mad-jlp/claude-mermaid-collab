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

          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          let inBlockComment = false;
          for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            if (inBlockComment) {
              const closeIdx = line.indexOf('*/');
              if (closeIdx === -1) {
                // Whole line is still inside the block comment.
                continue;
              }
              line = line.slice(closeIdx + 2);
              inBlockComment = false;
            }

            const lineCommentIdx = line.indexOf('//');
            const blockCommentIdx = line.indexOf('/*');

            let codeOnly: string;
            if (blockCommentIdx !== -1 && (lineCommentIdx === -1 || blockCommentIdx < lineCommentIdx)) {
              const before = line.slice(0, blockCommentIdx);
              const rest = line.slice(blockCommentIdx + 2);
              const closeIdx = rest.indexOf('*/');
              if (closeIdx !== -1) {
                codeOnly = before + rest.slice(closeIdx + 2);
              } else {
                codeOnly = before;
                inBlockComment = true;
              }
            } else if (lineCommentIdx !== -1) {
              codeOnly = line.slice(0, lineCommentIdx);
            } else {
              codeOnly = line;
            }

            if (codeOnly.includes('routedTo')) {
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
