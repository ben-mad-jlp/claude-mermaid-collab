> **SCOPE NOTE (post-session evolution):** this doc was written for grok-own.ts, but the architecture
> evolved to DAEMON-NATIVE-FOR-ALL-PROVIDERS (`design-northstar-worker-fabric` §3). This recipe is now
> a REQUIREMENT on EVERY provider's in-process worker, not a grok detail — the orchestrator/spawnSubloop
> state machine below is to be GENERALIZED into a shared in-process worker (e.g. `src/agent/worker-core`)
> that every adapter uses; `xai(...)` becomes `resolveModel(provider, model)`. The recipe is canonical
> in north-star §1 ("REQUIRED: every in-process worker runs the vibe-blueprint + vibe-go recipe").

# Porting vibe-blueprint + vibe-go discipline into the in-process Grok/Vercel-AI-SDK worker

## 0. The answer (verdict on Agent()-less feasibility)

**Yes — the blueprint+go discipline survives without `Agent()`, fully and faithfully, but only on one condition: the control flow moves OUT of the model and into the harness.** A fresh `generateText` call IS a fresh-context agent; the SDK already gives us the one primitive vibe-go actually depends on. What `Agent()` provided was never magic — it was (a) a fresh `messages` array, (b) a restricted toolset, (c) a depth/recursion sandbox. All three are reproducible in-process: fresh messages by starting a new call, restricted tools by omission from the per-call `tools` map, the sandbox by making the spawn primitive host-only (never model-invokable) and read-only by default.

The discipline does NOT survive if we keep the single flat 50-step loop and try to prompt the discipline back in — that concept (`enforced-gate-single-loop`) concedes by its own admission the two things the question says are fatal to lose: context-freshness and verify-independence-of-judgment. The model already ignores the numbered STEP 1-5 prompt today; a longer prompt will not fix sequencing the model is structurally free to violate.

So: **the discipline becomes a deterministic TypeScript state machine in `runLoop`; the model is demoted to a stateless leaf that does the work *inside* one phase.** Determinism lives where vibe-go's main context lives. Swapping `grok-build-0.1` → `codex` → a future model changes WHICH model answers a leaf, never WHETHER the discipline holds.

## 1. Vision

`GrokOwnHarness.runLoop` today is exactly the anti-pattern vibe-go was built to avoid: one `generateText`, one prompt, all five tools live for all 50 steps. It works at all only because completion is server-authoritative (`handleWorkerComplete` → `resolveCompletion` re-runs the real gate); the loop's discipline is *entirely outsourced* to the resolver. That is fragile — the resolver checks "tsc + scoped tests pass," not "did you build the right thing per the diagram," and gives the model no structured chance to fix-with-fresh-eyes before the verdict.

We rebuild `runLoop` as a **host-owned orchestrator** that fires one short, single-purpose `generateText` per vibe-go phase, each via a single primitive — `spawnSubloop` — that is the largest *safe* subset of `Agent()`. The phases ARE the discipline; the SDK gives fresh context for free by starting a new call. Nothing above the `WorkerAgent.launch` seam changes; the whole redesign is internal to `grok-own.ts`, which is exactly the multi-provider fit (the coordinator never branches on provider; the registry routes by `ProviderId`).

## 2. Architecture (anchor: deterministic-harness-model-as-leaf; graft: subloop primitive + shared gate)

### 2.1 The primitive — `spawnSubloop` (the safe subset of Agent())

One host-only function wraps one `generateText`/`generateObject`:

```ts
type SubloopRole = 'sizegate' | 'research' | 'implement' | 'verify' | 'review';

interface SubloopOpts {
  readOnly?: boolean;        // DEFAULT true — write tools added only for implement
  depth?: 0 | 1;             // DEFAULT 1 — a subloop runs at depth 1 and cannot spawn
  model?: string;            // per-call model swap (xai default); single-model to start
  stepCap?: number;          // DEFAULT 8 — small per-phase budget, not 50
  output?: z.ZodType;        // generateObject schema → typed handoff
  deadlineMs?: number;       // partitioned slice of GROK_WORKER_DEADLINE_MS
}

async function spawnSubloop<T>(
  ctx: SubloopCtx,           // {project, todoId, cwd, lane, abortSignal}
  role: SubloopRole,
  prompt: string,
  toolNames: ToolName[],     // names into TOOL_REGISTRY
  opts?: SubloopOpts,
): Promise<{ text: string; object?: T; errorSignatures?: string[]; stoppedReason: string }>;
```

