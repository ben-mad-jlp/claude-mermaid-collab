import { describe, it, expect } from 'bun:test';
import path from 'node:path';
import {
  renderAuditReport,
  loadSrcCorpus,
  type AuditCorpus,
} from '../single-producer-audit';

const repoRoot = path.resolve(import.meta.dir, '../../..');

// Synthetic corpus — keys inserted in non-alphabetical order so any accidental
// reliance on Map insertion order (rather than the internal sort each detector
// performs) would surface as a test failure.
const synthetic: AuditCorpus = new Map<string, string>([
  [
    'src/services/zeta-close.ts',
    `export function closeContainer(id: string): void {
  db.exec("UPDATE todos SET status='done', acceptanceStatus='accepted' WHERE id = ?", [id]);
}
`,
  ],
  [
    'src/services/alpha-landed.ts',
    `export function checkEpicDone(epic: Epic): boolean {
  return epic.landedAt !== null;
}
`,
  ],
  [
    'src/services/mid-terminal.ts',
    `function deriveMissionTerminalPrefix(mission: Mission): string {
  if (mission.state === 'open') return 'open';
  if (mission.result === 'succeeded') return 'closed';
  if (mission.result === 'abandoned') return 'abandoned';
  return 'unapproved';
}
`,
  ],
  [
    'src/services/beta-capture.ts',
    `export function captureLandCycleFields(cycle: Cycle): Record<string, any> {
  return { started: cycle.start, ended: cycle.end };
}
`,
  ],
]);

describe('renderAuditReport determinism', () => {
  it('renderAuditReport is byte-identical across 3 consecutive runs over a synthetic corpus', () => {
    const r1 = renderAuditReport(synthetic);
    const r2 = renderAuditReport(synthetic);
    const r3 = renderAuditReport(synthetic);

    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect(r1.length).toBeGreaterThan(0);
  });

  it('renderAuditReport is byte-identical across 3 consecutive runs over the loaded src corpus', () => {
    const r1 = renderAuditReport(loadSrcCorpus(repoRoot));
    const r2 = renderAuditReport(loadSrcCorpus(repoRoot));
    const r3 = renderAuditReport(loadSrcCorpus(repoRoot));

    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it('renderAuditReport output is insensitive to corpus insertion order', () => {
    const reversed: AuditCorpus = new Map([...synthetic.entries()].reverse());

    expect(renderAuditReport(synthetic)).toBe(renderAuditReport(reversed));
  });

  it('renderAuditReport emits one Count line per concept section', () => {
    const report = renderAuditReport(synthetic);

    expect(report).toContain('## Landedness Producers');
    expect(report).toContain('## Terminal Prefix Producers');
    expect(report).toContain('## Container Close Producers');
    expect(report).toContain('## Land Record Capture Producers');

    const countLines = report.split('\n').filter((l) => l.startsWith('Count: '));
    expect(countLines.length).toBe(4);
  });
});
