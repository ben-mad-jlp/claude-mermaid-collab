// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openPassRow,
  finalizePassRow,
  listConductorPasses,
  _closeConductorJournalDb,
} from '../conductor-pass-journal';
import { formatConductorPass } from '../conductor-pass-format';
import { CONDUCTOR_NODE_TIMEOUT_MS } from '../harness-caps';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'conductor-pass-format-live-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeConductorJournalDb();
});
afterEach(() => {
  _closeConductorJournalDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const PROJECT = '/proj-format-live';
const MISSION_ID = 'm-format-live';

describe('conductor-pass-format live store', () => {
  test("every finalized live-store row's sentence names its arm", () => {
    const arms = ['node', 'none', 'verify-panel', 'infra', 'node'] as const;
    let t = 1000;
    for (const arm of arms) {
      const started = t++;
      const ended = t++;
      const id = openPassRow(PROJECT, MISSION_ID, started);
      expect(id).not.toBeNull();
      const ok = finalizePassRow(id as string, { endedAt: ended, arm, outcome: 'x', ran: true });
      expect(ok).toBe(true);
    }
    // 6th row: unfinalized (no finalizePassRow call), stays endedAt: null, arm: null.
    const unfinishedId = openPassRow(PROJECT, MISSION_ID, t++);
    expect(unfinishedId).not.toBeNull();

    const rows = listConductorPasses(PROJECT, { missionId: MISSION_ID });

    expect(rows.length).toBeGreaterThanOrEqual(6);
    const finalized = rows.filter((r) => r.endedAt !== null);
    expect(finalized.length).toBeGreaterThanOrEqual(5);

    for (const row of rows) {
      const { sentence } = formatConductorPass(row);
      expect(sentence.length).toBeGreaterThan(0);
      expect(sentence.includes(row.missionId as string)).toBe(true);
    }

    for (const row of rows) {
      if (row.endedAt !== null && row.arm !== null) {
        expect(formatConductorPass(row).sentence.includes(row.arm)).toBe(true);
      }
    }

    const unfinishedRow = rows.find((r) => r.endedAt === null);
    expect(unfinishedRow).toBeDefined();
    // This row was opened moments ago and never finalized — i.e. a pass STILL RUNNING.
    // It must read as in-flight. Asserting 'killed (ran out of time)' here (as this test
    // used to) enshrined the bug: the formatter called every unfinished row a corpse, and
    // a live 3-minute pass on a converging mission got reported as a failure.
    const sentence = formatConductorPass(
      unfinishedRow!,
      unfinishedRow!.startedAt + 90_000, // 1.5 min in, far under the 20-minute node budget
    ).sentence;
    expect(sentence.length).toBeGreaterThan(0);
    expect(sentence).toContain('in flight');
    expect(sentence).not.toContain('killed');

    // Past the budget the same row IS a corpse, and the original wording is right.
    const aged = formatConductorPass(
      unfinishedRow!,
      unfinishedRow!.startedAt + CONDUCTOR_NODE_TIMEOUT_MS,
    ).sentence;
    expect(aged).toContain('killed (ran out of time)');
  });

  test('formatting every returned row leaves the store rows byte-identical', () => {
    let t = 2000;
    for (const arm of ['node', 'none', 'verify-panel', 'infra', 'node'] as const) {
      const id = openPassRow(PROJECT, MISSION_ID, t++);
      finalizePassRow(id as string, { endedAt: t++, arm, outcome: 'x', ran: true });
    }
    openPassRow(PROJECT, MISSION_ID, t++);

    const rows = listConductorPasses(PROJECT, { missionId: MISSION_ID });
    const beforeSnapshot = JSON.stringify(rows);

    rows.map(formatConductorPass);

    expect(JSON.stringify(rows)).toEqual(beforeSnapshot);

    const rows2 = listConductorPasses(PROJECT, { missionId: MISSION_ID });
    expect(rows2).toEqual(rows);
  });
});
