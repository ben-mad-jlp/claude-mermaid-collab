import { describe, it, expect } from 'bun:test';
import {
  findLandednessProducers,
  findTerminalPrefixProducers,
  findContainerCloseProducers,
  findLandRecordCaptureProducers,
  type AuditCorpus,
} from '../single-producer-audit';

// Landedness Producers Fixtures

const landednessClean: AuditCorpus = new Map<string, string>([
  [
    'src/fake/clean-landedness.ts',
    `export function checkEpicDone(epic: Epic): boolean {
  return epic.landedAt !== null;
}
`,
  ],
]);

const landednessDup: AuditCorpus = new Map<string, string>([
  [
    'src/fake/clean-landedness.ts',
    `export function checkEpicDone(epic: Epic): boolean {
  return epic.landedAt !== null;
}
`,
  ],
  [
    'src/fake/duplicate-producer.ts',
    `export function isDone(item: Item): boolean {
  return item.landedAt !== null;
}
`,
  ],
]);

const landednessNegative: AuditCorpus = new Map<string, string>([
  [
    'src/fake/negative-landedness.ts',
    `export function checkStatus(epic: Epic): boolean {
  return epic.status === 'done';
}
`,
  ],
]);

// Terminal Prefix Producers Fixtures

const terminalPrefixClean: AuditCorpus = new Map<string, string>([
  [
    'src/fake/clean-terminal-prefix.ts',
    `function deriveMissionTerminalPrefix(mission: Mission): string {
  if (mission.state === 'open') return 'open';
  if (mission.result === 'succeeded') return 'closed';
  if (mission.result === 'abandoned') return 'abandoned';
  return 'unapproved';
}
`,
  ],
]);

const terminalPrefixDup: AuditCorpus = new Map<string, string>([
  [
    'src/fake/clean-terminal-prefix.ts',
    `function deriveMissionTerminalPrefix(mission: Mission): string {
  if (mission.state === 'open') return 'open';
  if (mission.result === 'succeeded') return 'closed';
  if (mission.result === 'abandoned') return 'abandoned';
  return 'unapproved';
}
`,
  ],
  [
    'src/fake/duplicate-producer.ts',
    `function getMissionTerminalStatus(mission: Mission): string {
  if (!mission.active) return 'closed';
  if (mission.abandoned) return 'abandoned';
  if (!mission.approved) return 'unapproved';
  return 'pending';
}
`,
  ],
]);

const terminalPrefixNegative: AuditCorpus = new Map<string, string>([
  [
    'src/fake/negative-terminal-prefix.ts',
    `function isMissionTerminal(mission: Mission): boolean {
  return mission.status === 'closed' || mission.status === 'abandoned';
}
function partialTerminal(mission: Mission): string {
  if (mission.done) return 'closed';
  return 'pending';
}
`,
  ],
]);

// Container Close Producers Fixtures

const containerCloseClean: AuditCorpus = new Map<string, string>([
  [
    'src/fake/clean-container-close.ts',
    `export function closeContainer(id: string): void {
  db.exec("UPDATE todos SET status='done', acceptanceStatus='accepted' WHERE id = ?", [id]);
}
`,
  ],
]);

const containerCloseDup: AuditCorpus = new Map<string, string>([
  [
    'src/fake/clean-container-close.ts',
    `export function closeContainer(id: string): void {
  db.exec("UPDATE todos SET status='done', acceptanceStatus='accepted' WHERE id = ?", [id]);
}
`,
  ],
  [
    'src/fake/duplicate-producer.ts',
    `export function markDone(id: string): void {
  query("UPDATE todos SET status='done' AND acceptanceStatus='accepted'");
}
`,
  ],
]);

const containerCloseNegative: AuditCorpus = new Map<string, string>([
  [
    'src/fake/negative-container-close.ts',
    `// UPDATE todos SET status='done', acceptanceStatus='accepted' WHERE archive
export function notMatching(): void {
  db.exec("UPDATE todos SET status='done' WHERE id = 1");
}
`,
  ],
]);

// Land Record Capture Producers Fixtures

const landRecordClean: AuditCorpus = new Map<string, string>([
  [
    'src/fake/clean-land-record.ts',
    `export function captureLandCycleFields(cycle: Cycle): Record<string, any> {
  return { started: cycle.start, ended: cycle.end };
}
`,
  ],
]);

