<!-- blueprint-lab-emit model=sonnet effort=medium -->
I have enough to write the blueprint now.

## Blueprint: Offline end-to-end harness test + exportable score/gate wiring + fixture mode

### Context

`scripts/blueprint-lab/` (emit.ts, score.ts, run.ts, corpus.ts) is a measurement harness that mines real landed commits from git history (`corpus.ts:171` `CORPUS`), spawns the **real** `claude -p` node per case (`emit.ts:87-115` `runEmitNode`, called from `emit.ts:131-152` `runOne`), scores the parsed contracts (`score.ts`), and computes a PASS/ESCALATE gate (`run.ts:80-125` `computeGateVerdict`). Today this pipeline is untestable offline: `runOne` always calls the real node (network+CLI dependent), and both `emit.ts` (`emit.ts:185` `main();`) and `run.ts` (`run.ts:204` `main();`) invoke `main()` unconditionally at module load — so merely `import`-ing either file for a test triggers the live CLI pipeline. `computeGateVerdict`/`buildReport` and their supporting types are also not exported, so nothing outside `run.ts` can reuse the gate logic. `.collab/project.json`'s `^scripts/` test lane (added in f78d19a6) already anticipates a `scripts/blueprint-lab/__tests__/harness.test.ts` file — the commit message for that lane names this exact path.

### Change shape

**1. `scripts/blueprint-lab/emit.ts` — fixture mode + guarded main + exports**

- Add a fixture-mode flag near the top-level consts (after `PROJECT` at line 29):
  ```ts
  const FIXTURE_MODE = process.env.BLUEPRINT_LAB_FIXTURE === '1';
  ```
- Add and `export` a new function `buildFixtureContractText(c: CorpusCase): string` that builds a synthetic-but-valid v2 contract deterministically from the corpus case (no LLM call): `leafKind: c.leafKind`, `filesToEdit: c.diff.touchedFiles`, and `requirements` containing one `symbol-present` (`file: c.diff.touchedFiles[0] ?? 'unknown'`, `symbol: 'FixtureSymbol'`) and one `named-test` (`testFile: 'fixture.test.ts'`, `testName: 'fixture case'`, `mechanical: true`) — this superset satisfies `CONTRACT_STRICTNESS_MATRIX` (diff-contract.ts:69-75) for every `DiffLeafKind`, so fixture-mode cases always score `accept`. Serialize with the existing `renderContract` (diff-contract.ts:232) imported alongside `parseDiffContract`.
- In `runOne` (emit.ts:131), branch at the top: when `FIXTURE_MODE`, skip `checkoutBase`/`runEmitNode` entirely, build `text = buildFixtureContractText(c)`, `contract = parseDiffContract(text)`, write `${c.id}.emit.md` same as today, and return the `EmitResult` — no network, no `spawn`, no `git archive`.
- Export `runOne` (drop its implicit-private status) so the new test can call it directly in-process.
- Guard the bottom (emit.ts:185): replace `main();` with
  ```ts
  if (import.meta.main) {
    main();
  }
  ```
  (matching the existing convention at `scripts/parent-epic-under-mission.ts:193-195`) so importing `runOne`/`buildFixtureContractText` from a test never triggers the live CLI sweep.

**2. `scripts/blueprint-lab/run.ts` — exportable gate/score wiring + guarded main**

- Add `export` to `computeGateVerdict` (run.ts:80) and `buildReport` (run.ts:127), and to the interfaces they consume/produce: `RunSummary` (run.ts:25), `AggregateStats` (run.ts:49), `ScoreFile` (run.ts:59), `GateVerdict` (run.ts:64), `CaseScore` (run.ts:40), `FileMatchStats` (run.ts:31). No behavior change — pure visibility change so the gate logic is importable by tests (and any future consumer) instead of copy-pasted.
- Guard the bottom (run.ts:204): replace `main();` with `if (import.meta.main) { main(); }`, same pattern as emit.ts.
- No change needed to `runChildOrThrow` (run.ts:70) — `spawnSync` with no explicit `env` already inherits `process.env`, so `BLUEPRINT_LAB_FIXTURE=1` set on the `run.ts` process automatically propagates to the `emit.ts` child it spawns.

**3. New file `scripts/blueprint-lab/__tests__/harness.test.ts`**

