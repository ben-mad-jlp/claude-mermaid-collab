I have a complete picture. Here is the implementation blueprint.

---

# Blueprint: Offline end-to-end harness test + exportable score/gate wiring + fixture mode

## Context

`scripts/blueprint-lab/` is a standalone measurement harness (`emit.ts` → `score.ts` → `run.ts`). Today it can **only** run against a live `claude -p` node (`emit.ts:87 runEmitNode`, `emit.ts:117 checkoutBase`), which is slow, nondeterministic, network-bound, and unrunnable in the mechanical gate / CI. Its three scripts each end with a bare, unguarded `main()` call (`emit.ts:185`, `score.ts:149`, `run.ts:204`), so importing any of them for testing fires the whole pipeline as an import side effect. The pure logic (validation classification, aggregation, gate verdict, report rendering) is trapped inside those modules with no exports.

The gate lane was already prepared for this leaf: commit `f78d19a6` added `{ "match": "^scripts/", "command": "bun test {file}" }` to `.collab/project.json` **naming `scripts/blueprint-lab/__tests__/harness.test.ts` in its message** — that is the intended test path.

This leaf does three things: (1) a **fixture mode** so `emit.ts` can synthesize `EmitResult`s from on-disk reply text with no spawn/checkout; (2) **exportable score/gate wiring** so the pure functions are importable and each `main()` is guarded by `import.meta.main`; (3) an **offline end-to-end test** that drives emit-fixture → score → gate purely, asserting both a PASS and an ESCALATE outcome.

## Change 1 — `scripts/blueprint-lab/emit.ts` (fixture mode + exports + main guard)

- Import `readFileSync` (already imports `writeFileSync, mkdirSync, rmSync` from `node:fs` at line 13 — add `readFileSync`), and `existsSync`.
- Export the `EmitResult` interface (currently declared un-exported at line 124): add `export`.
- Add a pure, spawn-free core function:
  ```ts
  export function emitResultFromText(
    id: string,
    leafKindExpected: CorpusCase['leafKind'],
    text: string,
  ): EmitResult {
    return { id, leafKindExpected, contract: parseDiffContract(text), rawText: text };
  }
  ```
- Add a module-level fixture-dir read: `const FIXTURE_DIR = process.env.BLUEPRINT_FIXTURE_DIR;`
- In `runOne` (line 131): when `FIXTURE_DIR` is set, **skip `checkoutBase` and `runEmitNode` entirely** — read `join(FIXTURE_DIR, `${c.id}.emit.md`)` as the reply text (throw a clear error if the fixture file is absent), build the result via `emitResultFromText`, and still write the per-case `results/<id>.emit.md`. The live path (checkout + spawn) stays exactly as-is when `FIXTURE_DIR` is unset. Concretely, branch at the top of `runOne`:
  ```ts
  if (FIXTURE_DIR) {
    const fixturePath = join(FIXTURE_DIR, `${c.id}.emit.md`);
    if (!existsSync(fixturePath)) throw new Error(`no fixture for ${c.id} at ${fixturePath}`);
    const text = readFileSync(fixturePath, 'utf8');
    const r = emitResultFromText(c.id, c.leafKind, text);
    writeFileSync(join(OUT, `${c.id}.emit.md`), text);
    return r;
  }
  ```
- Guard the entrypoint: replace the bare `main();` at line 185 with `if (import.meta.main) main();` (same idiom as `scripts/parent-epic-under-mission.ts:...` `if (import.meta.main) { process.exit(main(...)); }`).

## Change 2 — `scripts/blueprint-lab/score.ts` (exports + main guard)

- Add `export` to the pure functions and the types the test/consumers need: `classifyValidation` (line 40), `declaredFiles` (line 46), `scoreFileMatch` (line 63), `scoreCase` (line 87), `aggregate` (line 112), and the `EmitResult`, `RunSummary`, `ValidationMode`, `FileMatchStats`, `CaseScore`, `AggregateStats` type declarations. `scoreCase(r, corpusById)` already takes the corpus map as a parameter, so a test can pass its own map — no change to its signature.
- Guard: replace `main();` at line 149 with `if (import.meta.main) main();`.

## Change 3 — `scripts/blueprint-lab/run.ts` (gate exports + main guard)

- Add `export` to `computeGateVerdict` (line 80), `buildReport` (line 127), the `GATE_MIN_ACCEPT_RATE`/`GATE_MIN_MATCH_RATE` constants (lines 22-23), and the `RunSummary`, `AggregateStats`, `ScoreFile`, `GateVerdict` type declarations.
- Guard: replace `main();` at line 204 with `if (import.meta.main) main();`.

## Change 4 — `scripts/blueprint-lab/__tests__/harness.test.ts` (new — offline e2e)

New `bun:test` file. It does **not** depend on the volatile mined `CORPUS` (its ids are live commit SHAs); it builds a small in-test synthetic corpus + fixtures in a temp dir, then drives the full pipeline through the newly-exported functions with zero node spawn / zero git checkout.