const landRecordDup: AuditCorpus = new Map<string, string>([
  [
    'src/fake/clean-land-record.ts',
    `export function captureLandCycleFields(cycle: Cycle): Record<string, any> {
  return { started: cycle.start, ended: cycle.end };
}
`,
  ],
  [
    'src/fake/duplicate-producer.ts',
    `export async function captureLandCycleFields(cycle: Cycle): Promise<Fields> {
  return await persistCycle(cycle);
}
`,
  ],
]);

const landRecordNegative: AuditCorpus = new Map<string, string>([
  [
    'src/fake/negative-land-record.ts',
    `function captureLandCycleFields(cycle: Cycle): Record<string, any> {
  return { started: cycle.start };
}
export function recordLandEvent(event: Event): void {
  logEvent(event);
}
`,
  ],
]);

describe('single-producer-audit sensitivity tests', () => {
  it('landedness detector: duplicate corpus yields strictly more hits than clean corpus', () => {
    const cleanHits = findLandednessProducers(landednessClean).hits;
    const dupHits = findLandednessProducers(landednessDup).hits;

    expect(dupHits.length).toBeGreaterThan(cleanHits.length);
    expect(dupHits.map((h) => h.file)).toContain('src/fake/duplicate-producer.ts');
  });

  it('terminal prefix detector: duplicate corpus yields strictly more hits than clean corpus', () => {
    const cleanHits = findTerminalPrefixProducers(terminalPrefixClean).hits;
    const dupHits = findTerminalPrefixProducers(terminalPrefixDup).hits;

    expect(dupHits.length).toBeGreaterThan(cleanHits.length);
    expect(dupHits.map((h) => h.file)).toContain('src/fake/duplicate-producer.ts');
  });

  it('container close detector: duplicate corpus yields strictly more hits than clean corpus', () => {
    const cleanHits = findContainerCloseProducers(containerCloseClean).hits;
    const dupHits = findContainerCloseProducers(containerCloseDup).hits;

    expect(dupHits.length).toBeGreaterThan(cleanHits.length);
    expect(dupHits.map((h) => h.file)).toContain('src/fake/duplicate-producer.ts');
  });

  it('land record capture detector: duplicate corpus yields strictly more hits than clean corpus', () => {
    const cleanHits = findLandRecordCaptureProducers(landRecordClean).hits;
    const dupHits = findLandRecordCaptureProducers(landRecordDup).hits;

    expect(dupHits.length).toBeGreaterThan(cleanHits.length);
    expect(dupHits.map((h) => h.file)).toContain('src/fake/duplicate-producer.ts');
  });

  it('clean corpora expose exactly one producer per detector', () => {
    expect(findLandednessProducers(landednessClean).hits.length).toBe(1);
    expect(findTerminalPrefixProducers(terminalPrefixClean).hits.length).toBe(1);
    expect(findContainerCloseProducers(containerCloseClean).hits.length).toBe(1);
    expect(findLandRecordCaptureProducers(landRecordClean).hits.length).toBe(1);
  });

  it('look-alike fixtures expose zero producers per detector', () => {
    expect(findLandednessProducers(landednessNegative).hits.length).toBe(0);
    expect(findTerminalPrefixProducers(terminalPrefixNegative).hits.length).toBe(0);
    expect(findContainerCloseProducers(containerCloseNegative).hits.length).toBe(0);
    expect(findLandRecordCaptureProducers(landRecordNegative).hits.length).toBe(0);
  });

  it('duplicate hits are returned in sorted file:line order', () => {
    const landednessSorted = findLandednessProducers(landednessDup).hits.map(
      (h) => `${h.file}:${h.line}`
    );
    expect(landednessSorted).toEqual(landednessSorted.slice().sort());

    const terminalSorted = findTerminalPrefixProducers(terminalPrefixDup).hits.map(
      (h) => `${h.file}:${h.line}`
    );
    expect(terminalSorted).toEqual(terminalSorted.slice().sort());

    const containerSorted = findContainerCloseProducers(containerCloseDup).hits.map(
      (h) => `${h.file}:${h.line}`
    );
    expect(containerSorted).toEqual(containerSorted.slice().sort());

    const landRecordSorted = findLandRecordCaptureProducers(landRecordDup).hits.map(
      (h) => `${h.file}:${h.line}`
    );
    expect(landRecordSorted).toEqual(landRecordSorted.slice().sort());
  });
});