Bun test file (matches the `^scripts/` gate lane's `bun test {file}` command and mirrors the `scripts/__tests__/parent-epic-under-mission.test.ts` style: plain `bun:test` imports, no live network/CLI dependency):
- Unit-level: import `{ CORPUS }` from `../corpus`, `{ runOne, buildFixtureContractText }` from `../emit`, `{ validateContractForKind }` from `../../../src/services/diff-contract`; with `process.env.BLUEPRINT_LAB_FIXTURE = '1'` set in a `beforeAll`, call `runOne(CORPUS[0])` and assert `result.contract !== null`, `result.contract.leafKind === CORPUS[0].leafKind`, and `validateContractForKind(result.contract, result.contract.leafKind).underspecified === false`.
- End-to-end: `Bun.spawnSync(['bun', 'run', 'scripts/blueprint-lab/run.ts'], { cwd: REPO_ROOT, env: { ...process.env, BLUEPRINT_LAB_FIXTURE: '1' } })` (or `child_process.spawnSync`), then read back `scripts/blueprint-lab/results/score.json` and `results/report.md`, asserting: exit code `0`, `score.aggregate.validationCounts.accept === CORPUS.length`, and `report.md` contains `**PASS**` — proving the emit→score→run wiring is exercised offline end-to-end with no real LLM call.
- Import `{ computeGateVerdict }` from `../run` directly and assert it returns `{ verdict: 'PASS', ... }` given a hand-built `AggregateStats` with `validationCounts: { accept: 10 }`, `total: 10`, `meanMatchRate: 1` — proving the gate function itself is now exported and independently testable.

### Acceptance criteria

- `scripts/blueprint-lab/emit.ts` exports `runOne` and `buildFixtureContractText`, and its `main()` call is gated behind `if (import.meta.main)`.
- `scripts/blueprint-lab/run.ts` exports `computeGateVerdict`, `buildReport`, and their `RunSummary`/`AggregateStats`/`ScoreFile`/`GateVerdict`/`CaseScore`/`FileMatchStats` types, and its `main()` call is gated behind `if (import.meta.main)`.
- Setting `BLUEPRINT_LAB_FIXTURE=1` makes `emit.ts`'s `runOne` bypass `checkoutBase`/`runEmitNode` and produce a parseable, `accept`-scoring `DiffContract` for every `CorpusCase`, with no `spawn`/network call.
- `scripts/blueprint-lab/__tests__/harness.test.ts` exists, runs under `bun test`, and exercises the full emit→score→run pipeline offline (via `BLUEPRINT_LAB_FIXTURE=1`), asserting a `PASS` gate verdict from `results/report.md`.

```json
{ "schemaVersion": 2, "estimatedFiles": 3, "estimatedTasks": 4,
  "nonEnumerableFanout": false, "filesToCreate": ["scripts/blueprint-lab/__tests__/harness.test.ts"],
  "filesToEdit": ["scripts/blueprint-lab/emit.ts", "scripts/blueprint-lab/run.ts"],
  "tasks": [
    { "id": "fixture-mode", "files": ["scripts/blueprint-lab/emit.ts"], "description": "add BLUEPRINT_LAB_FIXTURE env flag, buildFixtureContractText, and fixture branch in runOne" },
    { "id": "guard-mains", "files": ["scripts/blueprint-lab/emit.ts", "scripts/blueprint-lab/run.ts"], "description": "gate main() calls behind if (import.meta.main)" },
    { "id": "export-gate-wiring", "files": ["scripts/blueprint-lab/run.ts"], "description": "export computeGateVerdict, buildReport, and their supporting types" },
    { "id": "harness-test", "files": ["scripts/blueprint-lab/__tests__/harness.test.ts"], "description": "offline e2e test exercising emit->score->run in fixture mode plus direct gate-function assertions" }
  ],
  "leafKind": "test",
  "requirements": [
    { "kind": "symbol-present", "file": "scripts/blueprint-lab/emit.ts", "symbol": "buildFixtureContractText", "description": "deterministic offline contract text generator used by fixture mode" },
    { "kind": "symbol-present", "file": "scripts/blueprint-lab/run.ts", "symbol": "computeGateVerdict", "description": "gate function must be exported for direct import in the harness test" },
    { "kind": "named-test", "testFile": "scripts/blueprint-lab/__tests__/harness.test.ts", "testName": "run.ts pipeline in fixture mode reaches PASS gate", "mechanical": true },
    { "kind": "named-test", "testFile": "scripts/blueprint-lab/__tests__/harness.test.ts", "testName": "computeGateVerdict returns PASS for a clean aggregate", "mechanical": true }
  ],
  "outOfScope": ["wiring blueprint-lab into leaf-executor.ts, diff-contract.ts, or the live daemon pipeline"] }
```