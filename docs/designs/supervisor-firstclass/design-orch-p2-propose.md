# Orch P2 — Grok 'propose' level (implementation design)

> Realizes Phase 2 of `design-unified-orchestrator-daemon` (§4/§11), todo `19b097a1`.
> Builds on Phase 1 (shipped): `orchestrator-live.ts` tick, per-project level ladder, `reconcile-pass.ts`.
> Scope: at level `propose`, the daemon feeds **undecided** open escalations to Grok via a **read-only tool-loop**, Grok returns a structured **verdict**, and the daemon surfaces it as a **human-gated ghost proposal**. Nothing acts autonomously — the human confirms; on confirm the daemon executes the steward verb behind the existing proof gate. Fail-open on uncertainty.

## 1. What exists (reuse, don't rebuild)
- **Daemon tick** `orchestrator-live.ts`: `runOrchestratorTick` → per project, `passesForLevel(level)` → build/reconcile. Add a `triage` pass gated at `rank >= propose`.
- **Proof gate** `steward-proof.ts`: `validateStewardProof(verb, proof, ctx)` re-derives merged/tsc/grep/dep-done/override from ground truth. **Reused unchanged** at confirm-time.
- **Verbs** (dormant, retained): `reset_todo`, `override_accept_todo` + the escalation store (`getEscalation`, `setEscalationRoute`, `resolveEscalation`, `incrementStewardAttempts`).
- **Read-only deterministic fns** the tool-loop wraps: `getTodo`/`listTodos` (todo-store), dep status, `getDecisionRecord`, `listSupervisorAudit`, plus a merged/tsc/gate check via the proof runners.
- **Grok call**: raw `fetch('https://api.x.ai/v1/chat/completions')` with `XAI_API_KEY` from `getConfig` (see `setup.ts:3379`). x.ai supports OpenAI-style `tools`/`tool_calls` — the tool-loop uses that.
- **Inbox pattern** to mirror: requirements = `decision-record` rows (kind=`requirement`, status `proposed`→approve/reject) surfaced by `RequirementsInbox.tsx` with a keyboard drain; routes `GET/POST /api/supervisor/requirements(+/decide)`. We mirror the **shape**, not the decision-record table (verdicts carry `{bucket, verb, args}`, not a RequirementSpec).

## 2. New pieces

### 2a. Proposal store — `src/services/orchestrator-proposal-store.ts` (SQLite, supervisor.db)
A ghost-proposal is a daemon-suggested act awaiting human confirm. New table `orchestrator_proposal`:
```
id TEXT PK
project TEXT
escalationId TEXT          -- the escalation this triages (1 open proposal per escalation; dedupe)
todoId TEXT                -- the work-todo the verb targets (nullable)
bucket TEXT                -- stale | verified-done | now-buildable | genuine-decision | needs-design
verb TEXT                  -- reset_todo | override_accept_todo | surface (null = surface-to-human only)
argsJson TEXT              -- {proof?: StewardProof, status?, ...} the verb needs
confidence REAL            -- 0..1 Grok's self-rated confidence
rationale TEXT             -- Grok's one-paragraph why (shown on the card)
provenanceJson TEXT        -- tool calls Grok made (audit trail: which ground truth it read)
status TEXT                -- proposed | confirmed | dismissed | executed | failed
createdAt INTEGER
resolvedAt INTEGER
```
Functions: `proposeAct(input)` (dedupe on `(escalationId, status='proposed')`), `listProposals(project, status?)`, `getProposal(id)`, `resolveProposal(id, status)`. Cache verdicts by `(escalationId, todo-revision)` → don't re-spend Grok on a re-tick of the same unchanged escalation (open Q3).

### 2b. Tool-loop harness — `src/services/grok-triage.ts`
- `READONLY_TOOLS`: OpenAI-tool schemas for `get_todo`, `deps_status`, `is_merged`, `gate_clean`, `recent_audit`, `get_escalation`, `list_linked_todos`. Each maps to a deterministic server fn; the **daemon executes** the call and feeds the JSON result back.
- `classifyEscalation(esc, deps): Promise<Verdict>`: seeds a system prompt (the bucket taxonomy + the act-not-classification rule + "return verdict via the `emit_verdict` tool") + the escalation as the user turn, runs the bounded tool-loop (cap **N=6** tool rounds), and returns the structured verdict. Grok emits the final verdict through a forced `emit_verdict` tool-call (schema-validated server-side; retry on malformed). On any error / cap-exceeded / low confidence → return `{bucket:'genuine-decision', verb:null}` (fail-open → human).
- Pure/injectable: the Grok fetch and each tool fn behind a `TriageDeps` interface so it unit-tests without network or a live repo (same seam style as `runOrchestratorTick`).

