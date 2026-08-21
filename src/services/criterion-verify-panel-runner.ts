/** Auto-spawning runner for the criterion verify panel.
 *
 *  Orchestrates the three-lens panel verification: resolves the criterion,
 *  builds prompts, plans model assignments, spawns lens nodes in parallel,
 *  parses and joins verdicts, and records the final result. */

import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { VERIFY_LENSES, type VerifyLens, type LensVerifyCtx, type PanelVerdict, type AssertionFact, buildLensVerifyPrompt, parseLensVerdict, joinPanelVerdicts, parseNamedAssertions, declaringCallerIn, classifyLensOutcome, panelQuorumNote } from './criterion-verify-panel.js';
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
  retry?: boolean;
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

  // 2a. Compute assertion facts: resolve candidate paths and read file text safely
  let assertionFacts: AssertionFact[] | undefined;
  try {
    // Candidate paths = evidencePaths + test files named in criterion text
    const testPathPattern = /[\w./-]*[\w-]+\.(?:test|spec)\.tsx?\b/g;
    const namedTestPaths = new Set<string>();
    let testMatch;
    while ((testMatch = testPathPattern.exec(criterion.text)) !== null) {
      namedTestPaths.add(testMatch[0]);
    }

    const candidatePaths = new Set<string>([
      ...criterion.evidencePaths,
      ...namedTestPaths,
    ]);

    // Read each file and build facts array
    const files: Array<{ path: string; text: string }> = [];
    for (const candidatePath of candidatePaths) {
      try {
        const fullPath = isAbsolute(candidatePath) ? candidatePath : join(project, candidatePath);
        const text = readFileSync(fullPath, 'utf8');
        files.push({ path: candidatePath, text });
      } catch {
        // File missing or unreadable; contribute nothing to facts
      }
    }

    // For each parsed assertion name, find first file that declares it
    const parsedNames = parseNamedAssertions(criterion.text);
    assertionFacts = parsedNames.map((name) => {
      for (const file of files) {
        const caller = declaringCallerIn(file.text, name);
        if (caller !== null) {
          return { name, path: file.path, caller };
        }
      }
      return { name, path: null, caller: null };
    });
  } catch {
    // Fail-safe: if any error occurs, degrade to undefined (no facts)
    assertionFacts = undefined;
  }

  const prompts: Record<VerifyLens, string> = {} as any;
  for (const lens of lenses) {
    prompts[lens] = buildLensVerifyPrompt(lens, ctx, assertionFacts);
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

    const outcome = classifyLensOutcome({
      ok: res.ok,
      exitCode: res.exitCode,
      timedOut: res.timedOut,
      rateLimited: res.rateLimited,
      startFailure: res.startFailure,
      text: res.text ?? res.stdout,
      parsed,
    });

    if (outcome === 'infra') {
      // Derive shape-only label from NodeResult
      let label = 'non-zero-exit';
      if (res.timedOut) {
        label = 'timeout';
      } else if (res.rateLimited || (res.text ?? res.stdout)?.match(/you[''']ve reached your .{0,40}limit|quota|rate.?limit|429|overloaded/i)) {
        label = 'rate-limit';
      }
      verdicts.push({ lens, met: false, indeterminate: true, reason: `infra: lens node did not produce a verdict (${label})` });
      causes.push('infra');
    } else if (outcome === 'met') {
      verdicts.push({ lens, met: true, reason: 'criterion met by this lens' });
      causes.push('met');
    } else {
      verdicts.push({ lens, met: false, reason: 'lens found evidence against the criterion' });
      causes.push('genuine-not-met');
    }
  }

  // 5. Join verdicts — filter infra lenses and check majority coverage.
  // Infra lenses (timeouts, parse failures) cannot cast a vote, so the majority is computed
  // over the parseable subset only. If coverage is below majority, return infra-degraded hold.
  // Otherwise, join over parseable lenses only via the shared strict-majority rule.
  const parseableVerdicts = verdicts.filter((v, i) => causes[i] !== 'infra' && !v.indeterminate);
  const requiredMajority = Math.floor(lenses.length / 2) + 1;

  // Early return if all lenses are infra (parseable count is 0)
  if (parseableVerdicts.length === 0) {
    return {
      met: false,
      hold: true,
      outcome: 'infra-degraded',
      retry: true,
      invocations: lenses.length,
    };
  }

  let met: boolean;
  let outcome: 'pass' | 'dissent' | 'infra-degraded';
  let dissent: string | undefined;
  let hold = false;
  let quorumNote = '';

  if (parseableVerdicts.length < requiredMajority) {
    // Below-majority coverage: infra-degraded hold, no grading.
    met = false;
    hold = true;
    outcome = 'infra-degraded';
    const notMetParseable = parseableVerdicts
      .filter((v) => !v.met)
      .map((v) => `${v.lens}: ${v.reason}`)
      .join('; ');
    dissent = notMetParseable || undefined;
  } else {
    // Sufficient coverage: join over parseable set only.
    const join = joinPanelVerdicts(parseableVerdicts);
    met = join.met;
    outcome = met ? 'pass' : 'dissent';
    quorumNote = panelQuorumNote(join);
    if (!met) {
      hold = true;
      dissent = join.dissent;
    }
  }

  // 6. Record the verdict — ALWAYS with a non-null evidence string and the criterion's
  // existing evidencePaths preserved. A bare HOLD used to record met:false with no evidence,
  // which nulled a previously-met criterion's evidence and dropped its evidencePaths — a
  // silent phantom-gap: the criterion flipped to unmet, lost its audit trail, AND lost the
  // land-reopen linkage. Now a HOLD persists WHY it held (the dissent) and RETAINS the prior
  // evidence + paths, so a shared-evidence-path reopen is diagnosable and re-verifiable.
  const panelSummary = verdicts.map((v) => `${v.lens}:${v.indeterminate ? 'indeterminate' : v.met ? 'met' : 'not-met'}`).join(', ');
  const priorEvidence = criterion.evidence
    ? `\n\nPRIOR evidence (retained — re-verify against ground truth if this reopen was a shared-evidence-path land, not a real change):\n${criterion.evidence}`
    : '';
  const shaLabel = currentHeadSha ?? 'unknown-sha';
  const quorumSuffix = quorumNote ? ` (${quorumNote})` : '';
  const evidence =
    outcome === 'pass'
      ? `Auto-panel PASS at ${shaLabel} — strict-majority met (${verdicts.filter((v) => v.met).length}/${lenses.length}) across distinct-model lens${lenses.length === 1 ? '' : 'es'} (${panelSummary}).${quorumSuffix}${priorEvidence}`
      : outcome === 'infra-degraded'
        ? `Auto-panel HOLD (infra-degraded — only ${parseableVerdicts.length}/${lenses.length} lenses produced a parseable verdict, below the required majority of ${requiredMajority}; this is NOT adversarial dissent) at ${shaLabel} — criterion stays unverified (never auto-passed). ${panelSummary}.${priorEvidence}`
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
