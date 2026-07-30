/** Auto-spawning runner for the criterion verify panel.
 *
 *  Orchestrates the three-lens panel verification: resolves the criterion,
 *  builds prompts, plans model assignments, spawns lens nodes in parallel,
 *  parses and joins verdicts, and records the final result. */

import { VERIFY_LENSES, type VerifyLens, type LensVerifyCtx, type PanelVerdict, buildLensVerifyPrompt, parseLensVerdict, joinPanelVerdicts } from './criterion-verify-panel.js';
import { planPanelModels, assertDistinctPanel, PANEL_LENS_TIMEOUT_MS } from './criterion-verify-panel-plan.js';
import { invokeNode, type NodeSpec, type NodeResult } from '../agent/node-invoker.js';
import { missionIdOfCriterion, listCriteria } from './mission-store.js';
import { handleMissionTool } from '../mcp/mission-tools.js';
import { readMainCheckoutHead, type GitRunner } from './main-checkout-invariant.js';
import { resolveNodeModel, resolveNodeProvider } from './node-provider.js';
import { NODE_PROFILE } from './leaf-executor.js';
import { normalizeModelId } from './spend-ledger.js';

const PANEL_CANDIDATE_POOL = ['opus', 'sonnet', 'haiku', 'fable'];

const defaultRunGit: GitRunner = async (cwd, args) => {
  const p = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited,
  ]);
  return { code: code ?? 1, stdout, stderr };
};

async function defaultHeadSha(project: string): Promise<string | undefined> {
  const state = await readMainCheckoutHead(project, defaultRunGit);
  return state.sha || undefined;
}

export interface RunPanelDeps {
  invoke?: (spec: NodeSpec) => Promise<NodeResult>;
  headSha?: () => string;
  makerModel?: string;
  lensPool?: string[];
  lensCount?: number;
  /** Persist the panel verdict. `extra` carries the derived met flag plus the NON-NULL
   *  evidence string and preserved evidencePaths so a HOLD can never wipe a previously-met
   *  criterion's evidence to null (the phantom-gap bug). Extra is appended, so legacy mocks
   *  taking only (project, criterionId, panelVerdicts) keep working. */
  recordVerdict?: (
    project: string,
    criterionId: string,
    panelVerdicts: PanelVerdict[],
    extra: { met: boolean; evidence: string; evidencePaths: string[]; verifiedAtSha?: string },
  ) => Promise<string | null>;
  now?: () => number;
}

