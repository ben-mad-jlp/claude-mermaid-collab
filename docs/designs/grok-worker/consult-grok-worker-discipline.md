# Grok consult + synthesis — grok-worker discipline design

Skeptical review of the winning design (`design-grok-worker-discipline`,
"deterministic-harness, model-as-leaf"). **Weigh, don't obey.**

## Grok's verdict
**Build phase 1 (host-driven completion + shared gate). Stop there.** The
deterministic multi-phase orchestrator (spawnSubloop, typed phase boundaries,
errorSig termination, in-worker size-gate) is gold-plating for a single-user local
worker. Risk ranking: (1) orchestration surface = accidental complexity; (2) typed
ResearchFindings→implement loses nuance or grows into JSON-scrollback; (3) errorSig
equality is brittle on nondeterministic output; (4) N generateText calls add
latency + lose in-context learning; (5) host-owned completion just MOVES the trust
boundary into verify, doesn't remove it.

## Synthesis (ACCEPT / TEMPER / DISCOUNT)

**ACCEPT — Phase 1 is the clear knee in the cost/value curve.** Extract
`runScopedGate`, remove `complete_todo` from every model toolset, host calls the
completion funnel after the gate passes. Mechanical, reversible, tightens the floor.
Ship it first regardless of what else we do.

**ACCEPT — errorSig-equality termination is brittle.** Nondeterministic test output
(timestamps, line numbers, addresses, flaky names) breaks naive normalized-string
equality → loops too long or escalates wrong. If/when we build a host-owned fix
loop, the termination signal needs more than a string compare (bounded attempt count
as the primary guard; signature equality only as a secondary hint), or just cap
attempts and escalate — simplest robust thing.

**ACCEPT — typed ResearchFindings→implement is the riskiest seam.** Over-constrained
interfaces either starve implement or bloat into JSON scrollback. If we ever split
phases, the research→implement handoff should be a structured-but-generous brief
(prose plan + file list), NOT a rigid schema that drops "this looked promising but
hit X."

**TEMPER — "host-owned completion just renames the trust problem."** Partly true, but
understated. Moving the model's self-"done" out of `complete_todo` AND giving verify
FRESH context (verify never saw implement's reasoning) is a real reduction, not pure
renaming — an independent reviewer that can only see the diff + spec is materially
harder to fool than the same conversation grading its own homework. This is the ONE
piece of the orchestrator worth more than Grok credits.

**DISCOUNT (partially) — "context drift doesn't bite at this scale; it's a SaaS
worry."** This is where Grok over-rotates to single-user. The point of this whole
direction is a FLEET of grok/vercel workers running todos UNATTENDED, daemon-driven,
in waves — "one human" ≠ "one todo at a time, watched." The cost of a worker silently
marking done-but-wrong is HIGH precisely because no human reviews each leaf. So
verify-independence has more value here than Grok's framing allows. But that argues
for the verify split specifically — NOT for the full typed-phase pipeline.

## Recommendation — phased, measured (not all-or-nothing)

1. **Phase 1 (build now):** `runScopedGate` extraction + remove `complete_todo` from
   the model + host-driven completion. Independently shippable; tightens the floor.
2. **Phase 2 (build next, the high-value increment):** add ONE fresh-context VERIFY
   subloop — read-only, sees diff + spec only, returns a typed VerifyVerdict the HOST
   acts on. This is Grok's own "option 6b" and captures most of the discipline win
   (independent judgment) at a fraction of the orchestrator's cost/risk. Generous
   brief, not a rigid schema.
3. **DEFER (don't build up front):** full per-phase pipeline (separate research +
   implement + fix subloops), typed ResearchFindings handoff, host-owned errorSig fix
   loop, in-worker size-gate/split. Only build these if Phase 1+2 telemetry shows the
   failure they fix actually occurs (workers shipping incomplete/wrong leaves, or
   grinding fix loops). Decide with evidence, not up front.

Net: the design exploration's winner is the right NORTH STAR, but we adopt it
incrementally. Grok is right that building the whole orchestrator now is premature;
it's wrong that we should stop at phase 1 — the fresh-context verify (phase 2) is
worth it for unattended fleet work. Everything past phase 2 is evidence-gated.