Internally: `messages: []` (fresh, seeded ONLY by `prompt`), `tools = buildToolset(toolNames, {readOnly, depth, ctx})`, `stopWhen: stepCountIs(opts.stepCap ?? 8)`, `abortSignal: anyAbort(ctx.abortSignal, AbortSignal.timeout(slice))`. The existing `prepareStep` injectQueue drain and `onStepFinish` transcript+pane capture are passed into EVERY subloop unchanged, tagged with `role` so the synthetic pane shows real phase progress.

### 2.2 Capability caps (the HARD INVARIANT, made structural)

1. **`spawnSubloop` is never a model-facing tool.** Only host TS calls it. A subloop therefore *physically cannot* spawn a subloop — recursion is impossible by construction, depth ≤ 1.
2. **Read-only by default.** `write_file` / mutating `run_bash` are added only when `readOnly:false`, which ONLY the `implement` role passes. research/verify/review/sizegate are structurally incapable of mutation.
3. **No writer fan-out / no `ready`-minting tool exists in ANY toolset.** The only promotion path stays the planner; the only completion path stays host → server funnel.
4. **`complete_todo`, `escalation_create`, `await_human_decision` are removed from every model toolset** and called by the host only.
5. **Worktree containment reused unchanged:** `safe(path)` guard + `run_bash` cwd guard; every subloop shares the one daemon-created worktree, never `process.chdir`.
6. **`create_diagram` writes the design store, NOT git** — so the before/after diagram does not dirty the worktree and does not trip the work-committed re-verify.

### 2.3 The orchestrator (replaces the single `generateText`)

`getTodo` is a host call, not a model tool. Typed objects — and ONLY typed objects — cross phase boundaries (never raw transcript). That is the fresh-context guarantee, enforced by construction.

```
runLoop(spec, lane):
  spec = getTodo(project, todoId)                              # host, not a tool

  # 1. SIZE GATE (read-only think-call)
  sz = spawnSubloop('sizegate', SIZEGATE_PROMPT(spec), [read_file, run_bash_ro],
                    {output: SplitProposal, stepCap:5})
  if sz.object.oversized:
        host: escalation_create(kind:'decision', options:[split|linear], draft: sz.object.subtasks)
        host: await_human_decision(...)                        # via injectQueue channel
        if 'split': return                                     # planner promotes siblings; we STOP

  # 2. RESEARCH (read-only; posts before/after diagram for behavioral leaves)
  rf = spawnSubloop('research', RESEARCH_PROMPT(spec), [read_file, run_bash_ro, create_diagram, get_diagram],
                    {output: ResearchFindings, stepCap:8})

  # 3. FIX LOOP (host-owned, self-terminating)
  lastSig = null
  for attempt in 0..1:
      spawnSubloop('implement', IMPLEMENT_PROMPT(spec, rf.object),
                   [read_file, write_file, run_bash], {readOnly:false, stepCap:12})
      vd = spawnSubloop('verify', VERIFY_PROMPT(spec, gitDiff(cwd), rf.object.specDiagramName),
                        [read_file, run_bash_ro, get_diagram], {output: VerifyVerdict, stepCap:8})
      gate = runScopedGate(cwd, gitDiff(cwd))                  # SHARED helper, the real gate machinery
      if vd.object.pass AND gate.pass: break
      sig = sameSignature(merge(vd.object.errorSignatures, gate.errorSigs))
      if sig == lastSig: host: escalation_create(kind:'blocked', detail:'same errors twice'); return
      lastSig = sig
  if !(vd.object.pass AND gate.pass): host: escalation_create(kind:'blocked'); return

  # 4. STEP 3.5 COMPLETENESS REVIEW (read-only depth-1; behavioral leaves only; SKIP trivial)
  if isBehavioral(spec):
      rv = spawnSubloop('review', REVIEW_PROMPT(spec, gitDiff(cwd), rf.object.specDiagramName),
                        [read_file, run_bash_ro, get_diagram], {output: ReviewVerdict, stepCap:6})
      if !rv.object.complete:
            spawnSubloop('implement', FIX_GAPS_PROMPT(rv.object.gaps), [read_file, write_file, run_bash], {readOnly:false})
            re-run verify + runScopedGate; if !pass: host: escalation_create; return

  # 5. COMPLETE (host calls the UNCHANGED server-authoritative funnel)
  host: handleWorkerComplete(deps, project, todoId, {acceptance:'accepted', summary})
        # resolveCompletion re-runs runScopedGate + verifyWorkCommitted → authoritative verdict
  lane.done = true
```