- Imports: `describe, it, expect, afterEach` from `bun:test`; `emitResultFromText` from `../emit`; `scoreCase, aggregate` from `../score`; `computeGateVerdict, buildReport` from `../run`; `parseDiffContract` (sanity) from `../../../src/services/diff-contract`.
- Build fixture reply texts inline: one well-formed v2 `feature` contract whose trailing ```json``` fence includes a `symbol-present` and a `named-test` requirement and whose `filesToEdit` matches a synthetic case's `diff.touchedFiles` (drives an `accept` + high match rate); one reply with **no** json fence (drives `parse-null`).
- **`emit fixture mode` test** (`it('emit fixture mode — a valid v2 fixture reply parses to a contract')`): call `emitResultFromText('c1', 'feature', <goodText>)` and assert `.contract` is non-null with `leafKind === 'feature'`; call it with the fence-less text and assert `.contract === null`.
- **`gate PASS` test** (`it('gate — a mostly-accepting run yields PASS')`): assemble ≥3 accepting `EmitResult`s (via `emitResultFromText`), a matching in-test `corpusById` map, run `scoreCase` for each → `aggregate` → `computeGateVerdict`, assert `verdict.verdict === 'PASS'`.
- **`gate ESCALATE` test** (`it('gate — a mostly-parse-null run yields ESCALATE with prose+normalize recommendation')`): assemble a set dominated by `contract: null` results, run the same chain, assert `verdict.verdict === 'ESCALATE'` and `verdict.recommendation` contains `'prose+normalize'` (exercises the `dominantKey === 'parse-null'` branch at `run.ts:102`).
- **`report` test** (`it('report renders the GATE verdict line')`): call `buildReport(run, score, verdict)` and assert the returned string contains `'## GATE verdict'` and the verdict token.

## Change 5 — `scripts/blueprint-lab/README.md` (document fixture mode)

Under `## Env vars` (line 28), add a bullet documenting `BLUEPRINT_FIXTURE_DIR`: when set, `emit.ts` reads `<dir>/<caseId>.emit.md` as each case's reply text instead of spawning a live node, enabling deterministic offline runs. Note the offline test at `__tests__/harness.test.ts` under `## Output`/`## Scope`.

## Acceptance criteria (positive, citable)

1. `scripts/blueprint-lab/emit.ts` exports `emitResultFromText(id, leafKindExpected, text)` returning `{ contract: parseDiffContract(text), ... }` — pure, no spawn/checkout.
2. `scripts/blueprint-lab/emit.ts` reads `process.env.BLUEPRINT_FIXTURE_DIR` and, when set, `runOne` returns via the fixture file `<dir>/<id>.emit.md` without calling `checkoutBase`/`runEmitNode`.
3. `scripts/blueprint-lab/emit.ts`, `score.ts`, and `run.ts` each end with `if (import.meta.main) main();` (guarded entrypoint).
4. `scripts/blueprint-lab/run.ts` exports `computeGateVerdict`; `scripts/blueprint-lab/score.ts` exports `scoreCase` and `aggregate`.
5. `scripts/blueprint-lab/__tests__/harness.test.ts` exists and its named tests pass under `bun test`, asserting a PASS verdict and an ESCALATE verdict offline.

```json
{ "schemaVersion": 2, "estimatedFiles": 5, "estimatedTasks": 5,
  "nonEnumerableFanout": false,
  "filesToCreate": ["scripts/blueprint-lab/__tests__/harness.test.ts"],
  "filesToEdit": ["scripts/blueprint-lab/emit.ts", "scripts/blueprint-lab/score.ts", "scripts/blueprint-lab/run.ts", "scripts/blueprint-lab/README.md"],
  "tasks": [
    { "id": "emit-fixture-mode", "files": ["scripts/blueprint-lab/emit.ts"], "description": "Add emitResultFromText export + BLUEPRINT_FIXTURE_DIR branch in runOne (no spawn/checkout) + import.meta.main guard" },
    { "id": "score-exports", "files": ["scripts/blueprint-lab/score.ts"], "description": "Export scoreCase/aggregate/classifyValidation/scoreFileMatch/declaredFiles + types; guard main with import.meta.main" },
    { "id": "gate-exports", "files": ["scripts/blueprint-lab/run.ts"], "description": "Export computeGateVerdict/buildReport + GATE constants + types; guard main with import.meta.main" },
    { "id": "offline-e2e-test", "files": ["scripts/blueprint-lab/__tests__/harness.test.ts"], "description": "Offline emit-fixture→score→gate test asserting PASS and ESCALATE verdicts + report line" },
    { "id": "readme-fixture-doc", "files": ["scripts/blueprint-lab/README.md"], "description": "Document BLUEPRINT_FIXTURE_DIR env var and offline harness test" }
  ],
  "leafKind": "test",
  "requirements": [
    { "kind": "symbol-present", "file": "scripts/blueprint-lab/emit.ts", "symbol": "emitResultFromText", "description": "Pure spawn-free core that turns a reply text into an EmitResult; enables fixture mode + offline testing" },
    { "kind": "symbol-present", "file": "scripts/blueprint-lab/run.ts", "symbol": "computeGateVerdict", "description": "Gate verdict must be exported so the offline harness test can assert PASS/ESCALATE without shelling out" },
    { "kind": "symbol-present", "file": "scripts/blueprint-lab/score.ts", "symbol": "aggregate", "description": "Aggregation must be exported so the offline test can build AggregateStats to feed the gate" },
    { "kind": "named-test", "testFile": "scripts/blueprint-lab/__tests__/harness.test.ts", "testName": "gate — a mostly-accepting run yields PASS", "mechanical": true },
    { "kind": "named-test", "testFile": "scripts/blueprint-lab/__tests__/harness.test.ts", "testName": "gate — a mostly-parse-null run yields ESCALATE with prose+normalize recommendation", "mechanical": true },
    { "kind": "named-test", "testFile": "scripts/blueprint-lab/__tests__/harness.test.ts", "testName": "emit fixture mode — a valid v2 fixture reply parses to a contract", "mechanical": true }
  ],
  "outOfScope": ["Wiring the lab gate verdict into any real daemon/leaf-executor decision", "Changing diff-contract.ts, node-invoker.ts, or corpus.ts", "Adding on-disk fixture corpus files under version control (the test builds fixtures in a temp dir at runtime)"] }
```