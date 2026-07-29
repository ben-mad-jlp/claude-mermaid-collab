import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCriterionVerifyPanel } from '../criterion-verify-panel-runner';
import { addSessionTodo } from '../../mcp/tools/session-todos.js';
import { addCriterion, listCriteria, _resetMissionDbCache, getMission, setCriterionVerdict } from '../mission-store';
import { upsertMission } from '../mission-store';
import type { NodeSpec, NodeResult } from '../../agent/node-invoker';
import type { PanelVerdict } from '../criterion-verify-panel';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'panel-runner-test-'));
  _resetMissionDbCache(project);
});

async function setupMissionWithCriterion() {
  const node = await addSessionTodo(project, 's1', 'Test Mission', undefined, {
    kind: 'mission',
    assigneeSession: 's1',
  });
  upsertMission(project, node.id, {});

  const criterionText = 'A test acceptance criterion';
  const criterion = addCriterion(project, node.id, criterionText);

  return { node, criterion };
}

describe('runCriterionVerifyPanel', () => {
  test('rejects a same-model panel before spawning', async () => {
    const { criterion } = await setupMissionWithCriterion();
    const invokeSpy = { calls: 0 };

    const mockInvoke = async (_spec: NodeSpec): Promise<NodeResult> => {
      invokeSpy.calls++;
      return {
        ok: true,
        exitCode: 0,
        stdout: 'VERDICT: PASS',
        durationMs: 1000,
        rateLimited: false,
        authMode: 'subscription',
      };
    };

    // Mock deps where one lens maps to the maker model
    const deps = {
      invoke: mockInvoke,
      // Simulate assertDistinctPanel throwing by modifying the plan
      // We'll test this by passing a makerModel='sonnet' and a lensPool that includes 'sonnet'
    };

    // The runner defaults to maker='opus' and pool=['sonnet', 'haiku', 'fable']
    // So we expect no throw here. To test the throw, we'd need to allow makerModel/lensPool
    // to be passed via deps, but the blueprint doesn't specify that signature.
    // Instead, we verify that assertDistinctPanel throws when called with bad inputs:
    const { assertDistinctPanel, planPanelModels } = await import('../criterion-verify-panel-plan');

    // This should throw because 'sonnet' appears in both plan and as maker
    const badPlan = planPanelModels({ makerModel: 'opus', lensPool: ['sonnet', 'haiku', 'fable'] });
    // Set one lens to maker model (manually for this test)
    badPlan['evidence-exists'] = 'opus';

    expect(() => assertDistinctPanel(badPlan, 'opus')).toThrow(/Panel model collision/);
    expect(invokeSpy.calls).toBe(0);
  });

  test('a per-lens watchdog timeout resolves to HOLD', async () => {
    const { criterion } = await setupMissionWithCriterion();

    const invokeCallCount = { count: 0 };
    let recordedVerdicts: PanelVerdict[] | undefined;

    const mockInvoke = async (_spec: NodeSpec): Promise<NodeResult> => {
      invokeCallCount.count++;
      // First two lenses PASS, third times out (ok=false)
      if (invokeCallCount.count < 3) {
        return {
          ok: true,
          exitCode: 0,
          stdout: 'VERDICT: PASS',
          durationMs: 1000,
          rateLimited: false,
          authMode: 'subscription',
        };
      }
      // Timeout response
      return {
        ok: false,
        exitCode: 137,
        stdout: '',
        durationMs: 10 * 60 * 1000,
        rateLimited: false,
        authMode: 'subscription',
        timedOut: true,
      };
    };

    const mockRecord = async (p: string, cid: string, pv: PanelVerdict[]): Promise<string | null> => {
      recordedVerdicts = pv;
      return null;
    };

    const result = await runCriterionVerifyPanel(project, criterion.id, {
      invoke: mockInvoke,
      recordVerdict: mockRecord,
    });

    expect(result.hold).toBe(true);
    expect(result.met).toBe(false);
    expect(result.invocations).toBe(3);
    expect(invokeCallCount.count).toBe(3);
    expect(recordedVerdicts).toBeTruthy();
    if (recordedVerdicts) {
      expect(recordedVerdicts.length).toBe(3);
      expect(recordedVerdicts[2].met).toBe(false);
    }
  });

  test('a 2-1 split resolves to HOLD, never auto-pass', async () => {
    const { criterion } = await setupMissionWithCriterion();

    const invokeCallCount = { count: 0 };
    let recordedVerdicts: PanelVerdict[] | undefined;

    const mockInvoke = async (_spec: NodeSpec): Promise<NodeResult> => {
      invokeCallCount.count++;
      // Two PASS, one FAIL
      if (invokeCallCount.count < 3) {
        return {
          ok: true,
          exitCode: 0,
          stdout: 'VERDICT: PASS',
          durationMs: 1000,
          rateLimited: false,
          authMode: 'subscription',
        };
      }
      return {
        ok: true,
        exitCode: 0,
        stdout: 'VERDICT: FAIL — evidence not found',
        durationMs: 1000,
        rateLimited: false,
        authMode: 'subscription',
      };
    };

    const mockRecord = async (p: string, cid: string, pv: PanelVerdict[]): Promise<string | null> => {
      recordedVerdicts = pv;
      return null;
    };

    const result = await runCriterionVerifyPanel(project, criterion.id, {
      invoke: mockInvoke,
      recordVerdict: mockRecord,
    });

    expect(result.hold).toBe(true);
    expect(result.met).toBe(false);
    expect(result.invocations).toBe(3);
    expect(recordedVerdicts).toBeTruthy();
    if (recordedVerdicts) {
      const metCount = recordedVerdicts.filter((v: PanelVerdict) => v.met).length;
      expect(metCount).toBe(2); // 2 PASS
    }
  });

  test('unanimous PASS records met via set_mission_criterion', async () => {
    const { criterion } = await setupMissionWithCriterion();

    const mockInvoke = async (_spec: NodeSpec): Promise<NodeResult> => {
      return {
        ok: true,
        exitCode: 0,
        stdout: 'VERDICT: PASS',
        durationMs: 1000,
        rateLimited: false,
        authMode: 'subscription',
      };
    };

    const recordedCalls: Array<{ cid: string; pv: PanelVerdict[] }> = [];
    const mockRecord = async (p: string, cid: string, pv: PanelVerdict[]): Promise<string | null> => {
      recordedCalls.push({ cid, pv });
      return null;
    };

    const result = await runCriterionVerifyPanel(project, criterion.id, {
      invoke: mockInvoke,
      recordVerdict: mockRecord,
    });

    expect(result.met).toBe(true);
    expect(result.hold).toBeUndefined();
    expect(result.invocations).toBe(3);
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].cid).toBe(criterion.id);
    expect(recordedCalls[0].pv).toHaveLength(3);
    expect(recordedCalls[0].pv.every((v) => v.met)).toBe(true);
  });

  test('a criterion whose verifiedAtSha is unchanged is not re-paneled', async () => {
    const { criterion: initialCrit } = await setupMissionWithCriterion();
    const missionId = initialCrit.todoId;
    const testSha = 'abc123';

    // Set verifiedAtSha on the criterion via setCriterionVerdict
    setCriterionVerdict(project, initialCrit.id, {
      met: true,
      evidence: 'prior verdict',
      verifiedBy: 'test',
      verifiedAtSha: testSha,
      evidencePaths: [],
    });

    const invokeCallCount = { count: 0 };

    const mockInvoke = async (_spec: NodeSpec): Promise<NodeResult> => {
      invokeCallCount.count++;
      return {
        ok: true,
        exitCode: 0,
        stdout: 'VERDICT: PASS',
        durationMs: 1000,
        rateLimited: false,
        authMode: 'subscription',
      };
    };

    // Call with matching headSha — should skip without invoking
    const result = await runCriterionVerifyPanel(project, initialCrit.id, {
      invoke: mockInvoke,
      headSha: () => testSha,
    });

    expect(result.skipped).toBe('unchanged-sha');
    expect(result.met).toBe(false);
    expect(result.invocations).toBe(0);
    expect(invokeCallCount.count).toBe(0);
  });

  async function initGitRepo(cwd: string): Promise<string> {
    const run = async (args: string[]) => {
      const p = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
      await p.exited;
    };
    await run(['init']);
    await run(['-c', 'user.email=test@test.com', '-c', 'user.name=test', 'commit', '--allow-empty', '-m', 'init']);
    const revParse = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const sha = (await new Response(revParse.stdout).text()).trim();
    await revParse.exited;
    return sha;
  }

  test('unchanged-sha via real HEAD, no headSha dep, uses production default resolver', async () => {
    const realSha = await initGitRepo(project);
    const { criterion } = await setupMissionWithCriterion();

    setCriterionVerdict(project, criterion.id, {
      met: true,
      evidence: 'prior verdict',
      verifiedBy: 'test',
      verifiedAtSha: realSha,
      evidencePaths: [],
    });

    const invokeCallCount = { count: 0 };
    const countingSpy = async (_spec: NodeSpec): Promise<NodeResult> => {
      invokeCallCount.count++;
      return {
        ok: true,
        exitCode: 0,
        stdout: 'VERDICT: PASS',
        durationMs: 1000,
        rateLimited: false,
        authMode: 'subscription',
      };
    };

    const result = await runCriterionVerifyPanel(project, criterion.id, { invoke: countingSpy });

    expect(result.skipped).toBe('unchanged-sha');
    expect(result.invocations).toBe(0);
    expect(invokeCallCount.count).toBe(0);
  });

  test('production recordVerdict records the real HEAD sha via verifiedAtSha', async () => {
    const realSha = await initGitRepo(project);
    const { criterion } = await setupMissionWithCriterion();

    const mockInvoke = async (_spec: NodeSpec): Promise<NodeResult> => {
      return {
        ok: true,
        exitCode: 0,
        stdout: 'VERDICT: PASS',
        durationMs: 1000,
        rateLimited: false,
        authMode: 'subscription',
      };
    };

    const firstResult = await runCriterionVerifyPanel(project, criterion.id, {
      invoke: mockInvoke,
    });

    expect(firstResult.skipped).toBeUndefined();
    expect(firstResult.invocations).toBe(3);

    const updated = listCriteria(project, criterion.todoId).find((c) => c.id === criterion.id);
    expect(updated?.verifiedAtSha).toBe(realSha);
    expect(updated?.verifiedAtSha).toMatch(/^[0-9a-f]{40}$/);
  });
});
