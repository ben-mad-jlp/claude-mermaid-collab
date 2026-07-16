---
name: mission-forge
description: Turn an observed problem or design discussion into a DRIVEN convergence mission — evidence survey (data + structure), skeptical AI consult with recorded synthesis, hand-fix of anything the mission machinery itself needs, then a mission with sequenced verifiable criteria + a locked-constraints handoff assigned to a conductor session. Use when the human says "this keeps hurting", "should we redesign X?", or a discussion produces a multi-step overhaul worth driving autonomously — NOT for a single bug (file a leaf) or a one-epic feature (file an epic).
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - Bash
  - Agent
  - Skill
  - mcp__plugin_mermaid-collab_mermaid__list_friction
  - mcp__plugin_mermaid-collab_mermaid__friction_trends
  - mcp__plugin_mermaid-collab_mermaid__leaf_failures
  - mcp__plugin_mermaid-collab_mermaid__leaf_inspect
  - mcp__plugin_mermaid-collab_mermaid__consult_grok
  - mcp__plugin_mermaid-collab_mermaid__create_document
  - mcp__plugin_mermaid-collab_mermaid__create_decision_record
  - mcp__plugin_mermaid-collab_mermaid__approve_decision_record
  - mcp__plugin_mermaid-collab_mermaid__create_mission
  - mcp__plugin_mermaid-collab_mermaid__set_mission_owner
  - mcp__plugin_mermaid-collab_mermaid__set_active_mission
  - mcp__plugin_mermaid-collab_mermaid__get_mission
---

# Mission Forge

How a *discussion* becomes a *mission worth conducting*. This skill sits upstream of both the planner (which shapes work-graphs) and the conductor (which drives missions): it owns the judgment steps that make the downstream machinery effective. The worked example is mission `c2d640ec` (daemon friction overhaul): docs `daemon-friction-survey` (session fable) → `handoff-daemon-friction-mission` (session design) — read them when unsure what good output looks like.

## Step 1 — Survey with TWO sources: data AND structure

Never design from vibes or from either source alone.

- **Data:** what actually happened. `friction_trends` + `list_friction` (recurrence, not anecdotes), `leaf_failures includeAll` (outcome distribution, cost shape), `leaf_inspect` on the representative failures (the node timeline tells you WHY, not just THAT). Classify failures: *harness-inflicted* vs *system-legitimately-catching-bad-work* — the ratio is the headline.
- **Structure:** what the code actually does. Dispatch an Explore agent to inventory the mechanism end-to-end (passes, guards, order, cadence, what each failure does — park/retry/warn). The stats say *where* it hurts; the inventory says *why* — and surfaces vestigial/overlapping machinery the stats never show.
- Save the survey as a session document (stats table + structural findings + what-the-system-gets-right). The "gets right" section is not decoration: it is the list of things the mission must NOT regress, and it seeds the locked constraints.

## Step 2 — Skeptical consult BEFORE locking the design

Consult Grok (or another independent model) with an adversarial system framing ("prioritize holes the change opens over validation; rank risks"). Give it the real design, not a summary. Then write an explicit **ACCEPT / TEMPER / DISCOUNT** synthesis — every point gets a verdict and a reason. Record design-changing consults as decision records (with the rejected alternatives named) so the "why not X" survives context loss.

A consult that changes nothing was framed wrong. In the worked example the consult killed two designs that would have shipped real holes (blanket-abstain, whole-review grounding) — that is the expected value of this step, not an embarrassment.

## Step 3 — Hand-fix the bootstrap path first

If the machinery that will DRIVE the mission is itself part of what's broken, fix that part by hand (EnterWorktree, tests, baseline comparison, land) BEFORE creating the mission. Routing the fix through the broken machinery is circular; waiting for the mission to fix its own driver deadlocks it. In the worked example: the per-criterion mission status model and the review-gate fix were hand-built same-day, and the conductor's first pass ran on both.

Test discipline for these hand fixes: run each touched test file ALONE on the branch AND on master, compare failing NAMES — aggregate runs are noise (shared SQLite).

## Step 4 — Author the mission: sequenced, verifiable, bounded

