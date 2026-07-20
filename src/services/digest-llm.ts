/**
 * Production DigestLlm — the single bounded model call that fills the project digest's
 * dir purposes + seams. Reuses the daemon's cheap/fast TRIAGE tier-role via
 * makeJudgmentLLM(resolveTriageRoute) — the SAME mechanism escalation-briefing.ts uses —
 * so there is no new provider path. Output is parsed into DigestSynthesis; boundSynthesis
 * (in project-digest) caps it. All failure paths are the caller's concern: the returned
 * DigestLlm THROWS on a bad/empty parse so regenerateProjectDigest surfaces it and the
 * advisory land catch swallows it (a refresh must never fail a land).
 */
import type { DigestLlm, DigestSynthesis } from './project-digest.ts';
import { resolveTriageRoute } from './config-service.ts';
import { makeJudgmentLLM } from './judgment-llm.ts';
import { recordSpend } from './spend-ledger.ts';

export const DIGEST_SYSTEM_PROMPT = `You are writing terse ORIENTATION HINTS for a code project.

For each given top-level directory, write a ONE-LINE purpose (max 100 chars). Omit only if you truly cannot tell.

For "seams", distil KEY CONVENTIONS and ARCHITECTURAL BOUNDARIES from the CLAUDE.md file provided. These are the critical rules that prevent bugs — e.g. "use npm version for bumps", "never mock the database", "every todo needs an epic". Aim for 2-8 short bullets.

Return ONLY a JSON object of the exact shape:
{ "dirPurposes": { "<dir>": "<one-line purpose>", ... }, "seams": ["<short seam/convention>", ...] }

No prose outside the JSON. No markdown fences.`;

export function buildDigestUserPrompt(input: {
  claudeMd: string;
  dirs: string[];
  sample: string;
}): string {
  return [
    `Top-level directories (give a one-line purpose for each):`,
    input.dirs.map((d) => `- ${d}`).join('\n') || '(none)',
    ``,
    `CLAUDE.md (distil seams/conventions from this; may be empty):`,
    input.claudeMd || '(none)',
    ``,
    `Return the JSON object now.`,
  ].join('\n');
}

export function parseDigestSynthesis(raw: string): DigestSynthesis {
  const text = (raw ?? '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('digest llm: no JSON object in reply');
  const obj = JSON.parse(text.slice(start, end + 1)) as Partial<DigestSynthesis>;
  const dirPurposes: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj.dirPurposes ?? {})) {
    if (typeof v === 'string' && v.trim()) dirPurposes[k] = v.trim();
  }
  const seams = Array.isArray(obj.seams)
    ? obj.seams.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
  return { dirPurposes, seams };
}

/**
 * Build the production DigestLlm for a project. `callLLM` is injectable purely for tests;
 * the default is the bounded triage-tier one-shot (makeJudgmentLLM + resolveTriageRoute).
 */
export function makeDigestLlm(
  project: string,
  callLLM?: (system: string, user: string) => Promise<string>,
): DigestLlm {
  const call =
    callLLM ??
    ((system, user) => {
      const route = resolveTriageRoute({ project });
      return makeJudgmentLLM({
        ...route,
        // Track the project-digest LLM call's spend (source 'digest').
        onUsage: (u) => recordSpend({ project, source: 'digest', provider: route.provider, model: route.model, usage: u }),
      }).complete(system, user);
    });
  return async (input) => parseDigestSynthesis(await call(DIGEST_SYSTEM_PROMPT, buildDigestUserPrompt(input)));
}