export async function runCriterionVerifyPanel(
  project: string,
  criterionId: string,
  deps: RunPanelDeps = {},
): Promise<{
  skipped?: 'unchanged-sha';
  hold?: boolean;
  met: boolean;
  invocations: number;
  dissent?: string;
  outcome?: 'pass' | 'dissent' | 'infra-degraded';
}> {
  // 1. No-op guard: resolve criterion and check if verifiedAtSha is unchanged
  const todoId = missionIdOfCriterion(project, criterionId);
  if (!todoId) {
    throw new Error(`criterion not found: ${criterionId}`);
  }

  const criterion = listCriteria(project, todoId).find((c) => c.id === criterionId);
  if (!criterion) {
    throw new Error(`criterion not found in mission: ${criterionId}`);
  }

  const currentHeadSha = deps.headSha ? deps.headSha() : await defaultHeadSha(project);
  if (
    criterion.verifiedAtSha != null &&
    currentHeadSha != null &&
    criterion.verifiedAtSha === currentHeadSha
  ) {
    return {
      skipped: 'unchanged-sha',
      met: false,
      invocations: 0,
    };
  }

  const lenses = VERIFY_LENSES.slice(0, deps.lensCount ?? VERIFY_LENSES.length);

  // 2. Build LensVerifyCtx and prompts for each lens
  const ctx: LensVerifyCtx = {
    criterionText: criterion.text,
    evidence: criterion.evidence,
    evidencePaths: criterion.evidencePaths,
    verifiedAtSha: criterion.verifiedAtSha,
  };

  const prompts: Record<VerifyLens, string> = {} as any;
  for (const lens of lenses) {
    prompts[lens] = buildLensVerifyPrompt(lens, ctx);
  }

  // 3. Plan models and assert distinctness BEFORE any invoke
  const resolvedMaker = deps.makerModel ?? resolveNodeModel(
    project,
    'implement',
    resolveNodeProvider(project, 'implement', NODE_PROFILE.implement.allowedTools),
    NODE_PROFILE.implement.model,
  );
  const resolvedPool = deps.lensPool ?? PANEL_CANDIDATE_POOL.filter(
    (m) => normalizeModelId(m) !== normalizeModelId(resolvedMaker),
  );

  const plan = planPanelModels({ makerModel: resolvedMaker, lensPool: resolvedPool, lenses });
  assertDistinctPanel(plan, resolvedMaker, lenses);

  // 4. Invoke each lens and parse verdicts
  const verdicts: PanelVerdict[] = [];
  const causes: Array<'met' | 'genuine-not-met' | 'infra'> = [];
  const invoker = deps.invoke ?? invokeNode;

  for (const lens of lenses) {
    const spec: NodeSpec = {
      prompt: prompts[lens],
      model: plan[lens],
      cwd: project,
      timeoutMs: PANEL_LENS_TIMEOUT_MS,
      strictMcpConfig: true,
    };

    const res = await invoker(spec);
    const parseSource = res.ok ? (res.text && res.text.trim() ? res.text : res.stdout) : undefined;
    const parsed = parseLensVerdict(parseSource);

    const met = parsed === 'met';
    const reason =
      parsed === 'error'
        ? res.ok
          ? 'no VERDICT line found in response'
          : `node failed: ${res.text || 'no output'}`
        : parsed === 'not-met'
          ? 'lens found evidence against the criterion'
          : 'criterion met by this lens';

    verdicts.push({ lens, met, reason });
    causes.push(parsed === 'error' ? 'infra' : parsed === 'not-met' ? 'genuine-not-met' : 'met');
  }

  // 5. Join verdicts with unanimity check
  const join = joinPanelVerdicts(verdicts);
  const unanimousMet = verdicts.every((v) => v.met);
  const met = join.met && unanimousMet;

  const outcome: 'pass' | 'dissent' | 'infra-degraded' =
    unanimousMet ? 'pass'
    : causes.some((c) => c === 'genuine-not-met') ? 'dissent'
    : causes.every((c) => c === 'infra') ? 'infra-degraded'
    : 'dissent';

  let dissent: string | undefined;
  let hold = false;

  if (!met) {
    hold = true;
    dissent = join.dissent || verdicts
      .filter((v) => !v.met)
      .map((v) => `${v.lens}: ${v.reason}`)
      .join('; ');
  }

  // 6. Record the verdict — ALWAYS with a non-null evidence string and the criterion's
  // existing evidencePaths preserved. A bare HOLD used to record met:false with no evidence,
  // which nulled a previously-met criterion's evidence and dropped its evidencePaths — a
  // silent phantom-gap: the criterion flipped to unmet, lost its audit trail, AND lost the
  // land-reopen linkage. Now a HOLD persists WHY it held (the dissent) and RETAINS the prior
  // evidence + paths, so a shared-evidence-path reopen is diagnosable and re-verifiable.
  const panelSummary = verdicts.map((v) => `${v.lens}:${v.met ? 'met' : 'not-met'}`).join(', ');
  const priorEvidence = criterion.evidence
    ? `\n\nPRIOR evidence (retained — re-verify against ground truth if this reopen was a shared-evidence-path land, not a real change):\n${criterion.evidence}`
    : '';
  const shaLabel = currentHeadSha ?? 'unknown-sha';
  const evidence =
    outcome === 'pass'
      ? `Auto-panel PASS at ${shaLabel} — unanimous met across ${lenses.length} distinct-model lens${lenses.length === 1 ? '' : 'es'} (${panelSummary}).${priorEvidence}`
      : outcome === 'infra-degraded'
        ? `Auto-panel HOLD (infra-degraded — no lens produced a parseable verdict; this is NOT adversarial dissent) at ${shaLabel} — criterion stays unverified (never auto-passed). ${panelSummary}.${priorEvidence}`
        : `Auto-panel HOLD at ${shaLabel} — criterion stays unverified (never auto-passed). Dissent: ${dissent || panelSummary}.${priorEvidence}`;
  const evidencePaths = criterion.evidencePaths ?? [];

  const recordFn = deps.recordVerdict ?? (async (p, cid, pv, extra) =>
    handleMissionTool('set_mission_criterion', {
      project: p,
      criterionId: cid,
      met: extra.met,
      evidence: extra.evidence,
      evidencePaths: extra.evidencePaths,
      verifiedBy: 'panel',
      verifiedAtSha: extra.verifiedAtSha,
      panelVerdicts: pv,
    })
  );

  await recordFn(project, criterionId, verdicts, { met, evidence, evidencePaths, verifiedAtSha: currentHeadSha });

  // 7. Return result
  return {
    hold: hold || undefined,
    met,
    invocations: lenses.length,
    dissent,
    outcome,
  };
}
