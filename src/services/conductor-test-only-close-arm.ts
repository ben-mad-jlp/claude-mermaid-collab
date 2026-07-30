/**
 * conductor-test-only-close-arm — the conductor's TEST-ONLY-CLOSE arm for capped criteria
 * whose most recent verdict cites test paths only (no product/source paths). Rather than
 * raising a human serve-cap card, the arm mints a narrow close-out leaf scoped to exactly
 * the cited test paths, so the fix (a stale assertion, a flaky test) can be closed by an
 * agent without touching product code.
 *
 * Order is load-bearing: classify → claim → create-epic → RELEASE (approvedAt) → add-leaves.
 * The claim (claimApproachRungOnce on rung 'test-only-close') is atomic and idempotent — a
 * crash after claim but before mint leaves the rung claimed forever, which is the same
 * tolerance the redecompose arm accepts (an orphaned partial epic is acceptable; a double
 * mint is not). The epic MUST be released with approvedAt before addLeavesToEpic runs —
 * hasUnreleasedEpicAncestor (claimability.ts) reads approvedAt==null on any epic ancestor,
 * so an unreleased epic's leaf would read `parent-unreleased` forever otherwise.
 *
 * Fail OPEN at the call site: the caller (conductor-pass.ts) wraps the call in the same
 * try/catch the escalated-criterion loop already runs in, so a thrown deps fn falls through
 * to the existing serve-cap card path exactly as a `mint-failed` result would.
 */
import { classifyVerdictTestOnly, extractToCloseText } from './verdict-test-only.js';
import { claimApproachRungOnce } from './criterion-approach-store.js';
import { updateTodo } from './todo-store.js';

export function buildCloseOutBrief(input: {
  criterionText: string;
  toCloseText: string | null;
  testPaths: string[];
  verifiedAtSha: string | null;
}): { title: string; description: string; files: string[]; outOfScope: string[] } {
  const outOfScope = ['src/**', 'ui/src/**', 'bin/**', 'scripts/**'];

  const lines: string[] = [];
  lines.push('TO CLOSE');
  lines.push(input.toCloseText ?? '(none captured)');
  lines.push('');
  lines.push('OUT OF SCOPE');
  for (const g of outOfScope) lines.push(`- ${g}`);
  if (input.verifiedAtSha) {
    lines.push('');
    lines.push(`Verdict verified at sha ${input.verifiedAtSha}.`);
  }

  return {
    title: `Close out: ${input.criterionText}`.slice(0, 120),
    description: lines.join('\n'),
    files: input.testPaths,
    outOfScope,
  };
}

export interface CloseArmDeps {
  classifyVerdictTestOnly?: typeof classifyVerdictTestOnly;
  claimApproachRungOnce?: typeof claimApproachRungOnce;
  createEpicWithLandLeaf?: (
    project: string,
    session: string,
    opts: { title: string; home: string | null; homeProvided: boolean; servesCriterionIds: string[] },
  ) => Promise<{ epic: { id: string } }>;
  addLeavesToEpic?: (
    project: string,
    session: string,
    epicId: string,
    leaves: Array<{
      title: string;
      description?: string;
      files?: string[];
      status?: 'planned' | 'ready';
      assigneeKind?: 'agent' | 'human';
      servesCriterionId?: string;
      allowDuplicate?: boolean;
    }>,
  ) => Promise<{ epicId: string; createdIds: string[] }>;
  updateTodo?: typeof updateTodo;
  now?: () => string;
}

export async function runTestOnlyCloseArm(
  project: string,
  session: string,
  missionId: string,
  c: { id: string; text: string; evidence: string | null; evidencePaths: string[]; verifiedAtSha: string | null },
  deps: CloseArmDeps = {},
): Promise<{
  minted: boolean;
  why: 'not-test-only' | 'already-claimed' | 'mint-failed' | 'minted';
  epicId?: string;
  leafId?: string;
}> {
  const classifyFn = deps.classifyVerdictTestOnly ?? classifyVerdictTestOnly;
  const claimFn = deps.claimApproachRungOnce ?? claimApproachRungOnce;
  const updateTodoFn = deps.updateTodo ?? updateTodo;
  const nowFn = deps.now ?? (() => new Date().toISOString());
  const createEpicFn =
    deps.createEpicWithLandLeaf ??
    (async (
      p: string,
      s: string,
      opts: { title: string; home: string | null; homeProvided: boolean; servesCriterionIds: string[] },
    ) => {
      const { createEpicWithLandLeaf } = await import('../mcp/workgraph-tools.js');
      return createEpicWithLandLeaf(p, s, opts);
    });
  const addLeavesFn =
    deps.addLeavesToEpic ??
    (async (
      p: string,
      s: string,
      epicId: string,
      leaves: Array<{
        title: string;
        description?: string;
        files?: string[];
        assigneeKind?: 'agent' | 'human';
        servesCriterionId?: string;
        allowDuplicate?: boolean;
      }>,
    ) => {
      const { addLeavesToEpic } = await import('../mcp/workgraph-tools.js');
      return addLeavesToEpic(p, s, epicId, leaves as any);
    });

  const classification = classifyFn({ evidence: c.evidence, evidencePaths: c.evidencePaths });
  if (!classification.testOnly) {
    return { minted: false, why: 'not-test-only' };
  }

  const claimed = claimFn({
    criterionId: c.id,
    missionId,
    project,
    rung: 'test-only-close',
    epicId: 'sha:' + (c.verifiedAtSha ?? 'none'),
    outcome: 'attempted',
    detail: null,
    attemptedAt: Date.now(),
  });
  if (!claimed) {
    return { minted: false, why: 'already-claimed' };
  }

  try {
    const toCloseText = extractToCloseText(c.evidence);
    const brief = buildCloseOutBrief({
      criterionText: c.text,
      toCloseText,
      testPaths: classification.testPaths,
      verifiedAtSha: c.verifiedAtSha,
    });

    const { epic } = await createEpicFn(project, session, {
      title: brief.title,
      home: missionId,
      homeProvided: true,
      servesCriterionIds: [c.id],
    });

    await updateTodoFn(project, epic.id, { approvedAt: nowFn(), approvedBy: 'conductor:test-only-close' });

    const { createdIds } = await addLeavesFn(project, session, epic.id, [
      {
        title: brief.title,
        description: brief.description,
        files: brief.files,
        status: 'ready',
        assigneeKind: 'agent',
        servesCriterionId: c.id,
        allowDuplicate: true,
      },
    ]);

    return { minted: true, why: 'minted', epicId: epic.id, leafId: createdIds[0] };
  } catch {
    return { minted: false, why: 'mint-failed' };
  }
}
