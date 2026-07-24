# Finding — the `^ui/` suites lane cannot be baselined

## Config asymmetry

`.collab/project.json` declares two independent test lanes for the base gate, and they
are not symmetric. `gate.floors[0]` runs the backend suite with an explicit recorded
baseline: `bun run scripts/test-backend.ts --baseline=scripts/backend-test-baseline.json`.
`gate.suites[0]` — the `^ui/` lane — is a bare `bunx vitest --run` in `cwd: ui`, with no
baseline argument of any kind. The backend floor lane can tell the gate "these specific
failures are already known"; the UI suite lane has no equivalent mechanism at the command
level.

## The differential that already exists

That asymmetry is partly compensated in code, not config. `runBaseGate`
(`src/services/leaf-gate.ts:799`) runs every declared lane — typecheck, `typechecks[]`,
`suites[]`, `floors[]`, `baseTest` — in fixed order and never short-circuits on the first
red lane. For each lane that RAN but exited non-zero, it memoizes
`extractFailingTests(r.output)` into a `baselineFailures` map under the key
`suites:^ui\/` (`src/services/leaf-gate.ts:836-846`). That map is cached per epic by the
`epic_base_gate` ledger via `ensureBaseGreen` (`src/services/leaf-executor.ts:4324-4358`),
keyed by `epicId` alone so the base lanes run once per epic, not once per leaf. At leaf
level, `runLeafGate` reads that cached baseline and calls `classifyRedLane`
(`src/services/leaf-gate.ts:756-757`) to diff the leaf's own lane failures against it — so
a leaf-scoped net-new differential for this lane already ships today.

## Why the base gate still parks every leaf

The differential above only helps once a leaf is allowed to run. The G2 base gate
(`src/services/leaf-executor.ts:2755-2775`) parks on `base.status !== 'pass'` outright,
irrespective of whether the base's recorded failures are all baseline-known. This held
leaf `8a422d85` (epic `62cd0c39`) and leaf `b6b58fd0` (epic `702cf4e3`) at attempts 0 /
$0 spent. The one existing carve-out should be stated honestly: the `baseRepair` epic
exemption (`src/services/leaf-executor.ts:2762-2770`, bug 65345589) lets an epic
explicitly flagged `baseRepair` run its leaves anyway under net-new gate semantics — but
that exemption is scoped to epics whose purpose is fixing the red lane. Every other epic
sitting on the same red base stays held.

## The sharper gap: an unbaselineable lane

Even the leaf-level differential from section 2 depends on `extractFailingTests`
(`src/services/gate-runner.ts:341-351`) being able to parse the lane's output. It matches
only `FAIL <file>` lines and `× / ✗ / ✕ <name>` lines. The observed `^ui/` run — per the
incident record, not re-derived here — reported 296/296 files and 3775 tests passing, and
exited 1 solely from 26 unhandled errors outside any test body. None of those errors match
either pattern, so `extractFailingTests` yields **zero** fingerprints and the recorded
baseline for `suites:^ui\/` is empty. `classifyRedLane` (`src/services/leaf-gate.ts:532-534`)
fails closed on `failing.length === 0`, always returning `(unparsed lane failure)` as
net-new rather than trusting an empty match set. The consequence: a lane that exits
non-zero with no parseable failures is structurally unbaselineable. No recorded baseline
can ever match it and no leaf-level exemption can excuse it, so it blocks every epic on
that base permanently until the lane itself is repaired.

## Recommendation and risk

Recommend that the base-gate hold at `src/services/leaf-executor.ts:2755-2775`
distinguish two currently-identical cases: red-with-a-non-empty-recorded-baseline (a lane
whose failures are attributable and already known) versus red-with-no-parseable-failures
(this lane's actual state). Blanket loosening of the base-gate hold is the wrong answer:
`classifyRedLane`'s fail-closed arm exists precisely so an unattributable red never passes
silently, and a base gate that admitted any unparsed-red base would let genuinely broken
bases through project-wide, not just this one lane. The residual risk of the recommended
split: an epic whose real, non-baseline regression happens to also be unparseable (another
unhandled-error-shaped failure) would still be indistinguishable from a benign one under
this scheme. The more durable fix is at the source — either make the `^ui/` lane's exit
condition itself parseable (attribute the 26 unhandled errors to failing specs) or resolve
the unhandled-error class directly, rather than teaching the base gate to tolerate opacity.
