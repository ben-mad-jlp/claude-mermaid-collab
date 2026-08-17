// Grading-time re-measurement of a criterion's named command(s). Drives the live
// handleMissionTool wiring — set_mission_criterion(met:true) must re-run any backticked
// allowlisted command in the criterion text and refuse the grade on a non-zero exit or
// an unresolvable unlanded serving epic.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleMissionTool } from '../../mcp/mission-tools';
import { createTodo, _closeProject } from '../todo-store';
import { addCriterion, listCriteria } from '../mission-store';
import { _closeDb } from '../supervisor-store';
import { parseNamedCommands, _setRemeasureRunner } from '../criterion-command-remeasure';

let project: string;
const S = 's_test';

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'criterion-command-remeasure-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _setRemeasureRunner(null);
  _closeProject(project);
  _closeDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

async function callMissionTool(name: string, args: Record<string, unknown>): Promise<any> {
  const out = await handleMissionTool(name, { project, ...args });
  return JSON.parse(out!);
}

describe('criterion-command-remeasure', () => {
  test('parseNamedCommands extracts an allowlisted command and rejects metacharacters', () => {
    expect(parseNamedCommands('Green when `bun test src/foo.test.ts` passes.')).toEqual([
      'bun test src/foo.test.ts',
    ]);
    expect(parseNamedCommands('Also run `npm run build` and `tsc --noEmit`.')).toEqual([
      'npm run build',
      'tsc --noEmit',
    ]);
    // Not an allowlisted head.
    expect(parseNamedCommands('Run `rm -rf /` to clean up.')).toEqual([]);
    // Allowlisted head but a shell metachar smuggled in.
    expect(parseNamedCommands('Run `bun test foo.ts; rm -rf /` first.')).toEqual([]);
    expect(parseNamedCommands('Run `bun test foo.ts && echo pwned` first.')).toEqual([]);
    // No backticks at all.
    expect(parseNamedCommands('No commands named here at all.')).toEqual([]);
    // Dedupe, first-seen order.
    expect(parseNamedCommands('`bun test x.ts` then again `bun test x.ts`')).toEqual([
      'bun test x.ts',
    ]);
  });

  test('a red named command refuses the grade and leaves the criterion not met', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: S,
      title: '[MISSION] Remeasure red case',
      kind: 'mission',
    });
    const criterion = addCriterion(
      project,
      mission.id,
      "`bun test src/foo.test.ts` produces results.json which contains a pass entry for the remeasure-red case.",
    );

    _setRemeasureRunner(async () => ({ code: 1, stdout: '', stderr: 'FAIL' }));

    await expect(
      callMissionTool('set_mission_criterion', { criterionId: criterion.id, met: true, evidence: 'claimed green' }),
    ).rejects.toThrow(/criterion cannot grade met/);

    const stored = listCriteria(project, mission.id).find((c) => c.id === criterion.id);
    expect(stored?.met).toBe(false);
  });

  test('a green named command grades the criterion met', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: S,
      title: '[MISSION] Remeasure green case',
      kind: 'mission',
    });
    const criterion = addCriterion(
      project,
      mission.id,
      "`bun test src/foo.test.ts` produces results.json which contains a pass entry for the remeasure-green case.",
    );

    _setRemeasureRunner(async () => ({ code: 0, stdout: 'ok', stderr: '' }));

    const result = await callMissionTool('set_mission_criterion', {
      criterionId: criterion.id,
      met: true,
      evidence: 'actually green',
    });
    expect(result.met).toBe(true);

    const stored = listCriteria(project, mission.id).find((c) => c.id === criterion.id);
    expect(stored?.met).toBe(true);
  });

  test('an unlanded serving epic with no shared artifact refuses and names the epic', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: S,
      title: '[MISSION] Remeasure unlanded case',
      kind: 'mission',
    });
    const criterion = addCriterion(
      project,
      mission.id,
      "`bun test src/foo.test.ts` produces results.json which contains a pass entry for the remeasure-unlanded case.",
    );
    const epic = await createTodo(project, {
      ownerSession: S,
      title: '[EPIC] serves remeasure criterion',
      kind: 'epic',
      parentId: mission.id,
      servesCriterionIds: [criterion.id],
    });

    // No land record for this epic, and no accumulation worktree exists on disk —
    // the shared artifact is unavailable.
    await expect(
      callMissionTool('set_mission_criterion', { criterionId: criterion.id, met: true, evidence: 'claimed green' }),
    ).rejects.toThrow(/unlanded/);

    let threw = false;
    try {
      await callMissionTool('set_mission_criterion', { criterionId: criterion.id, met: true, evidence: 'x' });
    } catch (e: any) {
      threw = true;
      expect(e.message).toContain(epic.id.slice(0, 8));
    }
    expect(threw).toBe(true);

    const stored = listCriteria(project, mission.id).find((c) => c.id === criterion.id);
    expect(stored?.met).toBe(false);
  });
});
