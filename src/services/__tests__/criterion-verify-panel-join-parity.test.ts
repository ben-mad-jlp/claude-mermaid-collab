/** Join-parity pin: ONE join rule through ONE function.
 *
 *  The same panel verdict array must grade to the SAME met through BOTH doors:
 *   - the auto-panel runner (runCriterionVerifyPanel), and
 *   - the tool boundary (set_mission_criterion with panelVerdicts).
 *
 *  On master (pre-fix) this test FAILED — the two doors disagreed on a 2-of-3 array:
 *   - runner door: met=false (joinPanelVerdicts' strict-majority result was additionally
 *     ANDed with a unanimity requirement inside the runner) → HOLD
 *   - tool door:   met=true  (strict-majority only, per the shipped tool description)
 *  Post-fix both doors take met from joinPanelVerdicts (strict-majority) and agree: met=true. */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCriterionVerifyPanel } from '../criterion-verify-panel-runner';
import { addSessionTodo } from '../../mcp/tools/session-todos.js';
import { addCriterion, upsertMission, _resetMissionDbCache } from '../mission-store';
import { handleMissionTool } from '../../mcp/mission-tools';
import { _closeProject } from '../todo-store';
import { createEscalation, _closeDb } from '../supervisor-store';
import type { NodeSpec, NodeResult } from '../../agent/node-invoker';
import type { PanelVerdict } from '../criterion-verify-panel';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'panel-join-parity-'));
  _resetMissionDbCache(project);
  // Isolate supervisor.db (contested-card trigger) to the test project dir.
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _closeDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

async function setupMissionWithCriterion(title: string) {
  const node = await addSessionTodo(project, 's1', title, undefined, {
    kind: 'mission',
    assigneeSession: 's1',
  });
  upsertMission(project, node.id, {});
  const criterion = addCriterion(project, node.id, `Criterion for ${title}`);
  return { node, criterion };
}

describe('panel join parity (runner door vs tool door)', () => {
  test('one 2-of-3 verdict array grades to the SAME met through the runner and through set_mission_criterion', async () => {
    // --- Door 1: the runner. Two lenses PASS, one FAILs → capture its verdict array + met.
    const { criterion: runnerCriterion } = await setupMissionWithCriterion('runner door');

    let invokeCount = 0;
    let recordedVerdicts: PanelVerdict[] | undefined;
    let recordedMet: boolean | undefined;

    const runnerResult = await runCriterionVerifyPanel(project, runnerCriterion.id, {
      invoke: async (_spec: NodeSpec): Promise<NodeResult> => {
        invokeCount++;
        return {
          ok: true,
          exitCode: 0,
          stdout: invokeCount < 3 ? 'VERDICT: PASS' : 'VERDICT: FAIL — evidence not found',
          durationMs: 1000,
          rateLimited: false,
          authMode: 'subscription',
        };
      },
      recordVerdict: async (_p, _cid, pv, extra) => {
        recordedVerdicts = pv;
        recordedMet = extra.met;
        return null;
      },
    });

    expect(invokeCount).toBe(3);
    expect(recordedVerdicts).toBeTruthy();
    expect(recordedVerdicts!.filter((v) => v.met).length).toBe(2); // it really is a 2-of-3 array
    expect(recordedMet).toBe(runnerResult.met); // what the runner records IS what it returns

    // --- Door 2: the tool boundary. Feed the runner's OWN verdict array through
    // set_mission_criterion on a high-stakes (contested-card) criterion.
    const { criterion: toolCriterion } = await setupMissionWithCriterion('tool door');
    createEscalation({
      project,
      audience: 'internal',
      session: 's1',
      kind: 'decision',
      questionText: 'Is the criterion still valid?',
      todoId: toolCriterion.id,
      conditionKey: `decision:${toolCriterion.id}`,
      conditionTuple: [toolCriterion.id],
    });

    const toolOut = JSON.parse((await handleMissionTool('set_mission_criterion', {
      project,
      criterionId: toolCriterion.id,
      met: true,
      evidence: 'Panel verdicts supplied directly',
      verifiedBy: 'parity-test',
      verifiedAtSha: 'abc1234',
      panelVerdicts: recordedVerdicts,
    }))!);
    expect(toolOut.panel).toBe(true); // the panel join actually ran at the tool boundary

    // THE PIN: one question, one answer. Same verdict array ⇒ same met through both doors.
    expect(runnerResult.met).toBe(toolOut.met);

    // And the one shared rule is strict-majority (the shipped public contract): 2-of-3 ⇒ met.
    expect(runnerResult.met).toBe(true);
    expect(toolOut.met).toBe(true);
  });
});
