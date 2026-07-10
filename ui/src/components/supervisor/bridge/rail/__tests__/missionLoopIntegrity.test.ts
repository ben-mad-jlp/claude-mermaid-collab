import { describe, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('missionLoopIntegrity', () => {
  const RULES: Array<{ name: string; test: (src: string) => boolean; why: string }> = [
    {
      name: 'tool-names',
      test: (src) => /\b(advance_mission|set_mission_criterion|set_mission_verdict|mission_verdict)\b/.test(src),
      why: 'advance_mission and set_mission_criterion are phase-advance and criterion-update operations; set_mission_verdict and mission_verdict are pre-emptively barred as verdict-setters (not yet in the API but would violate the lock if added).',
    },
    {
      name: 'criterionVerdict-identifier',
      test: (src) => /\bcriterionVerdict\b/.test(src),
      why: 'a store action or prop named criterionVerdict would be a verdict-setter by construction (distinct from reviewVerdict, a read-only field on leaf review display).',
    },
    {
      name: 'mission-route-plus-verdict-key',
      test: (src) => {
        const MISSION_MUTATION_ROUTE = /\/api\/supervisor\/missions\/(criteria|advance|phase|verdict)/;
        const VERDICT_KEY = /(^|[\s{,(])['"]?verdict['"]?\s*:/m;
        return MISSION_MUTATION_ROUTE.test(src) && VERDICT_KEY.test(src);
      },
      why: 'a file that both fetches a mission mutation route and carries a verdict key (e.g., { verdict: ... }) is crafting a verdict-bearing body to a criteria/advance endpoint. Excluded: supervisorStore.ts (verdict appears only in comment prose with no key form), VerdictBar.tsx and freshnessSelectors.ts (unrelated Zen freshness domain), missionShared.tsx (tooltip prose only), WorkerRunStrip.tsx (reviewVerdict is a read-only leaf verdict display field).',
    },
  ];

  it('ui/src sets no mission verdict and advances no mission phase', () => {
    const uiSrcDir = path.join(__dirname, '../../../../..');
    const offendingFiles: Array<{ file: string; rule: string }> = [];

    function walkDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip node_modules, dist, etc.
          if (['.next', 'node_modules', 'dist', '.turbo', 'out', '.react-router'].includes(entry.name)) continue;
          walkDir(fullPath);
        } else if (entry.isFile() && /\.[tj]sx?$/.test(entry.name)) {
          // Test files are exempt: the lock is on shipped component code, and a test that asserts
          // these tools are absent must name them. Excluding *.test.ts(x) keeps such tests from
          // self-reporting as violations. A call site inside a test file cannot reach a user.
          if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
          const content = fs.readFileSync(fullPath, 'utf-8');
          for (const rule of RULES) {
            if (rule.test(content)) {
              offendingFiles.push({ file: fullPath, rule: rule.name });
              break;
            }
          }
        }
      }
    }

    walkDir(uiSrcDir);
    if (offendingFiles.length > 0) {
      const violations = offendingFiles.map(({ file, rule }) => `${file} (rule: ${rule})`).join('\n');
      throw new Error(
        `Found mission verdict or phase-advance violations:\n${violations}\n\n` +
        `The phase-advance and verdict-set operations are steward/MCP-only (not in the UI). ` +
        `These should not be called from any React component.`
      );
    }
  });
});
