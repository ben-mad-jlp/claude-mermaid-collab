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
import { SplitProposalSchema, ResearchFindingsSchema, TestSpecSchema, VerifyVerdictSchema, ReviewVerdictSchema } from './schemas';
import { sameSignatures } from './helpers';
import type { SubloopRole } from './capabilities';
import type { WorkerCoreEventSink, PhaseRoute } from './events';

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
  /** The routing decision for a phase (provider + model + why) — observability only
   *  (north-star §6). Optional so the pure tests can omit it. */
  describeRoute?: (phase: SubloopRole) => PhaseRoute;
  /** The scoped mechanical gate over the lane change-set (tsc + scoped tests). */
  runScopedGate: (cwd: string) => Promise<GateOutcome>;
  /** Host-authoritative completion (wraps handleWorkerComplete → resolveCompletion). */
  completeAccepted: (project: string, todoId: string) => Promise<void>;
  /** Read worktree files (for the test-as-spec anti-tamper snapshot). Returns a map
   *  of path → content (null if absent). Optional: when omitted, the anti-tamper guard
   *  is skipped (e.g. pure tests). */
  readWorktreeFiles?: (cwd: string, paths: string[]) => Record<string, string | null>;
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
  `If the task is self-explanatory, do NOT explore at all. ` +
  `If this is a BEHAVIORAL change (it changes runtime behavior, not pure docs/config), FIRST call create_diagram with a SHORT before/after Mermaid flowchart capturing the behavior change (the DIAGRAM-AS-SPEC the reviewer will judge against), and put the returned id in specDiagramId. Skip the diagram for trivial/non-behavioral leaves. ` +
  `Then call the submit_verdict tool with your findings: ` +
  `{ "filesToEdit": string[], "plan": string, "testCommand"?: string, "behavioral": boolean, "specDiagramId"?: string }. Calling submit_verdict ENDS this phase.`;

const authorTestsPrompt = (s: TodoSpec, plan: string) =>
  `TASK (todo ${s.todoId}): ${s.title}\n${s.description ?? ''}\nPLAN: ${plan}\n\n` +
  `You author the EXECUTABLE SPEC: write FAILING test(s) that encode the REQUIRED behavior of this change (the contract the implementer must satisfy). Use the project's existing test framework/conventions (look at a sibling test for the imports + naming pattern, but do NOT append to it). Create a NEW, DEDICATED test file for THIS leaf (name it after the unit under test, e.g. the sibling convention applied to this change) — do NOT add your tests to an existing/shared test file. Write ONLY test files — do NOT implement the feature. ` +
  `Run the tests to confirm they FAIL for the right reason (the behavior doesn't exist yet), then \`git add -A && git commit -m "test: spec for ${s.todoId}"\` and STOP. ` +
  `Then call submit_verdict with { "wroteTests": boolean, "testFiles": string[], "testCommand"?: string } — testFiles = the exact paths you authored. If the leaf genuinely can't be expressed as a test, return wroteTests:false with empty testFiles.`;

const implementPrompt = (s: TodoSpec, plan: string, files: string[], specTestFiles: string[]) =>
  `TASK: ${s.title}\n\nIMPLEMENT this plan exactly (edit only these files: ${files.join(', ')}):\n${plan}\n\n` +
  (specTestFiles.length
    ? `These test files are the SPEC — make them PASS, and do NOT modify them (changing a spec test is drift and will be rejected): ${specTestFiles.join(', ')}\n\n`
    : '') +
  `Make the edits. If there are tests run them; if there are none, skip. Then run \`git add -A && git commit -m "<summary>"\` and STOP IMMEDIATELY — do not keep exploring or re-listing files. Do not report completion.`;

const verifyPrompt = (s: TodoSpec, plan: string, specDiagramId?: string) =>
  `SPEC: ${s.title}\nPLAN: ${plan}\n` +
  (specDiagramId ? `DIAGRAM-AS-SPEC: call get_diagram with id "${specDiagramId}" — the before/after contract; judge the change-set against it.\n` : '') +
  `\nYou did NOT write this code. Briefly + independently verify the change-set satisfies the spec (read/check as needed, but be concise — a few checks at most). ` +
  `Then call the submit_verdict tool with: { "pass": boolean, "failingChecks": string[], "errorSignatures": string[] }. ` +
  `Calling submit_verdict is the ONLY way to finish this phase — do it as soon as you have a verdict, do not keep re-checking.`;

const reviewPrompt = (s: TodoSpec, specDiagramId?: string) =>
  `SPEC: ${s.title}\n${s.description ?? ''}\n` +
  (specDiagramId ? `DIAGRAM-AS-SPEC: call get_diagram with id "${specDiagramId}" — the before/after contract to review completeness against.\n` : '') +
  `\nRead-only completeness review of the change-set vs the spec — missing cases / spec drift / stopped-early. ` +
  `Then call the submit_verdict tool with: { "complete": boolean, "gaps": string[] }. Calling it ENDS the phase.`;

