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
  test('rejects a same-model panel before spawning the runner', async () => {
    const { criterion } = await setupMissionWithCriterion();
    const invokeSpy = { calls: 0 };

    await expect(runCriterionVerifyPanel(project, criterion.id, {
      invoke: async (_spec: NodeSpec): Promise<NodeResult> => {
        invokeSpy.calls++;
        return {
          ok: true,
          exitCode: 0,
          stdout: 'VERDICT: PASS',
          durationMs: 1,
          rateLimited: false,
          authMode: 'subscription',
        };
      },
      makerModel: 'sonnet',
      lensPool: ['sonnet', 'haiku', 'fable'],
    })).rejects.toThrow(/Panel model collision/);

    expect(invokeSpy.calls).toBe(0);
  });

  test('production default resolves a non-colliding plan when maker/pool are not supplied', async () => {
    const { criterion } = await setupMissionWithCriterion();
    const invokeSpy = { calls: 0 };

    const result = await runCriterionVerifyPanel(project, criterion.id, {
      invoke: async (_spec: NodeSpec): Promise<NodeResult> => {
        invokeSpy.calls++;
        return {
          ok: true,
          exitCode: 0,
          stdout: 'VERDICT: PASS',
          durationMs: 1,
          rateLimited: false,
          authMode: 'subscription',
        };
      },
    });

    expect(result.invocations).toBe(3);
    expect(invokeSpy.calls).toBe(3);
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

  test('a HOLD persists non-null evidence (dissent + retained prior) and preserves evidencePaths — never a silent phantom-gap', async () => {
    const { criterion } = await setupMissionWithCriterion();
    // A previously-MET criterion with rich human evidence + evidence-path linkage.
    setCriterionVerdict(project, criterion.id, {
      met: true,
      evidence: 'PRIOR human evidence: proven at sha deadbeef, tests 17/0 green',
      verifiedBy: 'human',
      verifiedAtSha: 'deadbeef',
      evidencePaths: ['src/services/archival-sweep.ts'],
    });

    // Lenses all FAIL → HOLD. headSha differs from the prior verifiedAtSha so it re-panels.
    const mockInvoke = async (_spec: NodeSpec): Promise<NodeResult> => ({
      ok: true,
      exitCode: 0,
      stdout: 'VERDICT: FAIL — could not confirm from the prompt',
      durationMs: 1000,
      rateLimited: false,
      authMode: 'subscription',
    });

    let extraSeen: { met: boolean; evidence: string; evidencePaths: string[]; verifiedAtSha?: string } | undefined;
    const mockRecord = async (
      _p: string,
      _cid: string,
      _pv: PanelVerdict[],
      extra: { met: boolean; evidence: string; evidencePaths: string[]; verifiedAtSha?: string },
    ): Promise<string | null> => {
      extraSeen = extra;
      return null;
    };

    const result = await runCriterionVerifyPanel(project, criterion.id, {
      invoke: mockInvoke,
      headSha: () => 'newsha01',
      recordVerdict: mockRecord,
    });

    expect(result.hold).toBe(true);
    expect(result.met).toBe(false);
    expect(extraSeen).toBeTruthy();
    if (extraSeen) {
      expect(extraSeen.met).toBe(false);
      // Evidence is NON-NULL and NON-EMPTY — the core of the phantom-gap fix.
      expect(extraSeen.evidence.length).toBeGreaterThan(0);
      expect(extraSeen.evidence).toContain('HOLD');
      // The prior human evidence is RETAINED, not wiped to null.
      expect(extraSeen.evidence).toContain('PRIOR human evidence: proven at sha deadbeef');
      // The evidence-path linkage is PRESERVED so the reopen-on-land mechanism keeps working.
      expect(extraSeen.evidencePaths).toEqual(['src/services/archival-sweep.ts']);
    }
  });

  test('all-lenses-unparseable panel records outcome infra-degraded with the infra marker in evidence', async () => {
    const { criterion } = await setupMissionWithCriterion();

    const mockInvoke = async (_spec: NodeSpec): Promise<NodeResult> => ({
      ok: true,
      exitCode: 0,
      stdout: 'no clear verdict here',
      durationMs: 1000,
      rateLimited: false,
      authMode: 'subscription',
    });

    let extraSeen: { met: boolean; evidence: string; evidencePaths: string[]; verifiedAtSha?: string } | undefined;
    const mockRecord = async (
      _p: string,
      _cid: string,
      _pv: PanelVerdict[],
      extra: { met: boolean; evidence: string; evidencePaths: string[]; verifiedAtSha?: string },
    ): Promise<string | null> => {
      extraSeen = extra;
      return null;
    };

    const result = await runCriterionVerifyPanel(project, criterion.id, {
      invoke: mockInvoke,
      recordVerdict: mockRecord,
    });

    expect(result.outcome).toBe('infra-degraded');
    expect(result.hold).toBe(true);
    expect(result.met).toBe(false);
    expect(extraSeen).toBeTruthy();
    expect(extraSeen?.evidence).toContain('infra-degraded');
  });

  test('all-lenses genuine FAIL panel records outcome dissent without the infra marker', async () => {
    const { criterion } = await setupMissionWithCriterion();

    const mockInvoke = async (_spec: NodeSpec): Promise<NodeResult> => ({
      ok: true,
      exitCode: 0,
      stdout: 'VERDICT: FAIL — evidence not found',
      durationMs: 1000,
      rateLimited: false,
      authMode: 'subscription',
    });

    let extraSeen: { met: boolean; evidence: string; evidencePaths: string[]; verifiedAtSha?: string } | undefined;
    const mockRecord = async (
      _p: string,
      _cid: string,
      _pv: PanelVerdict[],
      extra: { met: boolean; evidence: string; evidencePaths: string[]; verifiedAtSha?: string },
    ): Promise<string | null> => {
      extraSeen = extra;
      return null;
    };

    const result = await runCriterionVerifyPanel(project, criterion.id, {
      invoke: mockInvoke,
      recordVerdict: mockRecord,
    });

    expect(result.outcome).toBe('dissent');
    expect(result.hold).toBe(true);
    expect(result.met).toBe(false);
    expect(extraSeen?.evidence).not.toContain('infra-degraded');
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

  function productionStreamJson(finalText: string): string {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc123' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: `Some reasoning here.\nMore reasoning.\n${finalText}` }] },
      }),
      JSON.stringify({ type: 'result', result: finalText }),
    ];
    return lines.join('\n');
  }

  test('records met:true on unanimous PASS from production-shaped stream-json NodeResult', async () => {
    const { criterion } = await setupMissionWithCriterion();

    const finalText = 'Reasoning follows.\nVERDICT: PASS';
    const mockInvoke = async (_spec: NodeSpec): Promise<NodeResult> => ({
      ok: true,
      exitCode: 0,
      stdout: productionStreamJson(finalText),
      text: finalText,
      durationMs: 1000,
      rateLimited: false,
      authMode: 'subscription',
    });

    const mockRecord = async (): Promise<string | null> => null;

    const result = await runCriterionVerifyPanel(project, criterion.id, {
      invoke: mockInvoke,
      recordVerdict: mockRecord,
    });

    expect(result.met).toBe(true);
    expect(result.hold).toBeUndefined();
  });

  test('stays met:false when production-shaped text carries no VERDICT line', async () => {
    const { criterion } = await setupMissionWithCriterion();

    const finalText = 'I looked at the evidence and it seems reasonable, no clear verdict though.';
    const mockInvoke = async (_spec: NodeSpec): Promise<NodeResult> => ({
      ok: true,
      exitCode: 0,
      stdout: productionStreamJson(finalText),
      text: finalText,
      durationMs: 1000,
      rateLimited: false,
      authMode: 'subscription',
    });

    const mockRecord = async (): Promise<string | null> => null;

    const result = await runCriterionVerifyPanel(project, criterion.id, {
      invoke: mockInvoke,
      recordVerdict: mockRecord,
    });

    expect(result.met).toBe(false);
    expect(result.hold).toBe(true);
  });
});
