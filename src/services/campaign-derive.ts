/**
 * campaign-derive.ts — LLM-based derivation of probes or questions from a goal.
 *
 * Given a campaign goal, derive either:
 * - A set of concrete probes (deterministic checks) if the goal is specific enough.
 * - A list of clarifying questions if the goal is ambiguous.
 *
 * The two-arm rule: ambiguity about WHAT to measure (which artifact, which target) →
 * questions. Ambiguity only about HOW to measure (which command, which flags) → probes
 * (pick a mechanism). Never mix the arms in a single reply.
 *
 * Pure w.r.t. the store: imports only JudgmentLLM type and validateCampaign +
 * ProbeForgeInput (whose extends already re-exports ProbeInput fields).
 */

import type { JudgmentLLM } from './judgment-llm.ts';
import { validateCampaign, type ProbeForgeInput } from './campaign-validate.ts';

export type DeriveResult =
  | { kind: 'probes'; probes: ProbeForgeInput[] }
  | { kind: 'questions'; questions: string[] };

/**
 * Build the system and user prompts for probe/question derivation.
 * The system prompt fixes the reply contract to ONE JSON object, either probes or
 * questions, names the two-arm rule (WHAT vs HOW), and pins the closed unions
 * (kind='command', environment='worktree'|'rig', acyclic dependsOn graph).
 * The user prompt embeds the goal verbatim under a labelled section.
 */
export function buildDerivePrompt(goal: string): { system: string; user: string } {
  const system = `You are a campaign goal-to-probes translator. Your task is to convert a campaign goal into either a concrete set of probes (deterministic checks) or a list of clarifying questions.

Respond with a single JSON object in exactly ONE of these formats:

Probes format:
{"probes":[{"ref":"probe1","kind":"command","environment":"worktree"|"rig","command":"...","dependsOn":["ref2"],"declaredPaths":["path"],"asserts":"..."},…]}

Questions format:
{"questions":["What is the target system?","How should we verify X?",…]}

Rules:
- Ambiguity about WHAT to measure (which artifact, which target, which candidate subject) → return questions.
- Ambiguity only about HOW to measure (which command, which runner flags, which path) → return probes; pick a mechanism.
- NEVER mix probes and questions in a single reply.
- kind is always "command".
- environment is "worktree" or "rig" only; no other values.
- ref entries must be unique within a single reply.
- dependsOn entries must name sibling ref values in the same reply; the graph must be acyclic (no cycles).
- Omit dependsOn, declaredPaths, and asserts if not needed (they are optional).
- If returning probes, all of them must be evaluable with confidence.`;

  const user = `Campaign Goal:
${goal}

Based on the goal above, derive either a concrete set of probes or a list of clarifying questions. If you cannot measure the goal with confidence, return questions. If you need to resolve ambiguity about what is being measured, return questions. Only return probes if the goal is specific about the subject, target, and artifact.`;

  return { system, user };
}

/**
 * Extract the first JSON object from text, tolerating surrounding prose or markdown fences.
 * Uses a brace-balanced scanner to handle nested objects (unlike a simple regex that cannot
 * match depth > 1). Skips string literals and backslash escapes.
 *
 * Returns null if no JSON object is found.
 */
function extractJsonObject(text: string): any | null {
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let i = firstBrace;

  while (i < text.length) {
    const char = text[i];

    // Skip escape sequences (backslash-anything).
    if (inString && char === '\\' && i + 1 < text.length) {
      i += 2;
      continue;
    }

    // Toggle string state on unescaped quotes.
    if (char === '"' && (i === 0 || text[i - 1] !== '\\')) {
      inString = !inString;
      i++;
      continue;
    }

    // Only track braces outside strings.
    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          // Found the matching close. Try to parse what we've collected.
          try {
            const slice = text.slice(firstBrace, i + 1);
            return JSON.parse(slice);
          } catch {
            return null;
          }
        }
      }
    }

    i++;
  }

  return null;
}

/**
 * Derive a probe set or question list from a campaign goal.
 *
 * 1. Builds the prompt from the goal.
 * 2. Calls opts.llm.complete (wrapped in try/catch — throw, empty reply, or
 *    unparseable reply falls to the questions arm).
 * 3. Extracts the first JSON object using brace-balanced scanning.
 * 4. If parsed.probes is non-empty array: coerce to ProbeForgeInput, validate with
 *    validateCampaign, return if ok. Otherwise fall to questions arm.
 * 5. If parsed.questions is array with ≥1 non-blank string: return it.
 * 6. Every other outcome returns questions arm with a synthesized fallback question.
 *
 * The function never rejects and never returns {kind:'probes', probes:[]}.
 */
export async function deriveProbeSet(goal: string, opts: { llm: JudgmentLLM }): Promise<DeriveResult> {
  const { system, user } = buildDerivePrompt(goal);

  try {
    const reply = await opts.llm.complete(system, user);

    if (!reply || !reply.trim()) {
      return { kind: 'questions', questions: [`How should we measure: ${goal}?`] };
    }

    const parsed = extractJsonObject(reply);
    if (!parsed) {
      return { kind: 'questions', questions: [`How should we measure: ${goal}?`] };
    }

    // Try probes arm.
    if (Array.isArray(parsed.probes) && parsed.probes.length > 0) {
      const probes: ProbeForgeInput[] = parsed.probes.map((p: any) => ({
        ref: String(p.ref || ''),
        kind: p.kind || 'command',
        environment: p.environment || 'worktree',
        command: p.command ? String(p.command) : undefined,
        dependsOn: Array.isArray(p.dependsOn) ? p.dependsOn : undefined,
        declaredPaths: Array.isArray(p.declaredPaths) ? p.declaredPaths : undefined,
        asserts: p.asserts ? String(p.asserts) : undefined,
      }));

      const validation = validateCampaign({ title: goal, goal, probes });
      if (validation.ok) {
        return { kind: 'probes', probes };
      }

      // Validation failed — return the offenders as a fallback question.
      const reasons = validation.offenders.map((o) => o.reason).join('; ');
      return {
        kind: 'questions',
        questions: [`The derived probes had validation errors: ${reasons}. Can you clarify the goal?`],
      };
    }

    // Try questions arm.
    if (Array.isArray(parsed.questions)) {
      const questions = parsed.questions
        .filter((q: any) => typeof q === 'string' && q.trim())
        .map((q: string) => q.trim());
      if (questions.length > 0) {
        return { kind: 'questions', questions };
      }
    }

    // Fallback: neither arm was usable.
    return { kind: 'questions', questions: [`How should we measure: ${goal}?`] };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { kind: 'questions', questions: [`Goal derivation failed (${reason}). Can you clarify: ${goal}?`] };
  }
}