export async function runWorkerCore(
  ctx: { project: string; todoId: string; cwd: string; session?: string; abortSignal?: AbortSignal; onEvent?: WorkerCoreEventSink },
  deps: WorkerCoreDeps,
): Promise<WorkerCoreOutcome> {
  const { project, todoId, cwd, session, abortSignal, onEvent } = ctx;
  const spec = deps.getTodo(project, todoId);
  if (!spec) return { outcome: 'noop', reason: 'todo not found' };

  // One fresh-context phase, with the per-phase model + routing decision (the latter
  // carried into the events purely for observability — north-star §6).
  const runPhase = <T>(role: SubloopRole, prompt: string, opts?: { schema?: import('zod').ZodType<T>; stepCap?: number }) =>
    spawnSubloop<T>(
      { cwd, model: deps.resolveModel(role), abortSignal, onEvent, route: deps.describeRoute?.(role), project, session },
      role,
      prompt,
      opts ?? {},
    );

  // 0. SIZE GATE → an oversized leaf files a SPLIT-PROPOSAL escalation (the planner
  //    promotes the drafted siblings) and the worker STOPS — it never grinds a whole
  //    epic or fans out writers itself (the worker-skill Step 1.5/4d discipline).
  const sizegate = await runPhase('sizegate', sizegatePrompt(spec), { schema: SplitProposalSchema, stepCap: 4 });
  if (sizegate.object?.oversized) {
    const subs = sizegate.object.subtasks ?? [];
    const detail =
      `leaf is oversized${sizegate.object.reason ? ` (${sizegate.object.reason})` : ''} — proposed split into ${subs.length} sub-tasks:\n` +
      subs.map((t) => `- ${t.title} [${t.files.join(', ')}]${t.type ? ` :${t.type}` : ''}`).join('\n');
    await deps.escalate(project, todoId, 'split-proposal', detail);
    return { outcome: 'escalated', kind: 'split-proposal', detail };
  }

  // 1. RESEARCH → typed findings (the per-todo blueprint).
  const research = await runPhase('research', researchPrompt(spec), { schema: ResearchFindingsSchema, stepCap: 4 });
  if (!research.object) {
    const detail = `research produced no valid findings: ${research.parseError ?? 'unknown'}`;
    await deps.escalate(project, todoId, 'research-failed', detail);
    return { outcome: 'escalated', kind: 'research-failed', detail };
  }
  const { plan, filesToEdit, specDiagramId } = research.object;

  // 1.5. TEST-AS-SPEC (behavioral leaves): the judgment-tier model AUTHORS failing
  //      tests = the executable contract; the implementer must pass them and must NOT
  //      weaken them (drift caught mechanically by the snapshot guard below). Best-
  //      effort — if no tests are authored, the recipe degrades to the prior flow.
  let specTestFiles: string[] = [];
  let specSnapshot: Record<string, string | null> = {};
  if (spec.behavioral || research.object.behavioral) {
    const authored = await runPhase('authortests', authorTestsPrompt(spec, plan), { schema: TestSpecSchema, stepCap: 10 });
    if (authored.object?.wroteTests && authored.object.testFiles.length > 0) {
      specTestFiles = authored.object.testFiles;
      specSnapshot = deps.readWorktreeFiles?.(cwd, specTestFiles) ?? {};
    }
  }

  // 2-3. IMPLEMENT → VERIFY → host fix loop (self-terminating).
  let lastSig: string[] | null = null;
  let converged = false;
  for (let attempt = 0; attempt < MAX_FIX_ATTEMPTS; attempt++) {
    await runPhase('implement', implementPrompt(spec, plan, filesToEdit, specTestFiles), { stepCap: 12 });

    // Anti-tamper: the authored spec tests must be byte-identical after implement —
    // an implementer that edits a spec test to make it pass is gaming the gate (the
    // bakeoff failure mode). A changed spec file → escalate, never silently accept.
    if (specTestFiles.length > 0 && deps.readWorktreeFiles) {
      const after = deps.readWorktreeFiles(cwd, specTestFiles);
      const tampered = specTestFiles.filter((f) => after[f] !== specSnapshot[f]);
      if (tampered.length > 0) {
        const detail = `implementer modified the spec tests (test-as-spec violation): ${tampered.join(', ')}`;
        await deps.escalate(project, todoId, 'test-tampering', detail);
        return { outcome: 'escalated', kind: 'test-tampering', detail };
      }
    }

    const verify = await runPhase('verify', verifyPrompt(spec, plan, specDiagramId), { schema: VerifyVerdictSchema, stepCap: 6 });
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
    const review = await runPhase('review', reviewPrompt(spec, specDiagramId), { schema: ReviewVerdictSchema });
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
