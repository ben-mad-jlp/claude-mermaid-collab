import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { joinPanelVerdicts, type PanelVerdict } from '../criterion-verify-panel';
import { runCriterionVerifyPanel } from '../criterion-verify-panel-runner';
import { addSessionTodo } from '../../mcp/tools/session-todos.js';
import { addCriterion, _resetMissionDbCache, upsertMission } from '../mission-store';
import type { NodeSpec, NodeResult } from '../../agent/node-invoker';

describe('joinPanelVerdicts quorum reporting', () => {
  it('(1) a panel result built from one lens verdict carries lensCount 1 and quorum provisional', () => {
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: true, reason: 'found' },
    ];
    const join = joinPanelVerdicts(verdicts);
    expect(join.lensCount).toBe(1);
    expect(join.quorum).toBe('provisional');
    expect(join.met).toBe(true);
  });

  it('(2) a panel result built from two agreeing lens verdicts carries lensCount 2 and quorum majority', () => {
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: true, reason: 'found' },
      { lens: 'holds-at-head', met: true, reason: 'still holds' },
    ];
    const join = joinPanelVerdicts(verdicts);
    expect(join.lensCount).toBe(2);
    expect(join.quorum).toBe('majority');
  });

  it('excludes indeterminate verdicts from lensCount (derives from effective, not verdicts)', () => {
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: true, reason: 'found' },
      { lens: 'holds-at-head', met: true, reason: 'infra fault', indeterminate: true },
    ];
    const join = joinPanelVerdicts(verdicts);
    expect(join.lensCount).toBe(1);
    expect(join.quorum).toBe('provisional');
  });
});

describe('runCriterionVerifyPanel evidence carries the provisional quorum marker', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'panel-quorum-evidence-test-'));
    _resetMissionDbCache(project);
  });

  async function setupMissionWithCriterion() {
    const node = await addSessionTodo(project, 's1', 'Test Mission', undefined, {
      kind: 'mission',
      assigneeSession: 's1',
    });
    upsertMission(project, node.id, {});

    const criterion = addCriterion(project, node.id, 'A test acceptance criterion');
    return { node, criterion };
  }

  const passInvoke = async (_spec: NodeSpec): Promise<NodeResult> => ({
    ok: true,
    exitCode: 0,
    stdout: 'VERDICT: PASS',
    durationMs: 1,
    rateLimited: false,
    authMode: 'subscription',
  });

  it('(3) the evidence string a provisional panel writes contains the word provisional', async () => {
    const { criterion } = await setupMissionWithCriterion();
    let capturedEvidence: string | undefined;

    await runCriterionVerifyPanel(project, criterion.id, {
      invoke: passInvoke,
      lensCount: 1,
      headSha: () => 'sha-a',
      recordVerdict: async (_p, _cid, _pv, extra) => {
        capturedEvidence = extra.evidence;
        return null;
      },
    });

    expect(capturedEvidence).toBeDefined();
    expect(capturedEvidence).toContain('provisional');
  });

  it('a majority (2-lens) panel does not carry the provisional marker', async () => {
    const { criterion } = await setupMissionWithCriterion();
    let capturedEvidence: string | undefined;

    await runCriterionVerifyPanel(project, criterion.id, {
      invoke: passInvoke,
      lensCount: 2,
      headSha: () => 'sha-b',
      recordVerdict: async (_p, _cid, _pv, extra) => {
        capturedEvidence = extra.evidence;
        return null;
      },
    });

    expect(capturedEvidence).toBeDefined();
    expect(capturedEvidence).not.toContain('provisional');
  });
});