Typed handoffs (the entire inter-phase state):
- `SplitProposal { oversized, subtasks: {title, files}[] }`
- `ResearchFindings { filesToEdit[], plan, testCommand, behavioral, specDiagramName? }`
- `VerifyVerdict { pass, failingChecks[], errorSignatures[] }`
- `ReviewVerdict { complete, gaps[] }`

`implement` never sees research scrollback — only `rf.object`. `verify` never sees implement scrollback — only `spec + gitDiff + specDiagramName`. That is fresh context and verify-independence-of-judgment, by construction.

## 3. Execution trace — one behavioral todo ("auto-archive a session 30 days after last activity")

```
HOST  getTodo() → spec{behavioral:true}
HOST  spawnSubloop('sizegate', read_file+run_bash_ro, out=SplitProposal, cap5)
MODEL   grep session lifecycle; reads 2 files → {oversized:false}
HOST  not oversized → proceed

HOST  spawnSubloop('research', read_file+run_bash_ro+create_diagram+get_diagram, out=ResearchFindings, cap8)
MODEL   reads session-store.ts + daily sweep; create_diagram("archive-flow: before=[sweep→skip] after=[age>30d→archive]")
MODEL   → {filesToEdit:[sweep.ts, session-store.ts], testCommand:'bun test sweep', behavioral:true, specDiagramName:'archive-flow'}

HOST  attempt0: spawnSubloop('implement', read_file+write_file+run_bash, readOnly:false, cap12)
MODEL   (sees ONLY spec+rf) writes age>30 branch + archiveSession(); git commit
HOST  spawnSubloop('verify', read_file+run_bash_ro+get_diagram, out=VerifyVerdict, cap8)
MODEL   (sees ONLY spec + git diff + diagram 'archive-flow' — NOT implement's reasoning)
MODEL   get_diagram; runs tests → {pass:false, errorSignatures:['sweep:boundary-30d']}
HOST  runScopedGate → fail (off-by-one). sig != lastSig (null) → not stuck. lastSig=sig.

HOST  attempt1: spawnSubloop('implement', ...) fresh → fixes >= boundary; commit
HOST  spawnSubloop('verify', ...) fresh → {pass:true}; runScopedGate → pass → break

HOST  behavioral → spawnSubloop('review', read_file+run_bash_ro+get_diagram, out=ReviewVerdict, cap6)
MODEL   (sees ONLY spec+diff+diagram) → {complete:false, gaps:['no audit log on auto-archive']}
HOST  spawnSubloop('implement', FIX_GAPS, readOnly:false) → adds log; verify+gate green

HOST  handleWorkerComplete(deps, project, todoId, {accepted})
SERVER  resolveCompletion: runScopedGate PASS + verifyWorkCommitted TRUE → ACCEPTED
LANE  lane.done=true; completionSignal stays {tier:'none'} (server authoritative, unchanged)
```

The model NEVER: called `complete_todo`, saw another phase's transcript, spawned anything, or ran the fix-loop control logic. The verifier caught the off-by-one AND the missing log precisely because it is a separate context graded against the diagram — the two things the flat loop could never do.

## 4. The six discipline-steps → concrete construct

| # | Discipline step | Construct |
|---|---|---|
| 1 | research→implement→verify→fix, fresh context per phase | sequential `spawnSubloop` calls, `messages:[]` each, typed handoff objects between them; host owns the loop |
| 2 | before/after diagram-as-spec | `create_diagram` in research toolset (design store, not git); `specDiagramName` threaded to verify+review which `get_diagram` and judge the change-set against the contract |
| 3 | self-terminating fix loop | host `for attempt 0..1` + deterministic `sameSignature(errorSignatures)`; identical twice → `escalation_create(blocked)`, stop. Model never owns the loop |
| 4 | mechanical acceptance gate scoped to change-set; completion never trusted from model | `complete_todo` removed from all toolsets; `runScopedGate` (shared helper) runs in-loop AND in `resolveCompletion`; host alone calls `handleWorkerComplete` after verify+gate pass |
| 5 | Step 3.5 completeness review (read-only depth-1, behavioral only) | `spawnSubloop('review', readOnly, [read_file, run_bash_ro, get_diagram])`; depth ≤ 1 + no write tool enforces read-only; SKIP trivial via `isBehavioral` |
| 6 | size gate → split-proposal (never spawns writers) | `spawnSubloop('sizegate', readOnly, out=SplitProposal)`; host calls `escalation_create(split|linear)` + `await_human_decision` and STOPS; planner promotes — worker stays single-todo |

