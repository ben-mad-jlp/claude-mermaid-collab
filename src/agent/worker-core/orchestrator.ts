/**
 * runWorkerCore — the host-owned state machine that IS the vibe-go recipe.
 *
 * The discipline lives here as deterministic TS control flow; the model is a leaf
 * called once per phase via spawnSubloop (fresh context each time). Completion is
 * HOST-authoritative (the model has no done-tool); the fix loop is HOST-owned and
 * self-terminating (same errors twice → escalate). Provider-agnostic: per-phase
 * models come from injected deps, so the state machine never names a provider.
 *
 * This first cut runs research → implement → verify → fix-loop → review(behavioral)
 * → complete. Deferred (need the collab funnel / split flow, not yet wired):
 * the size-gate split-proposal and the before/after diagram-as-spec — both enter as
 * additional phases without changing this control flow.
 */
import type { LanguageModel } from 'ai';
import { spawnSubloop } from './subloop';
import { ResearchFindingsSchema, VerifyVerdictSchema, ReviewVerdictSchema } from './schemas';
import { sameSignatures } from './helpers';
import type { SubloopRole } from './capabilities';

/** The minimal todo spec the recipe needs (title + description = the contract). */
export interface TodoSpec {
  todoId: string;
  title: string;
  description?: string;
  behavioral?: boolean;
}

export interface GateOutcome {
  pass: boolean;
  errorSignatures: string[];
}

/** Everything the orchestrator needs from the outside world — injected so the core
 *  is decoupled from the live coordinator and fully testable. */
export interface WorkerCoreDeps {
  getTodo: (project: string, todoId: string) => TodoSpec | null;
  /** Per-phase model (resolveModel + the tier matrix live behind this). */
  resolveModel: (phase: SubloopRole) => LanguageModel;
  /** The scoped mechanical gate over the lane change-set (tsc + scoped tests). */
  runScopedGate: (cwd: string) => Promise<GateOutcome>;
  /** Host-authoritative completion (wraps handleWorkerComplete → resolveCompletion). */
  completeAccepted: (project: string, todoId: string) => Promise<void>;
  /** Raise a structured blocker (the model never self-resolves). */
  escalate: (project: string, todoId: string, kind: string, detail: string) => Promise<void>;
}

export const MAX_FIX_ATTEMPTS = 3;

export type WorkerCoreOutcome =
  | { outcome: 'completed' }
  | { outcome: 'escalated'; kind: string; detail: string }
  | { outcome: 'noop'; reason: string };

const researchPrompt = (s: TodoSpec) =>
  `TASK (todo ${s.todoId}): ${s.title}\n${s.description ?? ''}\n\nResearch the change. Read the relevant files, then OUTPUT a JSON object: ` +
  `{ "filesToEdit": string[], "plan": string, "testCommand"?: string, "behavioral": boolean }. Output ONLY the JSON.`;

const implementPrompt = (s: TodoSpec, plan: string, files: string[]) =>
  `TASK: ${s.title}\n\nIMPLEMENT this plan exactly (edit only these files: ${files.join(', ')}):\n${plan}\n\n` +
  `Make the edits, run the tests, and commit. Do not report completion — stop when committed.`;

const verifyPrompt = (s: TodoSpec, plan: string) =>
  `SPEC: ${s.title}\nPLAN: ${plan}\n\nYou did NOT write this code. Independently verify the change-set satisfies the spec. ` +
  `Run the tests. OUTPUT JSON: { "pass": boolean, "failingChecks": string[], "errorSignatures": string[] }. Output ONLY the JSON.`;

const reviewPrompt = (s: TodoSpec) =>
  `SPEC: ${s.title}\n${s.description ?? ''}\n\nRead-only completeness review of the change-set vs the spec — find missing cases / spec drift / stopped-early. ` +
  `OUTPUT JSON: { "complete": boolean, "gaps": string[] }. Output ONLY the JSON.`;

export async function runWorkerCore(
  ctx: { project: string; todoId: string; cwd: string; abortSignal?: AbortSignal },
  deps: WorkerCoreDeps,
): Promise<WorkerCoreOutcome> {
  const { project, todoId, cwd, abortSignal } = ctx;
  const spec = deps.getTodo(project, todoId);
  if (!spec) return { outcome: 'noop', reason: 'todo not found' };

  // 1. RESEARCH → typed findings (the per-todo blueprint).
  const research = await spawnSubloop(
    { cwd, model: deps.resolveModel('research'), abortSignal },
    'research',
    researchPrompt(spec),
    { schema: ResearchFindingsSchema },
  );
  if (!research.object) {
    const detail = `research produced no valid findings: ${research.parseError ?? 'unknown'}`;
    await deps.escalate(project, todoId, 'research-failed', detail);
    return { outcome: 'escalated', kind: 'research-failed', detail };
  }
  const { plan, filesToEdit } = research.object;

  // 2-3. IMPLEMENT → VERIFY → host fix loop (self-terminating).
  let lastSig: string[] | null = null;
  let converged = false;
  for (let attempt = 0; attempt < MAX_FIX_ATTEMPTS; attempt++) {
    await spawnSubloop(
      { cwd, model: deps.resolveModel('implement'), abortSignal },
      'implement',
      implementPrompt(spec, plan, filesToEdit),
    );

    const verify = await spawnSubloop(
      { cwd, model: deps.resolveModel('verify'), abortSignal },
      'verify',
      verifyPrompt(spec, plan),
      { schema: VerifyVerdictSchema },
    );
    const gate = await deps.runScopedGate(cwd);

    if (verify.object?.pass === true && gate.pass) {
      converged = true;
      break;
    }

    const sig = [...(verify.object?.errorSignatures ?? []), ...gate.errorSignatures];
    if (lastSig && sameSignatures(sig, lastSig)) {
      const detail = `fix loop stuck — identical failures twice: ${sig.join('; ')}`;
      await deps.escalate(project, todoId, 'stuck', detail);
      return { outcome: 'escalated', kind: 'stuck', detail };
    }
    lastSig = sig;
  }
  if (!converged) {
    const detail = `fix loop did not converge in ${MAX_FIX_ATTEMPTS} attempts`;
    await deps.escalate(project, todoId, 'not-converged', detail);
    return { outcome: 'escalated', kind: 'not-converged', detail };
  }

  // 4. COMPLETENESS REVIEW (behavioral leaves only).
  if (spec.behavioral || research.object.behavioral) {
    const review = await spawnSubloop(
      { cwd, model: deps.resolveModel('review'), abortSignal },
      'review',
      reviewPrompt(spec),
      { schema: ReviewVerdictSchema },
    );
    if (review.object && review.object.complete === false && review.object.gaps.length > 0) {
      const detail = `completeness review found gaps: ${review.object.gaps.join('; ')}`;
      await deps.escalate(project, todoId, 'incomplete', detail);
      return { outcome: 'escalated', kind: 'incomplete', detail };
    }
  }

  // 5. HOST-AUTHORITATIVE COMPLETION (the model never had a done-tool).
  await deps.completeAccepted(project, todoId);
  return { outcome: 'completed' };
}