Verdict shape (server-validated):
```ts
interface Verdict {
  bucket: 'stale'|'verified-done'|'now-buildable'|'genuine-decision'|'needs-design';
  confidence: number;            // 0..1
  verb: 'reset_todo'|'override_accept_todo'|null;
  args: { proof?: StewardProof; status?: string } | null;
  rationale: string;
  provenance: string[];          // tool calls made
}
```

### 2c. Triage pass — in `orchestrator-live.ts`
`runTriagePass(project)` (gated `rank >= propose`; injectable like build/reconcile):
1. `openEscalations(project)` **minus** those the deterministic reconcile pass already handles (stale/verified-done auto-close) **minus** those with an existing open proposal (dedupe) **minus** `routedTo`/`operatorGated` human-floor kinds (`approval`/`decision`/`assumption-invalidated`/operator-gated → leave to human; never spend Grok).
2. For each remaining **undecided** escalation: `classifyEscalation` → `proposeAct(verdict)` (status `proposed`). **No execution at `propose`.**
3. Rate-limit: cap **Grok classifications per project per tick** (e.g. 3) so a backlog can't fan out cost; the rest wait for the next tick. `log` the cap (no silent truncation).
4. Fail-open: a triage error for one escalation never aborts build/reconcile for the project (try/catch per escalation, like reconcile-pass).