## 5. What stays server-authoritative (the floor, unchanged)

`handleWorkerComplete` (coordinator-daemon L168-192) → `resolveCompletion` (completion-resolver L55-98) is untouched: fail-closed gate override + fail-open work-committed re-verify. The change is *who calls it*: today the **model** calls `complete_todo`; now `complete_todo` is gone from every model toolset and the **host** calls the funnel, only after independent verify + review pass. "Completion never trusted from the model" goes from hopeful (server backstops a self-graded pass) to structural (model has no completion tool). The in-loop verify + in-loop `runScopedGate` are *advisory early filters* that let the worker fix itself with fresh eyes before spending the authoritative gate — two judges, server wins.

**Single source of truth for the gate:** extract `runScopedGate(cwd, changeSet) → GateVerdict` from inside `resolveCompletion` so the in-loop preview gate and the authoritative final gate run identical machinery (no preview/authority drift). This is the one graft from `enforced-gate-single-loop` — its thesis (keep the flat loop) is rejected; this single helper is its best idea.

## 6. Multi-provider routing

The orchestrator is provider-agnostic TS, internal to the adapter — `worker-agent.ts` and `registry.ts` are untouched (the port is observe+launch only; the coordinator never branches on provider). Per-phase `model` is `xai(spec.model)` today; tomorrow `resolveModel(providerId)` returns the Vercel provider for `codex`/future. The discipline IS `runLoop`'s control flow — identical across providers. A new provider implements only the `LanguageModel` and reuses `spawnSubloop`; once a 2nd provider lands, lift `spawnSubloop` to a shared `src/agent/subloop.ts`. **Ship single-model first** — per-phase model routing is a one-line arg the design already supports, not a launch requirement.

## 7. Technical plan

### Files touched
- **`src/agent/adapters/grok-own.ts`** — the substantial change (whole redesign internal to the adapter).
- **`src/agent/completion-resolver.ts`** — extract `runScopedGate` (shared helper); resolver calls it (behavior unchanged).
- **UNCHANGED:** `worker-agent.ts`, `registry.ts`, `coordinator-daemon.ts`, `coordinator-live.ts`.
- **(Phase 6, optional/deferred)** a CI test that diffs the compiled `*_PROMPT` constants' intent against `worker/SKILL.md` + `vibe-go/SKILL.md` — the ONLY graft from `skill-as-compiled-playbook` (lockstep concern as a lint, NOT a compiler/interpreter).

### New (all in grok-own.ts unless noted)
- `spawnSubloop(ctx, role, prompt, toolNames, opts)` — the primitive.
- `TOOL_REGISTRY: Record<ToolName, (ctx)=>Tool>` — extracted from the inline 5-tool map; add `create_diagram`/`get_diagram`/`escalation_create`/`await_human_decision`/`run_bash_ro` via the same dynamic-import funnel as `complete_todo`.
- `buildToolset(names, {readOnly, depth, ctx})` — capability gating.
- `run_bash_ro` — gated read-only `run_bash` variant (cwd guard reused; rejects mutations).
- `runScopedGate(cwd, changeSet) → GateVerdict` — in `completion-resolver.ts`, shared.
- Zod schemas: `SplitProposal`, `ResearchFindings`, `VerifyVerdict`, `ReviewVerdict`.
- Prompt constants: `SIZEGATE_PROMPT`, `RESEARCH_PROMPT`, `IMPLEMENT_PROMPT`, `VERIFY_PROMPT`, `REVIEW_PROMPT`, `FIX_GAPS_PROMPT` (the compiled-in discipline).
- Host helpers: `sameSignature(a,b)` (normalize paths/line-nums, sort, hash), `gitDiff(cwd)`, `isBehavioral(spec)`, `partition(deadline, weights)`.

