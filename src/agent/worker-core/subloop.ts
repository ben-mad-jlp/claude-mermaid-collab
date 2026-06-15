/**
 * spawnSubloop — the keystone primitive: one fresh, capability-gated model call =
 * one vibe-go phase. A fresh `generateText` (no prior messages) IS a fresh-context
 * agent; that is how the recipe survives without an Agent() tool (design-grok-worker-
 * discipline §0). The host calls this once per phase; a subloop is NEVER a
 * model-facing tool, so it cannot recurse (depth ≤ 1 by construction).
 *
 * Typed outputs: a schema phase gets a `submit_verdict` TOOL whose input IS the
 * schema. Calling it captures the (SDK-validated) verdict and ENDS the phase
 * (hasToolCall stop). This FORCES structure — proven necessary live: grok-build
 * tool-loops and won't reliably terminate a phase with freeform JSON text. A
 * text-JSON fallback remains for models that answer in prose. Either way a missing/
 * malformed verdict fails SAFE (`object` undefined + `parseError`) so the host
 * escalates rather than trusting an unparseable "pass".
 */
import { generateText, stepCountIs, hasToolCall, tool, type LanguageModel, type Tool } from 'ai';
import type { z } from 'zod';
import { buildToolset } from './tools/registry';
import type { SubloopRole } from './capabilities';
import { EVENT_RESULT_CAP, type WorkerCoreEventSink } from './events';

export interface SubloopCtx {
  /** The lane's worktree root (tools are scoped under it). */
  cwd: string;
  /** The model for this phase (from resolveModel — per-phase routing lives here). */
  model: LanguageModel;
  abortSignal?: AbortSignal;
  /** Observability sink (north-star §6); per-step tool calls/results/usage flow here. */
  onEvent?: WorkerCoreEventSink;
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
  const tools: Record<string, Tool> = { ...buildToolset(role, { cwd: ctx.cwd }) }; // fresh, capability-gated
  const now = () => Date.now();
  ctx.onEvent?.({ type: 'phase-start', role, ts: now() });

  // FORCED structured output: a schema phase gets a submit_verdict tool whose input
  // IS the schema. Calling it captures the SDK-validated verdict and ends the phase.
  const SUBMIT = 'submit_verdict';
  let captured: T | undefined;
  if (opts.schema) {
    tools[SUBMIT] = tool({
      description:
        'Submit your FINAL structured result for this phase. Call this EXACTLY ONCE when finished — it ENDS the phase and is the ONLY way to complete it. Do not answer in prose.',
      inputSchema: opts.schema,
      execute: async (args) => {
        captured = args as T;
        return 'verdict recorded — phase ending';
      },
    });
  }

  const stepCap = opts.stepCap ?? 8;
  const res = await generateText({
    model: ctx.model,
    tools,
    system: opts.system,
    prompt, // no prior messages → fresh context (the verify-independence guarantee)
    stopWhen: opts.schema ? [stepCountIs(stepCap), hasToolCall(SUBMIT)] : stepCountIs(stepCap),
    abortSignal: ctx.abortSignal,
    onStepFinish: ctx.onEvent
      ? (step) => {
          ctx.onEvent?.({
            type: 'step',
            role,
            ts: now(),
            text: step.text || undefined,
            toolCalls: step.toolCalls?.map((c) => ({ name: c.toolName, args: c.input })),
            toolResults: step.toolResults?.map((r) => {
              const o = (r as { output?: unknown }).output;
              const s = typeof o === 'string' ? o : JSON.stringify(o ?? null);
              return { name: r.toolName, result: s.length > EVENT_RESULT_CAP ? `${s.slice(0, EVENT_RESULT_CAP)}…` : s };
            }),
            usage: {
              inputTokens: step.usage?.inputTokens,
              outputTokens: step.usage?.outputTokens,
              totalTokens: step.usage?.totalTokens,
            },
          });
        }
      : undefined,
  });

  const out: SubloopResult<T> = {
    text: res.text,
    steps: res.steps.length,
    finishReason: res.finishReason ?? 'unknown',
  };

  if (opts.schema) {
    if (captured !== undefined) {
      out.object = captured; // already validated by the submit_verdict tool's schema
    } else {
      // Fallback: the model answered in prose/JSON instead of calling submit_verdict.
      const parsed = tolerantJsonParse(res.text);
      if (!parsed.ok) {
        out.parseError = parsed.error;
      } else {
        const validated = opts.schema.safeParse(parsed.value);
        if (!validated.success) out.parseError = validated.error.message;
        else out.object = validated.data;
      }
    }
  }
  ctx.onEvent?.({ type: 'phase-end', role, ts: now(), steps: out.steps, text: out.text, parseError: out.parseError });
  return out;
}
