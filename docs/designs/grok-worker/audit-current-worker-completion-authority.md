# Audit: is the CURRENT (Claude CLI) worker completion already host/gate-authoritative?

Triggered by the redirect "do Phase 1 in the current worker sessions, not the grok ones." Before
touching the live path, verified what authority already exists. Result: **the live floor is mostly
already there.**

## Verified in code (not just the comment)
The current Claude worker reports completion via the MCP `complete_todo` verb, which is
server-authoritative:
- `src/mcp/setup.ts:4716` `case 'complete_todo':` → `:4719`
  `handleWorkerComplete(makeCoordinatorDeps(), project, todoId, acceptance)`.
- `handleWorkerComplete` (`coordinator-daemon.ts:168`) → `resolveCompletion`
  (`completion-resolver.ts:55`): GATE fail-closed (overrides a model 'accepted' → 'rejected') + the
  work-committed re-verify fail-open (empty lane 'accepted' → 'pending').
- `coordinator-live.ts:1418` confirms: completion "funnels through the MCP complete_todo verb →
  handleWorkerComplete → …".

**Conclusion: the gate ALREADY overrides the model on the live Claude path TODAY.** A worker that
lies "accepted" is downgraded to rejected (gate fail) or pending (no committed work). The mechanical
floor exists for the current path — it is NOT a black-box self-report.

## What is NOT yet host-authoritative-BY-CONSTRUCTION
The model still HAS and CALLS the `complete_todo` tool (`worker/SKILL.md` Step 4a, allowed-tools line
5 + Step 4a lines ~154/163), and that call doubles as the daemon's "worker is done" signal. So the
invariant "no model-callable done tool" is not met — but the gate already neutralizes a FALSE model
'accepted'. The residual risk is narrow: the model's call is the *trigger*, not the *authority*.

## Decision: DEFER the full "no model done-tool" change to worker-core
Making the current path host-authoritative BY CONSTRUCTION means: remove `complete_todo` from
`worker/SKILL.md` AND have the daemon DETECT the worker finished (its existing watchdog/liveness/idle
detection) and call `handleWorkerComplete` itself. That is a **daemon-lifecycle + skill change on the
LIVE production path** — higher blast radius. We defer it because:
1. The gate floor ALREADY exists on the live path (verified above) — the urgent risk is covered.
2. The CLI worker is LEGACY / to-be-retired (north-star §3); investing lifecycle surgery into it is
   low-value vs. building the same property into worker-core's host-owned loop (where loop-end is a
   natural host hook, not a pane-scrape).
3. It belongs in the worker-core build under the parallel-run migration discipline, not as a one-off
   edit to the legacy path.

## On the grok-own.ts Phase-1 edit (done, then set aside)
Implemented host-driven completion in `grok-own.ts` (remove `complete_todo` from the model toolset;
host calls `handleWorkerComplete` post-loop) on branch `phase1/host-authoritative-completion` —
tsc clean, conformance 14/14. **Reverted / branch deleted** because grok is DORMANT (registry is
claude-only; `resolveGrokAgent` only), so it tightened nothing live. The exact 3-edit change is
captured in `design-worker-core` build step 4 (the recipe's host-complete) for when the in-process
worker actually runs.

## Net
"Phase 1" as a discrete pre-worker-core build largely COLLAPSES:
- The live Claude path is ALREADY gate-authoritative (no work needed for the urgent floor).
- The grok path is dormant (editing it is a no-op live).
- The meaningful remainder — model has no done-tool + host drives completion at loop-end — is
  naturally a worker-core property (host-owned loop = clean loop-end hook), to land under parallel-run.
So: nothing to ship on the live path today; fold host-authoritative-by-construction into worker-core.