### Reused unchanged
`safe()` path guard, `run_bash` cwd guard, `anyAbort`/deadline, `prepareStep` injectQueue drain, `onStepFinish` transcript+pane, the `complete_todo`→`handleWorkerComplete`→`resolveCompletion` funnel logic (now host-invoked), `GrokLane` state (`phase` repainted per role).

### Phased build order (each independently shippable + observable via existing transcript/pane)
1. **Floor first:** extract `runScopedGate`; remove `complete_todo` from the model toolset, host calls the funnel. Flat single model phase still does the work. *Immediately tightens the gate before any phase split — lowest risk.*
2. Add `spawnSubloop` + `TOOL_REGISTRY` + Zod schemas; replace the single `generateText` with the orchestrator skeleton: sizegate→research→implement→verify→complete (no fix loop, no review yet).
3. Add the host fix loop: `sameSignature`, attempt cap, escalate-on-stuck.
4. Add Step 3.5 review (behavioral only) + gap-fix re-verify.
5. Add diagram-as-spec (`create_diagram` in research, threaded to verify/review) + size-gate split escalation.
6. Partition the deadline per phase; tune step caps; (optional) per-phase model routing + the SKILL-lockstep CI lint.

## 8. Why this over the alternatives

Three of five concepts (leaf, subloop, pipeline) independently converged on the same skeleton — per-phase fresh-context `generateText` with tool-omission enforcing read-only, host-owned fix loop with normalized errorSig equality, and `complete_todo` removed from every model toolset. **That convergence is the signal.** We anchor on **leaf** because it depends on model instruction-following the LEAST and is the most auditable/portable (swap `LanguageModel`, never the state machine). We graft **subloop's** `spawnSubloop` primitive (clean testable seam; future skills portable for free; lift-to-shared path for codex) and its caps table verbatim. We graft **enforced-gate's** sole good idea (`runScopedGate` shared) while rejecting its flat-loop thesis. We take **playbook's** lockstep concern only as a lint, deferring the compiler. We drop **pipeline** (subsumed, no distinguishing advantage).

### Top risks
1. **Typed-handoff bottleneck starves genuinely-exploratory leaves** — if `ResearchFindings` under-specifies, `implement` can't recover what research saw. Mitigation: allow `implement` a scoped `read_file` to re-derive; the truly creative refactors are rare in a fan-out queue and *should* escalate to a human/Claude lane anyway.
2. **Compiled prompt constants drift from SKILL.md** — the Grok prompts don't auto-track markdown edits the way a real `Agent()` reading skills would. Mitigation: the Phase-6 CI lint; accept residual drift as the price of in-process portability.
3. **More round-trips / cost / latency** — 5-8 model calls + `generateObject` constrained-decodes per todo vs one loop. Same price vibe-go's chained Claude agents already pay; mitigate with small step caps, cheap-model swaps later, and per-phase deadline partition so a wedged phase escalates fast instead of starving the rest.
4. **`generateObject` can fail/timeout on weaker models** — fail-safe toward escalation: a malformed verdict is treated as `pass:false` / `oversized:false`, never toward false completion.
5. **Rigid on trivial/non-behavioral leaves** — a one-liner pays sizegate+research overhead. Mitigation: `isBehavioral` fast-path skips research/review, running implement→gate→complete only (mirrors SKILL.md "SKIP trivial").

## 9. Explicit feasibility verdict

**The vibe-blueprint + vibe-go discipline survives the port to the in-process Grok/Vercel-AI-SDK worker without `Agent()`.** A fresh `generateText` is a fresh-context agent; tool-omission is the read-only sandbox; a host-only, never-model-invokable, depth-1 `spawnSubloop` is the recursion sandbox. The discipline becomes a deterministic host state machine; the model is a leaf. The HARD INVARIANT holds structurally (no spawn/`ready`/writer tool exists in any toolset; worker executes ONE todo; planner promotes siblings). Server-authoritative completion is preserved and *strengthened* (the model loses the tool to claim done). The only genuine losses vs `Agent()` are capabilities the invariant forbids anyway (nested recursion, parallel writer peers, OS-kernel isolation) and one real seam (prompt constants vs auto-read skills), mitigated by a lint. Net: the path survives, and the in-process version is *more* deterministic and auditable than the Claude-worker original.
