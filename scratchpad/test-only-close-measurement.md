# Test-only-close route — whole-surface measurement

Run: `bun run scripts/measure-test-only-close-route.ts` (2026-07-30).

## 1. Failing-name diff (branch vs. `scripts/backend-test-baseline.json`)

The measurement script shells out to the existing `scripts/test-backend.ts --baseline=scripts/backend-test-baseline.json`
CLI (reuses `diffAgainstBaseline`, no parallel suite-runner). Full backend suite run, exit code `0`:

```
baseline diff: PASS — no net-new failing test files/names vs. scripts/backend-test-baseline.json
```

diff: empty — every currently-failing test file/name on this branch is a subset of the committed
baseline (`scripts/backend-test-baseline.json`, schema 2, 61 lines, generated 2026-07-30T05:20:30.369Z).
No `netNew` files, no `countGrowth` on already-baselined files.

## 2. Terminal-state dump — 5-tick `runConductorPass` fixture

Fixture (`runMeasurementFixture` in `scripts/measure-test-only-close-route.ts`): one mission with
two criteria — criterion I evidenced by a test path (`src/services/__tests__/conductor-pass.test.ts`)
with a `TO CLOSE` body, criterion II evidenced by a non-test src path
(`src/services/conductor-pass.ts`). Both burn `CRITERION_SERVE_CAP` serving epics + a
`re-decompose` rung before the verdicts are set, so `ladderExhausted` reads exhausted from tick 1.
`runConductorPass` driven 5 times with the faithful `okInvoke` mock.

- **Close-out leaf (criterion I, test-only path):**
  - close-out epic id: `64da4872-6dad-408f-abb2-77c0af2154e2`
  - close-out leaf id: `d7bbfdcf-d142-4092-87fe-a735528d989a`
  - `isClaimable(leaf, byId)` → `true`
  - exactly one close-out epic, exactly one child leaf (asserted by `runMeasurementFixture`)

- **Serve-cap escalation (criterion II, src path):**
  - escalation id: `7d54ed6d-a3a7-4441-b775-a9baa6309a3f`
  - `kind === CRITERION_SERVE_CAP_KIND`, `todoId === missionId`
  - `questionText` contains `serveCapMarker(critII.id)` AND the current `verifiedAtSha` (`fixedsha2`)
  - `conditionKey` family count (open `CRITERION_SERVE_CAP_KIND` cards for this mission): **1**

- **Zero-duplicate-leaves group check:** every `(parentId, title)` group across all todos in the
  fixture has size 1 after 5 ticks — `duplicateLeafGroups === 0`.

Summary line printed by the script:

```
OK: 1 claimable close-out leaf (epic=64da4872-6dad-408f-abb2-77c0af2154e2, leaf=d7bbfdcf-d142-4092-87fe-a735528d989a); 1 current-verdict serve-cap card (escalation=7d54ed6d-a3a7-4441-b775-a9baa6309a3f); 0 duplicates.
```

Cheap unit-test coverage of the same terminal-state contract (without the full backend suite) lives
in `scripts/__tests__/measure-test-only-close-route.test.ts`.
