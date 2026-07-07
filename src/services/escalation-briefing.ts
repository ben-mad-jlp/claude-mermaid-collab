/**
 * Escalation briefing generator (epic 40771aab, Phase B).
 *
 * When an escalation routes to the HUMAN, one `questionText` sentence isn't enough
 * to decide on. This produces a DEEP markdown briefing — Decision / Situation /
 * System context / Recommendation — over the enriched TriageBundle (grok-triage
 * packBundle). It is the SYNTHESIS layer ABOVE the deterministic floor
 * (escalation-briefing-md.renderBundleMarkdown), never a replacement: the raw
 * bundle stays visible beneath it in the UI for verification.
 *
 * GUARDRAILS (from the Grok skeptical consult, doc escalation-briefing-grok-synthesis
 * — the LLM must ground, not invent):
 *  - Options are DETERMINISTIC — they come from `escalation.options[]`. The model
 *    only EXPLAINS each option's consequence; it must NEVER mint new options.
 *  - Facts vs opinion are separated: Situation/System quote the bundle; the
 *    Recommendation is explicitly labelled as the steward's opinion.
 *  - Use ONLY the bundle. If a fact isn't present, say so — do not guess.
 *
 * COST/RELIABILITY: generated LAZILY on first human open and cached on the
 * escalation row (setEscalationBriefing), so we never pay for briefings the human
 * never reads. FAIL-OPEN: any LLM/error path degrades to the deterministic floor
 * markdown, so the human always gets at least the structured facts.
 *
 * Model is the SAME swappable triage tier-role as the classifier
 * (resolveTriageRoute → makeJudgmentLLM); a dedicated `briefing` role was judged
 * premature. Pure/injectable: the LLM call + bundle packer are behind deps.
 */

import type { Escalation } from './supervisor-store.ts';
import { getEscalation, setEscalationBriefing } from './supervisor-store.ts';
import { packBundle, type TriageBundle, type TriageDeps } from './grok-triage.ts';
import { renderBundleMarkdown } from './escalation-briefing-md.ts';
import { resolveTriageRoute } from './config-service.ts';
import { makeJudgmentLLM } from './judgment-llm.ts';

export interface BriefingDeps extends TriageDeps {
  /** Single-shot LLM call: (system, user) → raw markdown reply. Injectable for tests. */
  callLLM?: (system: string, user: string) => Promise<string>;
  /** Provenance label for the model that produced a briefing. */
  modelLabel?: string;
}

export interface BriefingResult {
  md: string;
  model: string;
  /** True when returned from cache (no LLM call this invocation). */
  cached: boolean;
  at: number;
}

export const BRIEFING_SYSTEM_PROMPT = `You are writing a concise DECISION BRIEFING for a HUMAN operator of an autonomous software work-orchestration system. An escalation (a blocker/question the daemon could not resolve) has been routed to the human. Your job is to let them decide FAST and CORRECTLY.

Use ONLY facts present in the ground-truth bundle. If a fact is not in the bundle, write "not available" — never guess or invent.

Output GitHub-flavoured markdown with EXACTLY these four sections, in order:

## Decision
Restate, in one or two sentences, exactly what is being decided. Then, if the bundle's escalation has options, list EACH given option verbatim and, for each, one line on its likely consequence/tradeoff. Do NOT invent options that are not in the bundle — the options are fixed; you only explain them. If there are no options, state what a free-form answer would need to supply.

## Situation
The chain of events that led here: the linked todo (title/status/retries), what failed (from raiseDetail — gate/tsc output, error, verdict, conflict files), and git drift (commits behind master). Quote concrete values.

## System context
Where this sits in the system: the plan-graph neighbours (parent epic, siblings, and especially DEPENDENTS that are blocked on this — the blast radius), the epic branch health (ahead/behind/mergeable/stranded), and how many prior related escalations there were. Make the blast radius explicit.

## Recommendation
Your suggested course of action and WHY, in 2-4 sentences. Begin this section with the exact line "_Steward's recommendation — a suggestion, not a fact:_" so the human knows this is opinion, not ground truth. If the bundle carries a suggestedAction, weigh it. If you genuinely cannot recommend from the bundle, say so and name what additional info a human would need.

Be terse. Prefer bullet points and concrete values over prose. Never exceed what the bundle supports.`;

function buildUserPrompt(bundle: TriageBundle, esc: Escalation): string {
  // Surface the deterministic options explicitly so the model cannot drift on them.
  const options = esc.options && esc.options.length
    ? esc.options.map((o) => `- id=${o.id}: ${o.label}${(o as { detail?: string }).detail ? ` — ${(o as { detail?: string }).detail}` : ''}`).join('\n')
    : '(none — free-form question)';
  return [
    `Ground-truth bundle (JSON):`,
    JSON.stringify(bundle, null, 2),
    ``,
    `The escalation's fixed options (use these verbatim; do NOT invent others):`,
    options,
    ``,
    `Write the four-section briefing now.`,
  ].join('\n');
}

function defaultCallLLM(project: string): (system: string, user: string) => Promise<string> {
  return (system, user) => makeJudgmentLLM(resolveTriageRoute({ project })).complete(system, user);
}

function routeLabel(project: string): string {
  try {
    const cfg = resolveTriageRoute({ project }) as { provider?: string; model?: string };
    return [cfg.provider, cfg.model].filter(Boolean).join('/') || 'triage-role';
  } catch {
    return 'triage-role';
  }
}

/**
 * Generate the briefing markdown for one escalation (no caching — always calls the
 * LLM). FAILS OPEN: on any error, returns the deterministic floor markdown so the
 * human always gets the structured facts. Returns the markdown + the model label.
 */
export async function generateBriefingMarkdown(
  project: string,
  esc: Escalation,
  deps: BriefingDeps = {},
): Promise<{ md: string; model: string }> {
  const bundle = packBundle(project, esc, deps);
  const floor = () => renderBundleMarkdown(bundle, { options: esc.options ?? null });
  const call = deps.callLLM ?? defaultCallLLM(project);
  const model = deps.modelLabel ?? routeLabel(project);
  let raw: string;
  try {
    raw = await call(BRIEFING_SYSTEM_PROMPT, buildUserPrompt(bundle, esc));
  } catch {
    // Fail open to the deterministic floor — the human still sees the facts.
    return { md: floor(), model: `${model} (fallback: deterministic floor)` };
  }
  const md = (raw ?? '').trim();
  if (!md || !md.includes('##')) {
    // Empty / non-markdown reply → floor, so we never cache a useless briefing.
    return { md: floor(), model: `${model} (fallback: deterministic floor)` };
  }
  return { md, model };
}

/**
 * Lazy + cached briefing accessor — the entry point MCP/REST call. Returns the
 * cached `briefingMd` if present (unless `refresh`), else generates it, stores it on
 * the escalation, and returns it. Throws only if the escalation id is unknown.
 */
export async function briefEscalation(
  project: string,
  escalationId: string,
  opts: { refresh?: boolean; deps?: BriefingDeps } = {},
): Promise<BriefingResult> {
  const esc = getEscalation(escalationId);
  if (!esc) throw new Error(`escalation not found: ${escalationId}`);
  if (!opts.refresh && esc.briefingMd) {
    return { md: esc.briefingMd, model: esc.briefingModel ?? 'unknown', cached: true, at: esc.briefingAt ?? 0 };
  }
  const { md, model } = await generateBriefingMarkdown(project, esc, opts.deps);
  const at = Date.now();
  setEscalationBriefing(escalationId, md, model, at);
  return { md, model, cached: false, at };
}
