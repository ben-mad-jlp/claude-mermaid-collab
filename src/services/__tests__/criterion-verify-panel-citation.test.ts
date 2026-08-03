import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCriterionVerifyPanel } from '../criterion-verify-panel-runner';
import { addSessionTodo } from '../../mcp/tools/session-todos.js';
import { addCriterion, _resetMissionDbCache, upsertMission, listCriteria } from '../mission-store';
import { classifyVerifyStakes, PANEL_CHECKER_COUNT } from '../criterion-verify-stakes';
import { joinPanelVerdicts } from '../criterion-verify-panel';
import type { NodeSpec, NodeResult } from '../../agent/node-invoker';
import type { PanelVerdict } from '../criterion-verify-panel';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'panel-citation-test-'));
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

describe('criterion-verify-panel citation tests', () => {
  test('a high-stakes criterion dispatches at least 2 lenses on DISTINCT models', async () => {
    const { criterion } = await setupMissionWithCriterion();

    // Build the high-stakes input directly
    const stakes = classifyVerifyStakes({
      reopenCount: 0,
      lastReopenSha: null,
      pendingRecheckReason: 'land-diff-intersects-evidence',
      servedEpicCount: 0,
      openCardKinds: [],
    });

    // Ground the predicate before checking downstream effects
    expect(stakes.panel).toBe(true);
    expect(stakes.checkerCount).toBe(PANEL_CHECKER_COUNT);

    // Spy on invoke to capture models
    const capturedModels: string[] = [];
    const mockInvoke = async (spec: NodeSpec): Promise<NodeResult> => {
      if (spec.model) {
        capturedModels.push(spec.model);
      }
      return {
        ok: true,
        exitCode: 0,
        stdout: 'VERDICT: PASS',
        durationMs: 1,
        rateLimited: false,
        authMode: 'subscription',
      };
    };

    // Run with lensCount: stakes.checkerCount, without makerModel/lensPool
    const result = await runCriterionVerifyPanel(project, criterion.id, {
      invoke: mockInvoke,
      lensCount: stakes.checkerCount,
    });

    // Assert the runner invoked the expected number of lenses
    expect(result.invocations).toBe(PANEL_CHECKER_COUNT);
    expect(capturedModels.length).toBe(PANEL_CHECKER_COUNT);

    // Assert at least 2 distinct models were dispatched
    const distinctModels = new Set(capturedModels);
    expect(distinctModels.size).toBeGreaterThanOrEqual(2);
  });

  test('a 1-1 split records met=false with split and a dissent string', async () => {
    const { criterion } = await setupMissionWithCriterion();

    const invokeCallCount = { count: 0 };
    let recordedVerdicts: PanelVerdict[] | undefined;

    // Mock invoke alternating one PASS then one FAIL
    const mockInvoke = async (_spec: NodeSpec): Promise<NodeResult> => {
      invokeCallCount.count++;
      if (invokeCallCount.count === 1) {
        return {
          ok: true,
          exitCode: 0,
          stdout: 'VERDICT: PASS',
          durationMs: 1000,
          rateLimited: false,
          authMode: 'subscription',
        };
      }
      // Second lens FAILs
      return {
        ok: true,
        exitCode: 0,
        stdout: 'VERDICT: FAIL — evidence not found',
        durationMs: 1000,
        rateLimited: false,
        authMode: 'subscription',
      };
    };

    // Mock recordVerdict to capture the verdicts array
    const mockRecord = async (
      _p: string,
      _cid: string,
      pv: PanelVerdict[],
    ): Promise<string | null> => {
      recordedVerdicts = pv;
      return null;
    };

    // Run with lensCount: 2 to create a 1-1 split
    const result = await runCriterionVerifyPanel(project, criterion.id, {
      invoke: mockInvoke,
      recordVerdict: mockRecord,
      lensCount: 2,
    });

    // Assert runner's return value shows HOLD
    expect(result.met).toBe(false);
    expect(result.hold).toBe(true);

    // Assert dissent is present and includes the lens name and reason
    expect(result.dissent).toBeDefined();
    if (result.dissent) {
      // With lensCount: 2, the lenses are ['evidence-exists', 'regression-red-when-neutered']
      // The dissenting lens is 'regression-red-when-neutered' with its standard reason
      expect(result.dissent).toContain('regression-red-when-neutered');
      expect(result.dissent).toContain('lens found evidence against the criterion');
    }

    // Verify recordedVerdicts was captured
    expect(recordedVerdicts).toBeTruthy();
    if (recordedVerdicts) {
      expect(recordedVerdicts.length).toBe(2);

      // Call joinPanelVerdicts on the SAME 2-element array the runner recorded
      const join = joinPanelVerdicts(recordedVerdicts);

      // Assert the join output shows split and met: false
      expect(join.met).toBe(false);
      expect(join.split).toBe(true);
    }
  });
});
