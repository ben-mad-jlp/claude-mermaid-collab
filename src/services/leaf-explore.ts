import type { LeafRunContext, LeafRunResult } from './leaf-executor';
import type { NodeSpec } from '../agent/node-invoker';
import type { WorktreeManager } from '../agent/worktree-manager';
import { mcpConfigFor, classifyWorktreeAddFault } from '../agent/node-invoker';
import { config } from '../config';
import { NODE_PROFILE, leafTranscriptPath } from './leaf-node-profile';
import { buildNodePrompt, buildExploreWrapUpDirective, exploreReportPath } from './leaf-prompts';
import { parseExploreReport, exploreAssertsFindings, type ExploreReportParse } from './leaf-parsing';
import { composeInjectedContext } from './prompt-injection';
import { findBySourceLeafId } from './finding-store';
import { getInjectionFlags } from './runtime-config';
import { resolveNodePermissionMode } from './node-permission-mode';
import {
  makeStallState,
  advanceStall,
  extractExploreTurns,
  resolveExploreUsdLimits,
  exploreBudgetStep,
} from './explore-budget';

/** Maximum number of explore segments (node invocations) per leaf.
 *  The segment loop guarantees `segmentsRun + 1 >= maxSegments` triggers hard-stop. */
export const MAX_EXPLORE_SEGMENTS = 6;

export async function runExplorePipeline(ctx: LeafRunContext): Promise<LeafRunResult> {
  ctx.state.attempt = 1; // single pass (no fresh-worktree retry loop)
  ctx.state.pathTaken = 'explore';
  let wt: Awaited<ReturnType<WorktreeManager['ensure']>>;
  try {
    wt = await ctx.deps.wm.ensure(ctx.sessionKey, { baseBranch: ctx.epicBranch, fresh: true });
  } catch (e) {
    if (e instanceof Error && classifyWorktreeAddFault(e.message)) {
      return ctx.pausedForWorktreeAddFault('explore');
    }
    throw e;
  }
  const cwd = wt.path;
  const exploreInjected = composeInjectedContext({ kind: 'explore', project: ctx.project, epicId: ctx.epicId, flags: getInjectionFlags(ctx.project) });

  // Segment loop state
  let spentUsd = 0;
  let stall = makeStallState();
  let segmentsRun = 0;
  let wrapUpSignalled = false;
  let lastReport: string | undefined;
  let lastParse: ExploreReportParse | undefined;
  let lastParseFailReason: 'empty' | 'unparseable' | undefined;
  let curSpec: NodeSpec = {
    prompt: buildNodePrompt('explore', ctx.leaf),
    model: ctx.nodeModel('explore'),
    effort: ctx.nodeEffort('explore'),
    allowedTools: NODE_PROFILE.explore.allowedTools,
    mcpConfig: mcpConfigFor(config.PORT),
    strictMcpConfig: true,
    cwd,
    leafId: ctx.leaf.id,
    epicId: ctx.epicId,
    permissionMode: resolveNodePermissionMode(),
    transcriptPath: leafTranscriptPath(ctx.project, ctx.leaf.id),
    transcriptLabel: 'explore',
    appendSystemPrompt: exploreInjected || undefined,
  };

  // Main segment loop
  for (;;) {
    const res = await ctx.runNode('explore', curSpec);

    // Preserve early-return paths verbatim
    if (res.startFailure) return ctx.parkNodeStartFailure('explore', res);
    if (res.rateLimited) return ctx.pausedResult('explore', res);
    if (!ctx.checkBudget()) return ctx.parkBlocked('node-budget-exhausted');
    if (!res.ok) return ctx.parkBlocked('explore-node-failed');

    // Accumulate spending and advance stall
    spentUsd += res.usage?.costUsd ?? 0;
    segmentsRun += 1;

    // Process turns for stall detection
    for (const t of extractExploreTurns(res.stdout)) {
      stall = advanceStall(stall, t);
    }

    // Parse report (only overwrite on ok:true)
    const parsed = parseExploreReport(res.text);
    if (parsed.ok) {
      lastReport = parsed.report;
      lastParse = parsed;
      lastParseFailReason = undefined;
    } else {
      lastParseFailReason = parsed.reason;
    }

    // Decide next action
    const limits = resolveExploreUsdLimits(process.env);
    const decision = exploreBudgetStep({ spentUsd, limits, stall, segmentsRun, maxSegments: MAX_EXPLORE_SEGMENTS });

    // For single-segment case with unparseable/empty AND no hard-stop, break immediately to preserve existing behavior
    if (segmentsRun === 1 && !parsed.ok && decision !== 'hard-stop') {
      break;
    }

    if (decision === 'hard-stop') {
      break; // Exit loop to terminal handling below
    }

    if (decision === 'wrap-up') {
      if (wrapUpSignalled) {
        // Wrap-up directive already sent and this segment has completed; exit now
        break;
      }
      // First time signalling wrap-up: set flag and rebuild spec with wrap-up directive
      wrapUpSignalled = true;
      curSpec = {
        ...curSpec,
        prompt: `${buildNodePrompt('explore', ctx.leaf)}\n\n${buildExploreWrapUpDirective()}`,
      };
      // Continue loop so wrap-up segment runs with the directive
      continue;
    }

    // decision === 'continue'
    continue;
  }

  // Terminal handling after loop breaks (hard-stop path)
  if (lastReport !== undefined) {
    if (lastParse && exploreAssertsFindings(lastParse)) {
      const rows = await (ctx.deps.findingsForLeaf ?? findBySourceLeafId)(ctx.project, ctx.leaf.id);
      const valid = rows.some(
        (r) => r.sourceLeafId === ctx.leaf.id && r.violatedClaim.trim() !== '' &&
          r.implicatedFiles.length > 0 && r.reproPath.trim() !== '',
      );
      if (!valid) return ctx.parkBlocked('explore-findings-claimed-no-typed-finding');
    }
    try {
      await ctx.deps.writeArtifact?.(cwd, exploreReportPath(ctx.leaf), lastReport);
    } catch (e) {
      return ctx.parkBlocked(`explore-report-write-failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return ctx.finalizeReportLeaf('pass', `explore: ${ctx.leaf.title ?? ctx.leaf.id}`);
  }

  // No parseable report was captured
  // For single-segment case with empty/unparseable report, preserve existing reason
  // (unless we hit the hard budget ceiling, which takes precedence)
  if (segmentsRun === 1 && lastParseFailReason) {
    // Check if hard ceiling was hit
    const limits = resolveExploreUsdLimits(process.env);
    if (spentUsd < limits.hardUsd) {
      // No hard ceiling; use the original single-segment reason
      return ctx.parkBlocked(
        lastParseFailReason === 'empty' ? 'explore-report-empty' : 'explore-report-unparseable',
      );
    }
  }

  // Multi-segment, hard budget ceiling, or single-segment-with-hard-budget
  return ctx.parkBlocked('explore-usd-ceiling-no-report');
}
