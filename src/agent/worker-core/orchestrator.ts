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
import { SplitProposalSchema, ResearchFindingsSchema, VerifyVerdictSchema, ReviewVerdictSchema } from './schemas';
import { sameSignatures } from './helpers';
import type { SubloopRole } from './capabilities';
import type { WorkerCoreEventSink } from './events';

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

const sizegatePrompt = (s: TodoSpec) =>
  `TASK (todo ${s.todoId}): ${s.title}\n${s.description ?? ''}\n\n` +
  `Assess SIZE ONLY — is this leaf too big for ONE worker pass? Too big = ~4+ edit-INDEPENDENT files, OR it spans different work types (e.g. backend + ui), OR a wide many-site migration. Do MINIMAL read-only exploration. ` +
  `Then call submit_verdict with { "oversized": boolean, "reason"?: string, "subtasks": [{ "title": string, "files": string[], "type"?: string }] }. ` +
  `If it is a coherent single change, return oversized:false with an empty subtasks list. Only propose a split when the parallelism is REAL (file-disjoint siblings).`;

const researchPrompt = (s: TodoSpec) =>
  `TASK (todo ${s.todoId}): ${s.title}\n${s.description ?? ''}\n\n` +
  `Do MINIMAL exploration — at most 1-2 read-only commands, ONLY inside the current worktree (NEVER explore the wider filesystem with paths like / or /app). ` +
  `If the task is self-explanatory, do NOT explore at all. Then call the submit_verdict tool with your findings: ` +
  `{ "filesToEdit": string[], "plan": string, "testCommand"?: string, "behavioral": boolean }. Calling submit_verdict ENDS this phase.`;

const implementPrompt = (s: TodoSpec, plan: string, files: string[]) =>
  `TASK: ${s.title}\n\nIMPLEMENT this plan exactly (edit only these files: ${files.join(', ')}):\n${plan}\n\n` +
  `Make the edits. If there are tests run them; if there are none, skip. Then run \`git add -A && git commit -m "<summary>"\` and STOP IMMEDIATELY — do not keep exploring or re-listing files. Do not report completion.`;

const verifyPrompt = (s: TodoSpec, plan: string) =>
  `SPEC: ${s.title}\nPLAN: ${plan}\n\nYou did NOT write this code. Briefly + independently verify the change-set satisfies the spec (read/check as needed, but be concise — a few checks at most). ` +
  `Then call the submit_verdict tool with: { "pass": boolean, "failingChecks": string[], "errorSignatures": string[] }. ` +
  `Calling submit_verdict is the ONLY way to finish this phase — do it as soon as you have a verdict, do not keep re-checking.`;

const reviewPrompt = (s: TodoSpec) =>
  `SPEC: ${s.title}\n${s.description ?? ''}\n\nRead-only completeness review of the change-set vs the spec — missing cases / spec drift / stopped-early. ` +
  `Then call the submit_verdict tool with: { "complete": boolean, "gaps": string[] }. Calling it ENDS the phase.`;

export async function runWorkerCore(
  ctx: { project: string; todoId: string; cwd: string; abortSignal?: AbortSignal; onEvent?: WorkerCoreEventSink },
  deps: WorkerCoreDeps,
): Promise<WorkerCoreOutcome> {
  const { project, todoId, cwd, abortSignal, onEvent } = ctx;
  const spec = deps.getTodo(project, todoId);
  if (!spec) return { outcome: 'noop', reason: 'todo not found' };

  // 0. SIZE GATE → an oversized leaf files a SPLIT-PROPOSAL escalation (the planner
  //    promotes the drafted siblings) and the worker STOPS — it never grinds a whole
  //    epic or fans out writers itself (the worker-skill Step 1.5/4d discipline).
  const sizegate = await spawnSubloop(
    { cwd, model: deps.resolveModel('sizegate'), abortSignal, onEvent },
    'sizegate',
    sizegatePrompt(spec),
    { schema: SplitProposalSchema, stepCap: 4 },
  );
  if (sizegate.object?.oversized) {
    const subs = sizegate.object.subtasks ?? [];
    const detail =
      `leaf is oversized${sizegate.object.reason ? ` (${sizegate.object.reason})` : ''} — proposed split into ${subs.length} sub-tasks:\n` +
      subs.map((t) => `- ${t.title} [${t.files.join(', ')}]${t.type ? ` :${t.type}` : ''}`).join('\n');
    await deps.escalate(project, todoId, 'split-proposal', detail);
    return { outcome: 'escalated', kind: 'split-proposal', detail };
  }

  // 1. RESEARCH → typed findings (the per-todo blueprint).
  const research = await spawnSubloop(
    { cwd, model: deps.resolveModel('research'), abortSignal, onEvent },
    'research',
    researchPrompt(spec),
    { schema: ResearchFindingsSchema, stepCap: 4 },
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
      { cwd, model: deps.resolveModel('implement'), abortSignal, onEvent },
      'implement',
      implementPrompt(spec, plan, filesToEdit),
      { stepCap: 12 },
    );

    const verify = await spawnSubloop(
      { cwd, model: deps.resolveModel('verify'), abortSignal, onEvent },
      'verify',
      verifyPrompt(spec, plan),
      { schema: VerifyVerdictSchema, stepCap: 6 },
    );
    const gate = await deps.runScopedGate(cwd);

    if (verify.object?.pass === true && gate.pass) {
      converged = true;
      break;
    }

    // A verify that produced no parseable verdict is a DISTINCT failure (not an
    // empty signature) — otherwise empty-vs-empty would falsely read as "stuck".
    const verifySigs = verify.object
      ? verify.object.errorSignatures
      : [`verify-output-unparseable:${verify.parseError ?? 'unknown'}`];
    const sig = [...verifySigs, ...gate.errorSignatures];
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
      { cwd, model: deps.resolveModel('review'), abortSignal, onEvent },
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
