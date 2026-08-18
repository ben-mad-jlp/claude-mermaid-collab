// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// FIX: repair-forge surfaces spec-less bugfix filings with an aggregated card.
//
// runRepairForgePass now computes the unparseable ids list (filings whose spec
// readBugfixSpec could not recover) immediately after building the requests array
// and before selectRepairBatch. When unparseable.length > 0, a single aggregated
// escalation card is raised with kind: 'repair-request-specless', audience: 'human',
// operatorGated: true, conditionKey: 'repair-forge-specless' (fixed literal, no filing id,
// no count, no timestamp — so supervisor-store's keyed-lookup branch updates the single
// open row on a re-run instead of opening a second card). The unparseable ids are listed
// verbatim in the questionText.
//
// Hermetic: every test runs against a fresh mkdtemp project; no real .collab/*.db and no
// ~/.mermaid-collab access.
import { describe, test, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _closeProject,
  createTodo,
  getTodo,
  listTodos,
} from '../todo-store';
import {
  listMissions,
  _resetMissionDbCache,
} from '../mission-store';
import { ensureBucket } from '../bucket-registry';
import {
  buildRepairMissionSpec,
  type RepairBatchItem,
} from '../repair-mission-forge';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { runRepairForgePass, _resetRepairForgeThrottle, REPAIR_SPECLESS_KIND } from '../repair-mission-pass';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'repair-forge-specless-visibility-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('repair-forge specless visibility', () => {
  it('spec-less filings are named in the forge outcome', async () => {
    _resetRepairForgeThrottle(project);
    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed 5 bugfix leaves where indices 1 and 3 are spec-less (no bugfixSpec, no Failure: in description).
    const leafIds: string[] = [];
    const speclessIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const isSpecless = i === 1 || i === 3;
      const leaf = await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix ${i + 1}`,
        parentId: bucketId,
        description: isSpecless ? `Just a plain description without spec markers` : null,
        bugfixSpec: isSpecless ? null : {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans: `Fixed means criterion ${i + 1}`,
        },
      });
      leafIds.push(leaf.id);
      if (isSpecless) speclessIds.push(leaf.id);
    }

    // Capture escalations created during the pass.
    const capturedEscalations: any[] = [];
    const captureFn = (input: any) => {
      capturedEscalations.push(input);
      return { escalation: {} as any, isNew: true };
    };

    // Run the pass.
    const result = await runRepairForgePass(project, {
      threshold: 5,
      forge: forgeMission,
      createEscalation: captureFn,
    });

    // Verify unparseable list contains exactly the 2 spec-less ids.
    expect(result.unparseable.length).toBe(2);
    for (const speclessId of speclessIds) {
      expect(result.unparseable).toContain(speclessId);
    }

    // Verify well-specced ids are NOT in unparseable.
    for (const leafId of leafIds) {
      if (!speclessIds.includes(leafId)) {
        expect(result.unparseable).not.toContain(leafId);
      }
    }
  });

  it('an aggregated card lists the unparseable filing ids', async () => {
    _resetRepairForgeThrottle(project);
    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed 2 spec-less filings plus 3 well-specced ones (enough to trigger the batch at k=5).
    const speclessLeafIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const isSpecless = i === 0 || i === 2;
      const leaf = await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix ${i + 1}`,
        parentId: bucketId,
        description: isSpecless ? `Plain description, no spec` : null,
        bugfixSpec: isSpecless ? null : {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans: `Fixed means criterion ${i + 1}`,
        },
      });
      if (isSpecless) speclessLeafIds.push(leaf.id);
    }

    // First pass: capture escalations.
    const capturedEscalations: any[] = [];
    const captureFn = (input: any) => {
      capturedEscalations.push(input);
      return { escalation: {} as any, isNew: true };
    };

    const result1 = await runRepairForgePass(project, {
      threshold: 5,
      forge: forgeMission,
      createEscalation: captureFn,
    });

    // Verify exactly one REPAIR_SPECLESS_KIND escalation was created.
    const speclessEscalations = capturedEscalations.filter(
      (esc) => esc.kind === REPAIR_SPECLESS_KIND
    );
    expect(speclessEscalations.length).toBe(1);

    // Verify the escalation has the correct attributes.
    const speclessEsc = speclessEscalations[0];
    expect(speclessEsc.audience).toBe('human');
    expect(speclessEsc.operatorGated).toBe(true);
    expect(speclessEsc.conditionKey).toBe('repair-forge-specless');
    expect(speclessEsc.questionText).toContain(speclessLeafIds[0]);
    expect(speclessEsc.questionText).toContain(speclessLeafIds[1]);
    // Verify no todoId is passed (no single owning filing).
    expect(speclessEsc.todoId).toBeUndefined();

    // Second pass: verify re-run updates the same card (same conditionKey).
    _resetRepairForgeThrottle(project);
    capturedEscalations.length = 0; // Clear captured escalations.

    const result2 = await runRepairForgePass(project, {
      threshold: 5,
      forge: forgeMission,
      createEscalation: captureFn,
    });

    // Verify the set of conditionKey values across all REPAIR_SPECLESS_KIND captures is exactly {'repair-forge-specless'}.
    const speclessEscalations2 = capturedEscalations.filter(
      (esc) => esc.kind === REPAIR_SPECLESS_KIND
    );
    const conditionKeys = new Set(speclessEscalations2.map((esc) => esc.conditionKey));
    expect(conditionKeys).toEqual(new Set(['repair-forge-specless']));
  });
});
