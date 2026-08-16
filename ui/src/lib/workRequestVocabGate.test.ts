import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export interface AllowlistEntry {
  file: string;
  allowed: RegExp;
  reason: string;
}

export const ESCALATION_DOMAIN_ALLOWLIST: AllowlistEntry[] = [
  { file: 'stores/supervisorStore.ts', allowed: /triageInFlight/, reason: 'Escalation lifecycle triage state field' },
  { file: 'stores/notificationStore.ts', allowed: /triageRank|compareTriage/, reason: 'Escalation triage ranking and comparison' },
  { file: 'lib/escalationLifecycle.ts', allowed: /triageInFlight/, reason: 'Escalation triage lifecycle management' },
  { file: 'lib/escalationLifecycle.test.ts', allowed: /triageInFlight|untriaged/, reason: 'Escalation triage tests' },
  { file: 'lib/statusSelectors.ts', allowed: /triageInFlight/, reason: 'Escalation status and triage state selector' },
  { file: 'lib/statusSelectors.test.ts', allowed: /epic-sweep-triage|withTriage|triageInFlight/, reason: 'Escalation triage status selector tests' },
  { file: 'lib/epicHistory.ts', allowed: /triageInFlight/, reason: 'Historical escalation triage state' },
  { file: 'lib/epicHistory.test.ts', allowed: /triage/, reason: 'Escalation history triage tests' },
  { file: 'lib/claimability.ts', allowed: /triage/, reason: 'Escalation triage in claimability doc comments' },
  { file: 'components/supervisor/bridge/escalationSelectors.ts', allowed: /triage/, reason: 'Escalation triage selector doc comment' },
  { file: 'components/supervisor/bridge/BridgeEscalationInbox.tsx', allowed: /TriageLifecycleBadge|triage-lifecycle-badge|AI triage consult|tried to triage/, reason: 'Escalation triage lifecycle badge component' },
  { file: 'components/supervisor/bridge/RequirementCard.tsx', allowed: /triage/, reason: 'Requirement card triage doc comment' },
  { file: 'components/supervisor/bridge/UsagePanel.tsx', allowed: /triage/, reason: 'Usage panel triage doc comment' },
  { file: 'components/supervisor/bridge/EpicHistoryView.tsx', allowed: /triage/, reason: 'Epic history view triage doc comment' },
  { file: 'components/supervisor/bridge/NeedsYouZone.test.tsx', allowed: /epic-sweep-triage/, reason: 'Escalation triage sweep tests' },
  { file: 'components/supervisor/bridge/__tests__/escalationHumanActionable.test.ts', allowed: /epic-sweep-triage|hygiene_epic_sweep_triage|triageInFlight/, reason: 'Escalation human-actionable triage tests' },
  { file: 'components/supervisor/bridge/fleet/FleetGraphDangerRing.test.tsx', allowed: /epic-sweep-triage/, reason: 'Fleet danger ring escalation triage tests' },
  { file: 'components/settings/TieringEditor.tsx', allowed: /'triage'/, reason: 'Worker phase triage configuration' },
  { file: 'components/settings/JudgmentLLMEditor.tsx', allowed: /triage/, reason: 'LLM judgment for escalation triage' },
];

describe('workRequestVocabGate', () => {
  it('VOCABULARY.md uses the canonical term work request at least three times', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const vocabPath = path.resolve(dir, '../../../docs/VOCABULARY.md');
    const content = fs.readFileSync(vocabPath, 'utf-8');

    const matches = content.match(/work request/gi);
    const count = matches ? matches.length : 0;

    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('VOCABULARY.md confines triage to the retired-terms denylist row', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const vocabPath = path.resolve(dir, '../../../docs/VOCABULARY.md');
    const content = fs.readFileSync(vocabPath, 'utf-8');

    const lines = content.split('\n');
    const triageLines: { index: number; line: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (/triage/i.test(lines[i])) {
        triageLines.push({ index: i, line: lines[i] });
      }
    }

    expect(triageLines).toHaveLength(1);
    expect(triageLines[0].line).toMatch(/^\s*\|\s*"triage"\s*\(as a work-request surface\)/);
  });

  it('no user-facing triage remains in ui/src outside the escalation-triage allowlist', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const uiSrcDir = path.resolve(dir, '..');
    const offenders: string[] = [];

    function walkDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }

        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          // Skip the gate file itself
          if (entry.name === 'workRequestVocabGate.test.ts') {
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

            if (/triage/i.test(codeOnly)) {
              // Check if this line matches an allowlist entry
              const normalizedPath = relPath.split(path.sep).join('/');
              const allowlistEntry = ESCALATION_DOMAIN_ALLOWLIST.find((e) => e.file === normalizedPath);

              if (!allowlistEntry || !allowlistEntry.allowed.test(line)) {
                offenders.push(`${relPath}:${i + 1}`);
              }
            }
          }
        }
      }
    }

    walkDir(uiSrcDir);

    if (offenders.length > 0) {
      console.log('Found triage references outside allowlist:', offenders);
    }
    expect(offenders).toEqual([]);
  });

  it('every allowlist entry still exists and still has a matching hit', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const uiSrcDir = path.resolve(dir, '..');

    for (const entry of ESCALATION_DOMAIN_ALLOWLIST) {
      const fullPath = path.join(uiSrcDir, entry.file);
      expect(fs.existsSync(fullPath)).toBe(true);

      const content = fs.readFileSync(fullPath, 'utf-8');
      expect(entry.allowed.test(content)).toBe(true);
    }
  });

  it('work-request surfaces are absent from the allowlist and contain zero triage hits', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const uiSrcDir = path.resolve(dir, '..');

    const workRequestSurfaces = [
      'components/supervisor/PlanKanban.tsx',
      'components/supervisor/PlanKanban.test.tsx',
      'components/supervisor/__tests__/PlanKanban.kind.test.tsx',
      'lib/workRequestRegistry.ts',
      'lib/attentionSelectors.ts',
    ];

    for (const surface of workRequestSurfaces) {
      // Ensure it's not in the allowlist
      const inAllowlist = ESCALATION_DOMAIN_ALLOWLIST.some((e) => e.file === surface);
      expect(inAllowlist).toBe(false);

      // Ensure the file contains zero triage hits
      const fullPath = path.join(uiSrcDir, surface);
      const content = fs.readFileSync(fullPath, 'utf-8');
      expect(/triage/i.test(content)).toBe(false);
    }
  });
});
