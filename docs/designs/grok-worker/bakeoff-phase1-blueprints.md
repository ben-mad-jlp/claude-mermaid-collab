# Blueprint bakeoff — Claude Code vs Grok (grok-build-0.1)

Quick cut (equal context): both models given the SAME real code excerpts (completion-resolver.ts,
the coordinator-live runGate closure, the grok-own.ts tools/prompt/loop) + the Phase-1 todo spec,
asked for the same-format blueprint. Tests grok-build's blueprint REASONING, isolated from its
own context-gathering. Subject: Phase 1 (`b43ce046`).

## The discriminator
The todo spec says "extract runScopedGate out of resolveCompletion in completion-resolver.ts" —
but the gate machinery is NOT there. It lives in `coordinator-live.ts` `runGate` → `runRegistryGate`
(line 1873); completion-resolver only ORCHESTRATES injected deps. A trustworthy blueprint must CATCH
the imprecise spec and not hallucinate a helper in the wrong file.

## Result: BOTH caught it. Grok is trustworthy here.

| Criterion | Claude | Grok |
|---|---|---|
| Right files (3: grok-own, coordinator-live, completion-resolver) | 10 | 10 |
| No hallucinated files/functions | 10 | 10 |
| Correct before/after behavioral spec | 9 | 9 |
| Caught the spec imprecision (the discriminator) | 10 | **10** (flagged it explicitly, twice) |
| Sensible decomposition / layering | 9 | 7 |
| **Total** | 48 | **46** |

**Grok PASSED the discriminator.** It wrote: *"todo spec is imprecise/wrong on 'out of
resolveCompletion'"* and *"no scoped gate body, tsc, or change-set logic exists in this file."*
It identified the correct 3 files, referenced only real symbols (runRegistryGate, makeCoordinatorDeps,
handleWorkerComplete, getWorktreeManager.existingPath, epicBranchName, workerIsolationEnabled — all
from the provided context), and produced a concrete, mostly-correct per-file task list with a faithful
before/after contract.

## The one real delta — helper placement (layering judgment)
- **Claude:** extract `runScopedGate` in `coordinator-live.ts` (where the logic already lives);
  leave `completion-resolver.ts` UNTOUCHED (it stays a pure, dependency-injected resolver).
- **Grok:** put `runScopedGate` IN `completion-resolver.ts` and have coordinator-live's runGate
  `return runScopedGate(...)`. **Risk:** this inverts the dependency — completion-resolver (today
  imports only a type) would now pull in runRegistryGate / getWorktreeManager / loadProjectManifest
  from services, likely creating an import CYCLE and polluting the pure resolver. Grok also proposed
  resolveCompletion call runScopedGate directly, muddying its clean injected-deps design.

This is a **senior-review-catchable layering smell, NOT a hallucination or a fundamental miss** —
exactly the class of thing a fresh-context verify/review step (Phase 2) or a human glance catches.

## Verdict — strong positive signal for "own harness on grok"
grok-build can do the blueprint REASONING at a trustworthy level given good context: it caught the
trap, scoped the right files, invented nothing. The gap is a layering judgment, not correctness.
This materially de-risks the worker-as-mini-vibe-go vision on our OWN harness.

**Caveat / next:** this is the QUICK cut (equal context). The FAITHFUL cut follows.

---

# Faithful cut — Grok self-gathers context (ReAct loop)

Setup: a real ReAct loop — Grok requested GREP/READ/LS, the harness served EXACTLY what it asked
(nothing volunteered, no corrections), transcript carried forward each turn. HARDER target chosen to
hunt a breaking point: *"Remove the hardcoded xai('grok-build-0.1') and route the model by ProviderId
through a resolver, so a future codex/anthropic provider can swap the LanguageModel WITHOUT touching
runLoop."* Trap: provider/adapter routing ALREADY exists (resolveProvider/registry); the NEW seam is a
LanguageModel factory replacing xai() at grok-own.ts:358; and LaunchSpec has `model?` but NO `provider`.

## Result: BREAKING POINT FOUND.

**Got right (strong self-navigation):**
- Caught the LaunchSpec trap (model? but no provider field → add provider?: ProviderId).
- Caught the real wiring gap: resolveProvider's result (coordinator :1300) is NOT passed to launch
  (:1403), only `model` is.
- Correctly scoped AI-SDK to grok-own; claude-code is a CLI wrapper; correct DO-NOT-DUPLICATE list;
  flagged genuine spec ambiguities.

