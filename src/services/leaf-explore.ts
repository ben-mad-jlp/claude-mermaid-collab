import type { LeafRunContext, LeafRunResult } from './leaf-executor';
import type { NodeSpec } from '../agent/node-invoker';
import type { WorktreeManager } from '../agent/worktree-manager';
import { mcpConfigFor, classifyWorktreeAddFault } from '../agent/node-invoker';
import { config } from '../config';
import { NODE_PROFILE, leafTranscriptPath } from './leaf-node-profile';
import { buildNodePrompt, exploreReportPath } from './leaf-prompts';
import { parseExploreReport } from './leaf-parsing';
import { composeInjectedContext } from './prompt-injection';
import { getInjectionFlags } from './runtime-config';
import { resolveNodePermissionMode } from './node-permission-mode';

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
  const spec: NodeSpec = {
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
  const res = await ctx.runNode('explore', spec);
  if (res.startFailure) return ctx.parkNodeStartFailure('explore', res);
  if (res.rateLimited) return ctx.pausedResult('explore', res);
  if (!ctx.checkBudget()) return ctx.parkBlocked('node-budget-exhausted');
  if (!res.ok) return ctx.parkBlocked('explore-node-failed');

  const parsed = parseExploreReport(res.text);
  if (!parsed.ok) {
    return ctx.parkBlocked(
      parsed.reason === 'empty' ? 'explore-report-empty' : 'explore-report-unparseable',
    );
  }
  try {
    await ctx.deps.writeArtifact?.(cwd, exploreReportPath(ctx.leaf), parsed.report);
  } catch (e) {
    return ctx.parkBlocked(`explore-report-write-failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return ctx.finalizeReportLeaf('pass', `explore: ${ctx.leaf.title ?? ctx.leaf.id}`);
}
