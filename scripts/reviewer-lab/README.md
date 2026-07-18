# reviewer-lab

A faithful regression rig for the daemon's **floor review node** (the `blueprint → implement →
review` gate in `src/services/leaf-executor.ts`).

Each corpus case builds an isolated git repo (base commit + the "implemented" working-tree change),
runs the **real** review-node prompt — `buildNodePrompt('review', leaf, blueprint)` via `claude -p`
with the exact executor NodeSpec flags (`buildNodeArgv`, read-only tools) — then computes the **net**
verdict with the real gating functions (`parseVerdict` + `validateReviewGrounding` +
`isNonFalsifiableReviewDoubt` + `uncitedCriteriaAreAllCommandResults`), modelling the mech-GREEN arm.
It scores each case against an `accept`/`reject` label.

## Run

```bash
# full corpus at the PRODUCTION config (sonnet/medium) — the default
bun scripts/reviewer-lab/run.ts

# a subset, by id
bun scripts/reviewer-lab/run.ts js-oneline-ok H-injection-bug

# override the model/effort (NODE_PROFILE default is opus/high)
REVIEW_MODEL=opus REVIEW_EFFORT=high bun scripts/reviewer-lab/run.ts
```

Raw per-case reviews and a `run.json` summary land in `results/` (gitignored).

## Pure-heuristic probes (no LLM, instant)

```bash
bun scripts/reviewer-lab/probe-doubt.ts      # isNonFalsifiableReviewDoubt classifier
bun scripts/reviewer-lab/probe-samewall.ts   # sameReviewWall repeat detector
```

## MODEL FIDELITY — read this

Measure at the model the daemon actually runs. `NODE_PROFILE.review` defaults to **opus/high**, but
projects commonly override review to **sonnet/medium** via `node_profile_override`. The reviewer's
behaviour differs by model: sonnet/medium applies **stricter edge-case scrutiny** and will fail a
change with an untested edge (e.g. a missing clamp) that opus phrases past. `run.ts` therefore
**defaults to sonnet/medium** — the production config — not the code default.

## Labeling discipline

When a case "fails", first check whether the **label** is right, not the reviewer. A corpus case
labeled `accept` must be code that is correct **including its edges** — sonnet will (correctly) fail
code with a real edge-case bug, and "fixing" the reviewer to pass it would train it to miss real
bugs. Verify the code (run it) before counting a failure as an over-rejection.

## Corpus

- `cases.ts` — 15 baseline cases (simple/medium, common concepts).
- `cases-hard.ts` — over-rejection traps (absence/non-goal & command-result criteria, deletion,
  multi-file coordination, retained code) + subtle bugs (missing await, injection, off-by-one at a
  boundary, resource leak, shared mutable default).
- `cases-mean.ts` — over-rejection inducers (correct code that superficially looks wrong) + bugs
  buried in realistic noise. Widens language coverage (java, c, bash, yaml).
