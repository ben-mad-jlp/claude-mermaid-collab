# Collab architecture — critical review (does it make sense? what to refactor?)

A steward's honest pass over the system as described in `design-collab-system-overview` + `glossary-collab-terms`, grounded in the code read this session (coordinator-live, supervisor-liveness, context-watchdog, the stores, FleetGraph, setup.ts). Separates **what's sound** from **what's debt**, with confidence levels.

## A. What genuinely makes sense (keep — don't touch)

These are load-bearing and well-chosen:

- **Durable state in SQLite + git → safe `/clear`/resume.** The whole "checkpoint → clear → resume" model works *because* nothing important lives in a session's head. This is the best decision in the system.
- **Authoritative gate overrides worker self-report.** Taking the accept/reject judgment away from the agent on anything computable is correct (the #6 lesson).
- **Never-auto-compact watchdog with a hard checkpoint gate.** Refusing to `/clear` without a verified-persisted checkpoint is the right safety interlock.
- **Server-owned liveness** (root owns supervisor liveness, not a per-project coordinator). We re-validated this in the failover design — the regress correctly ends at the root process.
- **Per-project manifest seam.** Keeps collab domain-agnostic while bsync/build123d plug in. Clean boundary.
- **Planner-only-promotes-to-`ready`.** A single, clear authority for "this is allowed to run." Good invariant.

## B. Conceptual debt (the model is fuzzy here)

### B1. "Session" is dangerously overloaded — *high confidence, high impact*
One word means: a collab session (project+name), a worker, the supervisor, a vibe, AND a tmux session. The overload directly *caused* friction this session — the self-watchdog needed a `self` tag precisely because "is this session me?" had no clean answer. **Refactor:** name the distinct concepts (e.g. *collab-session* vs *runtime/lane* vs *role-identity*) and use them consistently.

### B2. "Lane / Slot / Pool session" — three words, one thing — *high confidence, low effort*
The execution line is called all three across the code. Pure cognitive tax. **Refactor:** pick one canonical term, alias the others.

### B3. "Type / profile / pool-type" — three names for the routing key — *high confidence, low effort*
`todo.type` → pool-type → (planned) agent-profile. The Profiles epic (`5f6ab046`) will make this worse if we don't fix the vocabulary first. **Refactor:** define the canonical chain before building L1–L4.

## C. Structural debt (architecture, not just naming)

### C1. Shared working tree — *the keystone* (`40d38438`, ready)
Already identified + designed (integration-branch recombination). Almost every sharp edge this session traces here: cross-lane gate contamination, *and* committed-history divergence (the merge near-miss). **This is the #1 refactor.** Everything about safe parallelism waits on it.

### C2. The gate is whole-project + single-layer — *medium confidence*
Two coupled issues: (a) the gate runs the project's whole `gateCommand` (`tsc --noEmit`) even though a worker changed 3 files — on a shared tree a sibling's breakage fails *my* gate (the contamination symptom); (b) it's mechanical-only — correctness, not fitness (`7fc8bac5`/#7, ready). **Refactor:** scope the gate to the change-set (coupled to C1) *and* add the fitness/judgment layer (#7). These are the same "what does 'done' mean" question from two sides.

### C3. "Liveness & identity" data is fragmented across 3 stores — *medium confidence*
"Who is alive and what are they doing" is split: `contextPercent`/status → session-status.db; supervisor identity/heartbeat → supervisor.db; worker claims/leases → todo-store.db. The self-watchdog had to reach across all three. **Examine:** a unified *session-runtime* view (or at least a single read model) so liveness logic stops being cross-store stitching.

### C4. Coordinator vs Supervisor overlap in "watching workers" — *needs verification*
Both loops watch running workers: the Coordinator reaps dead slots + recovers stalled lanes; the Supervisor reconciles + escalates idle-at-prompt. Two watchers from different angles. **Examine:** is the boundary crisp ("Coordinator owns liveness/slots; Supervisor owns human-escalation"), or is there redundant detection that should be consolidated? Worth a deliberate delineation in the glossary.

## D. Code-structure debt (maintainability)

### D1. `setup.ts` is a monolithic tool switch — *high confidence, felt firsthand*
~200 MCP tools dispatched through one giant `switch` in one file. We hit this pain directly: every steward edit + the friction WIP pile into the same file, which is exactly why "commit just my change" turned into stash-and-verify gymnastics. **Refactor:** modularize handlers (the schemas already live in `tools/`; move the `case` bodies there too) so unrelated work stops colliding in one file. This *also* reduces C1's shared-tree contamination surface.

### D2. 6 artifact types × full CRUD tool surface — *low confidence, worth a look*
documents/diagrams/designs/snippets/spreadsheets/embeds each carry near-duplicate create/get/update/list/revert tools. Possibly over-factored. **Examine:** is the duplication justified by real per-type behavior, or could a common artifact core shrink the surface?

## E. Operational debt

### E1. Deploy is manual + footgun-laden — *high confidence*
The `mc-server` sidecar survives `quit app` (detached), so a redeploy silently reconnects to the stale server unless you kill+relaunch (we hit this live). And we deploy from the *working tree*, so the live binary can be ahead of committed history. **Refactor:** a deploy script (kill sidecar → build ui + sidecar → swap with backup → relaunch → health-check the new PID), and decide whether deploy should build from a clean commit, not the working tree.

## F. Ranked refactor backlog (my recommendation)

1. **Shared-tree isolation** (`40d38438`) — unblocks safe parallelism; fixes the deepest hazard. *Already ready.*
2. **Vocabulary unification** (B1–B3) — cheap, high clarity ROI, and a prerequisite for the Profiles epic. *Do before 5f6ab046.*
3. **Fitness gate + change-set-scoped gate** (#7 + C2) — the "what is done" question. *#7 already ready.*
4. **`setup.ts` modularization** (D1) — reduces collision surface; compounds with C1.
5. **Unified session-runtime read model** (C3) — stops liveness being cross-store stitching.
6. **Coordinator/Supervisor boundary** (C4) — clarify before adding more autonomy.
7. **Deploy script** (E1) — operational hygiene.

## G. Open questions for discussion

- Is the **role count** (Steward + PCS + Worker + Reconcile) the right number, or are Coordinator/Supervisor really one role with two loops?
- Should **vocabulary** be locked in the glossary as canonical (with a lint/test), or left to convention?
- Does **fitness review** belong as a gate stage, a separate review pass (like vibe-review), or a human-only step?
- Is building from the **working tree** ever acceptable for deploy, or should deploy require a clean tree as policy?
