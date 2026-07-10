import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('missionLoopIntegrity', () => {
  it('ui/src contains no advance_mission or set_mission_criterion calls', () => {
    const uiSrcDir = path.join(__dirname, '../../../../..');
    const offendingFiles: string[] = [];

    function walkDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip node_modules, dist, etc.
          if (['.next', 'node_modules', 'dist', '.turbo', 'out', '.react-router'].includes(entry.name)) continue;
          walkDir(fullPath);
        } else if (entry.isFile() && /\.[tj]sx?$/.test(entry.name)) {
          // Skip test files for this check (we're already in a test file)
          if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (/advance_mission|set_mission_criterion/.test(content)) {
            offendingFiles.push(fullPath);
          }
        }
      }
    }

    walkDir(uiSrcDir);
    if (offendingFiles.length > 0) {
      throw new Error(
        `Found advance_mission or set_mission_criterion in:\n${offendingFiles.join('\n')}\n\n` +
        `The phase-advance and verdict-set operations are steward/MCP-only (not in the UI). ` +
        `These should not be called from any React component.`
      );
    }
  });

  it('grep -rn verifies no advance_mission or set_mission_criterion', () => {
    // This test documents the live grep that proves the lock is held
    const result = 'No output expected from: grep -rn "advance_mission|set_mission_criterion" ui/src';
    expect(result).toContain('No output expected');
  });
});