**Broke on:**
1. MISSED THE PRIMARY INSTRUCTION. The todo says "Remove the hardcoded xai(...)" — Grok's grok-own
   task says "continue to do `model: xai(spec.model ?? DEFAULT_GROK_MODEL)` (exact line 358)." It KEPT
   the hardcoded factory and silently reframed "model resolver" into adapter-routing (resolveWorkerAgent
   by provider) which ALREADY EXISTS. Under its blueprint a codex/anthropic model still can't run in
   runLoop. Confidently missed the central architectural intent.
2. HALLUCINATED a path: wrote `src/coordinator/coordinator-live.ts`; real (and previously served) path
   is `src/services/coordinator-live.ts`.
3. OPERATIONAL DRIFT under self-direction: abandoned the specified ```tools format for <XML> tags
   mid-loop; re-requested worker-agent.ts + registry.ts it had already been given.

## The pattern (decision-relevant)
The breaking point correlates with task ABSTRACTION + OPEN-ENDEDNESS, not repo size/navigation:
- Concrete refactor (quick cut) → Grok nailed it (46 vs 48).
- Abstract/architectural task (faithful cut) → caught wiring traps but missed the core ask + drifted.

Grok navigates well and catches concrete traps, but on an architectural/open task it can confidently
miss the central intent and drift operationally — the exact failure mode that makes UNSUPERVISED
autonomy risky, and exactly what a fresh-context verify / human review catches.

## Conclusions for the build direction
- Worker-as-mini-vibe-go on Grok is VIABLE for CONCRETE, well-specified todos → argues FOR the
  "durable contract at filing" idea (file files + before/after behavioral spec; keep leaves concrete).
- Keep ARCHITECTURAL framing with the planner (human/Claude); hand Grok pre-shaped leaves, never
  abstract "design the resolver" asks.
- The verify/review gate (Phase 2 fresh-context verify) is LOAD-BEARING, not optional — it catches the
  "confidently missed the core ask" failure observed here.

---

# Implementation bakeoff — Opus blueprint → grok-build implements → Opus review

Tests the hybrid the user proposed (Opus blueprint+review, grok-build builds). Poetic target: grok
IMPLEMENTS the very `resolveModel` provider→LanguageModel resolver it FAILED to blueprint in the
faithful cut. Concrete Opus blueprint handed over; grok drove WRITE/READ/RUN in an isolated git
worktree; real `tsc` + `vitest` gate run.

## Mechanical result: GREEN. tsc clean on the new file, all 5 vitest tests pass.
grok-build CAN implement: given a concrete blueprint it produced compiling, internally-consistent,
test-passing code. Mechanical execution works.

## Opus review against the BLUEPRINT: 3 silent deviations the green gate HID
1. **Wrong default model IDs.** Blueprint: claude:'claude-opus-4-8', grok-build:'grok-build-0.1',
   codex:'gpt-5-codex'. Grok wrote claude:'claude-3-5-sonnet-20241022', grok-build:**'grok-beta'**,
   codex:'gpt-4o' — substituted outdated training-data model names. The grok-build default ('grok-beta')
   is WRONG — it's not the model the worker runs. A real bug.
2. **Error message off-contract.** Blueprint specified "...not installed yet (only grok-build is wired)"
   (/not installed/). Grok wrote "Provider X is not yet supported by this resolver."
3. **Dropped the exhaustiveness guard.** Blueprint asked for `const _exhaustive: never = provider;` in
   the default branch (so a future 4th ProviderId fails compile until handled). Grok used a plain
   `if (grok-build) return; throw` — no compile-time guard. Maintainability regression vs spec.

## THE money finding: the worker writes its OWN tests → a green gate validates the drift
Grok wrote the test suite to match its OWN code (asserts 'grok-beta', "is not yet supported"). So the
5 passing tests CONFIRM the deviations instead of catching them. **A mechanical "tests pass" gate is
BLIND when the implementer authors the tests.** Only the independent Opus review against the blueprint
caught the drift.

## Conclusions — the user's phase-routing hybrid is VALIDATED, with a sharpening
- Opus blueprint → grok implement → **Opus review** works precisely BECAUSE the Opus review catches
  what grok's green gate cannot. The review phase is not optional polish — it's the correctness floor.
- **SHARPENING (test-as-spec):** have the BLUEPRINT (Opus) AUTHOR the tests — the executable spec —
  and require grok to implement to pass THOSE tests, not tests it writes itself. Grok then cannot move
  the goalposts; the gate becomes spec-authoritative and catches drift MECHANICALLY (cheap), reserving
  the Opus review for semantic/architectural judgment. TDD as the anti-drift mechanism.
- Net phase-model map: **Opus** = blueprint + author tests + review; **grok-build** = implement to green.
  Cheap tokens where volume is (implement), strong tokens where judgment is (spec + review).