### 2d. Confirm → execute — route + executor
- `POST /api/orchestrator/proposals/:id/confirm` and `/dismiss` (new `orchestrator-routes.ts` handlers).
- **Confirm** → `executeProposal(id)`: re-load the escalation + todo, **re-run `validateStewardProof(verb, args.proof, ctx)`** (the proof gate is the authority, not Grok's classification — Grok's #2). If proof ok → apply the verb (`reset_todo`/`override_accept_todo` against the store) + `resolveEscalation` + `recordSupervisorAudit({kind:'override'|'reconcile', detail: provenance})` + mark proposal `executed`. If proof fails → mark `failed`, `setEscalationRoute(esc, 'human', proof)`, leave the escalation open for the human. **A no-proof confirm never mutates.**
- **Dismiss** → mark proposal `dismissed`; escalation stays open (human handles directly).
- `GET /api/orchestrator/proposals?project=&status=` feed for the inbox.

### 2e. UI — `OrchestratorProposalInbox.tsx` (mirror RequirementsInbox)
- A sibling card in Bridge's left column (BELOW RequirementsInbox), **amber** (one-red discipline; red stays escalations). Keyboard drain `1`/`↵` confirm · `3` dismiss · auto-advance.
- Each card: bucket chip + verb + the target todo title + Grok's rationale + a confidence bar + an expandable provenance list (which ground truth Grok read). Confirm posts `/confirm`; dismiss posts `/dismiss`.
- Store: `proposalsByProject` + `loadProposals`/`decideProposal` in `supervisorStore.ts`, polled on the Bridge cadence. A `Proposed(N)` count feeds a CommandBar/tab badge (same selector drives list depth + badge).

## 3. Safety invariants (carried from the design)
- **Proof gate is the authority.** Grok proposes; the server re-derives the act from ground truth at confirm-time. A plausible-but-wrong classification cannot mutate state — worst case it surfaces a proposal the human dismisses, or proof-fails and re-routes to human.
- **Human-gated.** `propose` NEVER executes autonomously. (Auto-execution of confident buckets is Phase 3 `consult`, explicitly out of scope here.)
- **Fail-open on uncertainty.** Error / cap / low-confidence / human-floor kind → human, never a silent auto-act.
- **Cost-bounded.** Grok fires only on undecided escalations, capped per project per tick, cached by (escalation, todo-revision). Quiet projects cost zero LLM.
- **Isolated pass.** A triage failure must never block build/reconcile.

## 4. Test plan
- `grok-triage.test.ts`: tool-loop with injected fake Grok (scripted tool-calls → verdict); malformed verdict retry; cap-exceeded → fail-open; each READONLY tool maps to its fn.
- `orchestrator-proposal-store.test.ts`: propose/dedupe/list/resolve; cache by revision.
- `orchestrator-live.test.ts` (extend): `runTriagePass` skips human-floor + already-proposed + reconcile-handled escalations; respects the per-tick cap; fail-open per escalation; only runs at `rank>=propose`.
- executor: confirm with valid proof → verb applied + escalation resolved + audit; confirm with bad proof → no mutation + re-route to human; dismiss → proposal dismissed, escalation open.
- UI: `OrchestratorProposalInbox` keyboard drain + badge/list parity (mirror the RequirementsInbox tests).

## 5. Open questions (resolve before/while building)
1. **Verb coverage at P2.** Start with `reset_todo` only (the safe buckets: stale→reset, now-buildable→reset/ready) and DEFER `override_accept_todo` proposals to a follow-up? (override is the scary verb — even human-gated, its proof is dual and subtle.) Leaning: include both but mark override proposals visually distinct + require the dual-proof to be present before the card is even confirmable.
2. **Where the verb actually writes.** `reset_todo`/`override_accept_todo` historically were MCP/steward-skill verbs. Confirm the store-level functions they call (todo-store `updateTodo`/`resetTodo`?) so the executor calls the same path. (Needs a quick grep of the old steward verb handlers.)
3. **Grok tool-calling reliability** with `grok-build-0.1` — does it honor `tool_choice`/forced final tool? If flaky, fall back to a single-shot structured-JSON prompt (still with a pre-packed context bundle) as a degraded mode.
4. Build in-session (touches the daemon), per the epic's BUILD-HERE note — not autonomous workers.

## 6. Grok consult synthesis (2026-06-09, skeptical principal-engineer framing)

Grok reviewed §1–5 skeptically. Ranked cuts + our synthesis (ACCEPT / TEMPER / DISCOUNT against local-first single-user reality):

1. **"Kill the separate amber ghost-proposal queue — attach the suggestion inline on the escalation instead."** — **ACCEPT (load-bearing).** A parallel amber queue mirroring the red escalation queue splits attention and creates a stale second signal for one user. Grok offers a third option neither the design nor our earlier pick considered: **no separate surface — the verdict is an optional `suggestedAction` field ON the escalation**, rendered inline in the existing NeedsYouZone card the human already drains (Confirm/Dismiss buttons inline). This SUPERSEDES the "mirror RequirementsInbox" plan in §2e. (Surfaced to the human as a course-change decision — it overrides the earlier surface choice.)
2. **"Drop `propose`, or make it diagnostic not a decision path; push `now-buildable` deterministic instead."** — **TEMPER.** The epic + decision f0ec0b06 commit to the Grok level, and the design's north-star (§5) already says strengthen deterministic rules so fewer cases reach Grok. Grok's real residual value isn't the now-buildable verb (deps-all-done is a store query) — it's **routing the human's attention**: classify whether an open escalation is a genuine-decision/needs-design (here's the crux) vs a mechanical now-buildable (here's the suggested reset). Keep `propose`, but frame it as **assistive classification + a suggested act on the escalation**, not a separate decision queue. Value is thinner than the design implied — accepted.
3. **"Replace the tool-loop with a single-shot context pack."** — **ACCEPT.** Because the proof gate re-validates the act, Grok's investigation quality only affects WHICH suggestions appear, not correctness. A single-shot prompt with a pre-packed read-only bundle (todo + direct deps status + recent gate result + last-N audit + git state) is simpler, faster, more deterministic, easier to version. Drop the tool-loop (was §2b); keep the context bundle. Revisit a loop ONLY with evidence the model needs unexpected context.
4. **Confirm→proof-gate failure modes** — **ACCEPT all:**
   - **Staleness window**: a suggestion generated on an older world-view. → Tie the suggestion's life to its escalation: regenerate/expire when the escalation or its todo revision changes; re-validate freshness at confirm (the proof gate covers the ACT; also re-check the escalation is still open + the todo revision matches, else discard the suggestion and re-surface plain).
   - **Escalation/proposal divergence**: → no independent proposal object that can outlive its escalation. The inline field dies with the escalation.
   - **Silent no-op on proof-fail**: → proof-fail MUST re-surface the ORIGINAL escalation with the failure reason attached (`setEscalationRoute(esc,'human',proof)` + a visible reason on the card), never just a dead "failed proposal."
   - **Provenance decay**: → store the tool/bundle INPUTS (actual git rev, dep snapshot, gate result) alongside the rationale, not just which checks ran — so later inspection knows what data the model saw.
5. **Coupling: new durable proposal artifact needs GC.** — **RESOLVED by accepting #1**: the inline `suggestedAction` field has no independent lifecycle to garbage-collect.

### Revised shape (post-synthesis)
- **No** `orchestrator-proposal-store.ts`, **no** `OrchestratorProposalInbox.tsx`, **no** confirm/dismiss queue routes.
- Add nullable `suggestedAction` (JSON: `{bucket, verb, args, confidence, rationale, bundleInputs}`) to the escalation record (new column, additive, DEFAULT null).
- `grok-triage.ts` = **single-shot** classifier over a packed read-only bundle (still injectable for tests; no tool-loop).
- `runTriagePass(project)` (gated `rank>=propose`): for each undecided open escalation with no fresh `suggestedAction`, pack bundle → single Grok call → write `suggestedAction` on the escalation. Per-tick per-project cap; fail-open; isolated from build/reconcile.
- UI: NeedsYouZone escalation card renders the inline suggested act (amber sub-block: bucket chip + verb + rationale + confidence + Confirm/Dismiss). Confirm → existing escalation-decide path, extended to run the proof gate + apply the verb; proof-fail re-surfaces with reason. Dismiss → clears `suggestedAction`, escalation stays open.
- Proof gate, verbs, fail-open, cost-bound, isolation — all unchanged from §3.

This is materially smaller than the original §2 and removes the second-queue attention cost while keeping the proof-gate safety core.
