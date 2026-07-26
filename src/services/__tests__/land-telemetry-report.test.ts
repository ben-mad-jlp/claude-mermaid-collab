import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-land-telemetry-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { recordEpicLand } from '../epic-land-record-store';
import { createEscalation, _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { reportLandCycles, MAIN_CHECKOUT_ESCALATION_KIND } from '../land-telemetry-report';
import type { Todo } from '../todo-store';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

// realpathSync'd so trackingProjectRoot / any macOS /private-prefixed normalization
// cannot make the seeded (recordEpicLand) and queried (createEscalation) project
// strings diverge.
const projectDir = mkdtempSync(join(tmpdir(), 'land-telemetry-proj-'));
const project = realpathSync(projectDir);

function makeTodo(overrides: Partial<Todo>): Todo {
  return {
    id: 'x', ownerSession: 's', assigneeSession: null, assigneeKind: 'agent',
    title: 't', description: null, status: 'ready', completed: false,
    priority: null, dueDate: null, parentId: null, dependsOn: [], order: 0,
    link: null, createdAt: '', updatedAt: '', completedAt: null, asanaGid: null,
    sessionName: null, executedBySession: null, blueprintId: null, type: null,
    acceptanceStatus: null, kind: 'leaf', servesCriterionId: null, servesCriterionIds: [],
    ...overrides,
  } as Todo;
}

describe('reportLandCycles — windowed land telemetry', () => {
  it('reports in-window cycles, per-cycle verdicts, counts, and escalation count', async () => {
    const t0 = Date.now();
    // Out-of-window: landedAt before the window.
    recordEpicLand(project, {
      epicId: 'epic-outside-cccccccccccccccccccccccccccccc',
      epicTipSha: 'sha-tip-3',
      landedMergeSha: 'sha-merge-3',
      landedAt: t0 - 1_000_000,
    });

    // Two in-window epics: one clean+no-open-work, one dirty+with a serving leaf.
    recordEpicLand(project, {
      epicId: 'epic-clean-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      epicTipSha: 'sha-tip-1',
      landedMergeSha: 'sha-merge-1',
      landedAt: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 5));
    recordEpicLand(project, {
      epicId: 'epic-dirty-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      epicTipSha: 'sha-fallback',
      landedMergeSha: 'sha-fallback',
      landedAt: Date.now(),
    });

    const todos: Todo[] = [
      makeTodo({ id: 'epic-clean-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', kind: 'epic' as Todo['kind'], parentId: null }),
      makeTodo({
        id: 'leaf-accepted-1', parentId: 'epic-clean-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: 'done', acceptanceStatus: 'accepted',
      }),
      makeTodo({ id: 'epic-dirty-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', kind: 'epic' as Todo['kind'], parentId: null }),
      makeTodo({
        id: 'leaf-serving-1', parentId: 'epic-dirty-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        status: 'ready', acceptanceStatus: null,
      }),
    ];

    const readResidue = async (_p: string, cycle: { epicId: string }) =>
      cycle.epicId === 'epic-dirty-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' ? ['M src/dirty.ts'] : [];

    // Two open escalations of the tracked kind with DISTINCT questionText, one
    // in-window, one raised after untilMs.
    createEscalation({
      project, session: 'daemon', kind: MAIN_CHECKOUT_ESCALATION_KIND,
      questionText: 'residue-card-1',
    });
    const untilMs = Date.now();
    await new Promise((r) => setTimeout(r, 25));
    createEscalation({
      project, session: 'daemon', kind: MAIN_CHECKOUT_ESCALATION_KIND,
      questionText: 'residue-card-2',
    });

    const report = await reportLandCycles(
      project,
      { sinceMs: t0, untilMs },
      { listTodos: () => todos, readResidue },
    );

    expect(report.cycles.map((c) => c.epicId)).toEqual([
      'epic-clean-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'epic-dirty-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ]);

    const clean = report.cycles[0];
    expect(clean.landPath).toBe('epic-tip');
    expect(clean.nonTerminalServingLeafCount).toBe(0);
    expect(clean.nonTerminalServingLeafIds).toEqual([]);
    expect(clean.postLandStatusClean).toBe(true);
    expect(clean.postLandResidue).toEqual([]);

    const dirty = report.cycles[1];
    expect(dirty.landPath).toBe('merge-sha-fallback');
    expect(dirty.nonTerminalServingLeafCount).toBe(1);
    expect(dirty.nonTerminalServingLeafIds).toEqual(['leaf-serving-1']);
    expect(dirty.postLandStatusClean).toBe(false);
    expect(dirty.postLandResidue).toEqual(['M src/dirty.ts']);

    expect(report.counts).toEqual({
      cycles: 2,
      cyclesWithNonTerminalServingLeaf: 1,
      cyclesWithDirtyCheckout: 1,
    });

    expect(report.mainCheckoutEscalations.count).toBe(1);
  });

  it('the MCP tool is declared and dispatched in setup.ts', () => {
    const setupPath = join(import.meta.dir, '../../mcp/setup.ts');
    const content = readFileSync(setupPath, 'utf8');
    expect(content).toContain("name: 'land_telemetry_report'");
    expect(content).toContain("case 'land_telemetry_report':");
  });
});