**Criteria are capability assertions, not tasks.** Each must be independently checkable by a reviewer against ground truth (the VERIFY gate dispatches one reviewer per criterion). Discipline:

- **Sequence by risk:** order criteria so each de-risks the next (in the worked example: shadow-corpus BEFORE optimistic-landing). State the ordering rationale in the handoff — the conductor may still parallelize what's genuinely independent.
- **Make them falsifiable:** name the regression test, the observable state, or the measured threshold. "Gates are nicer" is not a criterion; "a single-offense prose failure does not produce a parked leaf, proven by test" is.
- **One measured-outcome criterion, last:** the quantitative "did this actually work" check (cost/latency/intervention-count over ≥N live runs). Expect it to converge last; say so, so the conductor doesn't hold the others on it.
- **Explicit out-of-scope list:** name the ideas deliberately deferred (and where they went — follow-on missions), so the conductor cannot gold-plate.
- **Resolve subsumptions NOW:** when two proposals attack the same win (static policy vs adaptive version; per-item vs batch), decide the sequencing at forge time and write it down. Re-litigating subsumption mid-mission is how scope creeps.

## Step 5 — The handoff: a constitution, not a pointer

Create the handoff document IN THE CONDUCTOR'S SESSION with this shape:

1. **Locked constraints header** — the human-approved invariants, each phrased as a hard rule with its reason ("mechanical gate stays PRE-land — placebo-hole guarantee"). These are the things Step 1's "gets right" list said must not regress, plus the human's explicit calls. Mark it "do not re-litigate".
2. **Sequencing + subsumption decisions** from Step 4, with rationale.
3. **Practical notes** — the near-free first moves, the key file map, recent landings to build on, anything that saves the conductor a discovery pass.
4. **Anything displaced** — if activating this mission deactivated another, say so and tell the conductor to flag the human if priorities look wrong.

Then `create_mission` with the criteria AND `handoffDocId` set to the handoff document's id — the mission row carries its constitution durably; description-text pointers rot. Assign/activate for the conductor session (`set_mission_owner` if created from elsewhere, `set_active_mission` — note it deactivates that session's other missions).

## Step 6 — Inject what you learned into the BUILDERS, not just the conductor

The handoff binds the conductor; the daemon's build nodes never read it. The prompt-injection seam (`composeInjectedContext`, payloads A/C/D — default-on, self-gating) is how forge knowledge reaches the blueprint/implement/review nodes. Feed it:

1. **Locked constraints → constraint RECORDS.** For each locked rule in the constitution header, `create_decision_record { kind: 'constraint', title: <the rule, one line>, rationale }` then `approve_decision_record` (constraints start proposed; only ACTIVE ones inject). Payload C now delivers them to every blueprint/implement/review node, and the review cite-check has real ids to verify. A constitution rule that exists only as handoff prose is a prompt-prohibition — decoration to the builder who never sees it.
2. **Consult synthesis → decision records WITH `alternatives`.** You already record design-changing consults (Step 2); make sure the REJECTED designs go in the `alternatives` array verbatim — payload D surfaces them to blueprint nodes as "do not re-propose", the automated half of the "name the plausible-looking wrong fix" rule.
3. **Survey file map → the project digest.** Distill the structural inventory's orientation facts (where the subsystems live, the key seams, what is vestigial) into `.collab/project-digest.md` (Write tool, ≤ ~2k tokens, headline facts only — it is injected into every blueprint node, so every byte is a per-leaf tax). Payload A picks it up automatically.

Skipping this step means the mission's own builders work blind to the mission's own rules — the friction you forged the mission to remove.

## Anti-patterns

- You designed from the friction list without reading the mechanism (or vice versa) → half-blind; do both.
- The consult came back all-agreement → reframe it adversarially and run it again.
- You created the mission while the mission-driving machinery still has the bug you're targeting → fix the bootstrap path first.
- A criterion says "improve/better/cleaner" → not falsifiable; name the test or the threshold.
- The handoff says "see discussion" → the discussion dies with the context window; the constitution must be self-contained.
- You skipped the out-of-scope list → the conductor will rediscover every deferred idea as new scope.
