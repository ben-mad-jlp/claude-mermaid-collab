/**
 * spawnSubloop — the keystone primitive: one fresh, capability-gated model call =
 * one vibe-go phase. A fresh `generateText` (no prior messages) IS a fresh-context
 * agent; that is how the recipe survives without an Agent() tool (design-grok-worker-
 * discipline §0). The host calls this once per phase; a subloop is NEVER a
 * model-facing tool, so it cannot recurse (depth ≤ 1 by construction).
 *
 * Typed outputs: rather than a version-sensitive structured-output API, the model
 * emits JSON which we tolerantly parse + Zod-validate. A malformed verdict fails
 * SAFE — `object` is undefined + `parseError` is set, so the host escalates rather
 * than trusting an unparseable "pass".
 */
import { generateText, stepCountIs, type LanguageModel } from 'ai';
import type { z } from 'zod';
import { buildToolset } from './tools/registry';
import type { SubloopRole } from './capabilities';

export interface SubloopCtx {
  /** The lane's worktree root (tools are scoped under it). */
  cwd: string;
  /** The model for this phase (from resolveModel — per-phase routing lives here). */
  model: LanguageModel;
  abortSignal?: AbortSignal;
}

export interface SubloopOpts<T> {
  /** Max agentic steps for this phase (small, per-phase — not the whole-todo budget). */
  stepCap?: number;
  /** Optional system prompt. */
  system?: string;
  /** When set, the final text is parsed + validated; failure ⇒ parseError (fail-safe). */
  schema?: z.ZodType<T>;
}

export interface SubloopResult<T> {
  text: string;
  object?: T;
  /** Set when a schema was requested but the output could not be parsed/validated. */
  parseError?: string;
  steps: number;
  finishReason: string;
}

type ParseOutcome = { ok: true; value: unknown } | { ok: false; error: string };

/** Extract the first JSON object from model text (tolerant of code fences + prose). */
export function tolerantJsonParse(text: string): ParseOutcome {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return { ok: false, error: 'no JSON object found in model output' };
  }
  try {
    return { ok: true, value: JSON.parse(candidate.slice(start, end + 1)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function spawnSubloop<T = unknown>(
  ctx: SubloopCtx,
  role: SubloopRole,
  prompt: string,
  opts: SubloopOpts<T> = {},
): Promise<SubloopResult<T>> {
  const tools = buildToolset(role, { cwd: ctx.cwd }); // fresh, capability-gated per phase
  const res = await generateText({
    model: ctx.model,
    tools,
    system: opts.system,
    prompt, // no prior messages → fresh context (the verify-independence guarantee)
    stopWhen: stepCountIs(opts.stepCap ?? 8),
    abortSignal: ctx.abortSignal,
  });

  const out: SubloopResult<T> = {
    text: res.text,
    steps: res.steps.length,
    finishReason: res.finishReason ?? 'unknown',
  };

  if (opts.schema) {
    const parsed = tolerantJsonParse(res.text);
    if (!parsed.ok) {
      out.parseError = parsed.error;
      return out;
    }
    const validated = opts.schema.safeParse(parsed.value);
    if (!validated.success) {
      out.parseError = validated.error.message;
      return out;
    }
    out.object = validated.data;
  }
  return out;
}
