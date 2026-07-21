I have enough to author the blueprint. This is a greenfield leaf module — the v2 `DiffContract` is a superset of the existing `LeafSizeManifest` (`src/services/leaf-executor.ts:261`), and the fail-safe parser + fenced-block extraction mirror `parseSizeManifest` (`src/services/leaf-executor.ts:1182`) and `parseSplitDecision` (`src/services/split-decision.ts:26`). The `requirements[]` concept (symbol-present/named-test/threshold) is entirely new — nothing exists yet.

---

# Blueprint — Create `src/services/diff-contract.ts` (v2 DiffContract type, fail-safe parser, round-trip renderer)

## Context / grounding
- The current "what a leaf touches" contract is `LeafSizeManifest` (schemaVersion 1) declared at `src/services/leaf-executor.ts:261-274` and parsed by `parseSizeManifest` at `src/services/leaf-executor.ts:1182-1231`. That parser is **fail-safe**: any structural failure → `null`; it extracts the **last** ` ```json ` fence via the regex at `src/services/leaf-executor.ts:1187` and validates types field-by-field.
- The peer leaf module `src/services/split-decision.ts` is the style template: a standalone module with a `parseX(raw: unknown): X | null` validator that never throws (`src/services/split-decision.ts:26-60`), plus small pure helpers. Kept as a leaf module to avoid circular imports.
- Tests for these peer modules use **`bun:test`** (`src/services/__tests__/split-decision.test.ts:1`). This is a Bun-tested backend module (per project dual-runner convention).
- **v2 delta over v1 `LeafSizeManifest`:** `schemaVersion: 2` + three new fields — `leafKind`, `requirements[]`, `outOfScope[]` — while carrying the six v1 fields (`estimatedFiles`, `estimatedTasks`, `nonEnumerableFanout`, `filesToCreate`, `filesToEdit`, `tasks`) unchanged so the type stays a superset (additive-only discipline noted at `src/services/leaf-executor.ts:256-259`).

This leaf ONLY creates the new module + its test. It does **not** rewire `leaf-executor.ts` to consume the new type (that is a separate downstream leaf) — see Out of scope.

## File to create: `src/services/diff-contract.ts`

### 1. Types (exported)
```ts
export type LeafKind = 'feature' | 'fix' | 'refactor' | 'test' | 'infra';

export interface SymbolPresentRequirement {
  kind: 'symbol-present';
  file: string;
  symbol: string;
  description: string;
}
export interface NamedTestRequirement {
  kind: 'named-test';
  testFile: string;
  testName: string;
  mechanical: true;
}
export interface ThresholdRequirement {
  kind: 'threshold';
  source: 'gate-output' | 'grep-count';
  metric: string;
  comparison: 'gte' | 'lte' | 'eq';
  value: number;
  mechanical: true;
}
export type DiffRequirement =
  | SymbolPresentRequirement | NamedTestRequirement | ThresholdRequirement;

export interface DiffContract {
  schemaVersion: 2;
  estimatedFiles: number;
  estimatedTasks: number;
  nonEnumerableFanout: boolean;
  filesToCreate: string[];
  filesToEdit: string[];
  tasks: Array<{ id: string; files: string[]; description: string }>;
  leafKind: LeafKind;
  requirements: DiffRequirement[];
  outOfScope: string[];
}
```
- `schemaVersion` is the literal `2` (a v1 manifest — `schemaVersion !== 2` or absent — must NOT parse as a DiffContract; that is what keeps v1 and v2 distinct).

### 2. `parseDiffContract(...sources: Array<string | undefined>): DiffContract | null`
- Signature and fail-safe posture **mirror `parseSizeManifest`** (`src/services/leaf-executor.ts:1182-1231`): accept multiple sources, iterate, extract the **last** ` ```json ` fence with the identical regex `/```json\s*([\s\S]*?)```/g`, `JSON.parse` inside `try/catch`, and on ANY failure `continue` to the next source, finally returning `null`. **Never throws.**
- Also accept a source that is itself bare JSON (no fence): if no fence matches, attempt to `JSON.parse` the whole trimmed source as a fallback so `parseDiffContract(JSON.stringify(obj))` works. (This makes the renderer's raw-JSON form round-trip too; keep it inside the same try/catch.)
- Validation rules (reject → try next source → ultimately `null`):
  - `schemaVersion === 2` (strict equality; any other value or missing → reject).
  - `estimatedFiles`, `estimatedTasks`: finite numbers `>= 0` (same checks as `src/services/leaf-executor.ts:1196-1197`).
  - `nonEnumerableFanout`: boolean.
  - `leafKind` ∈ the 5 `LeafKind` values; otherwise reject.
  - `filesToCreate`, `filesToEdit`, `outOfScope`: coerce via a local `toStrArr` (Array → keep only strings), mirroring `src/services/leaf-executor.ts:1202-1203`.
  - `tasks`: same normalization as `src/services/leaf-executor.ts:1204-1211` (`{ id, files, description }`, defaults `''`/`[]`).
  - `requirements`: normalize per-entry via a private `parseRequirement(raw: unknown): DiffRequirement | null`; **drop** entries that return `null` (lenient, mirroring how `tasks` filters), so a single bad requirement never nulls the whole contract.
- `parseRequirement` (private, not exported) validates by discriminant:
  - `symbol-present`: non-empty `file` and `symbol` strings; `description` string (default `''`).
  - `named-test`: non-empty `testFile` and `testName` strings; force `mechanical: true`.
  - `threshold`: `source` ∈ {`gate-output`,`grep-count`}, non-empty `metric`, `comparison` ∈ {`gte`,`lte`,`eq`}, finite numeric `value`; force `mechanical: true`.
  - Anything else → `null`.
- Return a fully-normalized `DiffContract` object literal (canonical field order matching the interface).

### 3. `renderContract(contract: DiffContract): string`
- Produce the **canonical fenced serialization**: a string beginning with a ` ```json ` line, the pretty-printed (`JSON.stringify(obj, null, 2)`) canonical object, and a closing ` ``` ` line — so its output is directly parseable by `parseDiffContract` (and by the existing fence-extraction path).
- Build the object with a **fixed key order** (schemaVersion, estimatedFiles, estimatedTasks, nonEnumerableFanout, filesToCreate, filesToEdit, tasks, leafKind, requirements, outOfScope) and normalize nested entries (tasks, requirements) so the output is deterministic.
- **Round-trip invariant:** `parseDiffContract(renderContract(c))` deep-equals the normalized `c` for any valid `c`. This is the acceptance-defining behavior and must be covered by a named test.

## File to create: `src/services/__tests__/diff-contract.test.ts`
- `import { describe, it, expect } from 'bun:test';` (matches `src/services/__tests__/split-decision.test.ts:1`).
- Import `parseDiffContract`, `renderContract`, and the types from `../diff-contract`.
- Named tests to add:
  - `it('round-trips a full contract through renderContract → parseDiffContract', ...)` — build a `DiffContract` with all three requirement kinds populated, assert `parseDiffContract(renderContract(c))` `toEqual` the normalized `c`. **This is the round-trip requirement.**
  - `it('returns null on non-JSON / no fence / malformed input', ...)` — fail-safe: `parseDiffContract(undefined)`, `parseDiffContract('no fence here')`, `parseDiffContract('```json {bad ```')` all `toBeNull()`, and it never throws.
  - `it('rejects a schemaVersion 1 manifest', ...)` — a v1-shaped object (`schemaVersion: 1`) → `toBeNull()`, proving v1/v2 separation.
  - `it('drops malformed requirement entries but keeps valid ones', ...)` — a contract whose `requirements` array mixes one valid + one junk entry parses to the contract with only the valid requirement retained.
  - `it('rejects an out-of-range leafKind', ...)` — `leafKind: 'wat'` → `toBeNull()`.

## Verification (mechanical)
- `npm run test:ci -- src/services/__tests__/diff-contract.test.ts` passes (all named tests green).
- Type-checks under the existing backend tsconfig (no new tsc errors introduced by the new module).

## Acceptance criteria (positive, citable)
1. `src/services/diff-contract.ts` exports an interface `DiffContract` whose `schemaVersion` field is the literal type `2` and which carries `leafKind`, `requirements`, and `outOfScope` alongside the six v1 fields — a reviewer can point at the interface declaration.
2. `src/services/diff-contract.ts` exports a union type `DiffRequirement` = `SymbolPresentRequirement | NamedTestRequirement | ThresholdRequirement`, each with its `kind` discriminant literal.
3. `src/services/diff-contract.ts` exports `parseDiffContract(...sources)` that extracts the last ` ```json ` fence (or falls back to bare-JSON), validates `schemaVersion === 2` and `leafKind` membership, and returns `null` on any failure inside a `try/catch` (never throws).
4. `parseDiffContract` normalizes `requirements` through a per-entry validator that drops malformed entries while keeping valid ones (citable at the `requirements` map/filter line).
5. `src/services/diff-contract.ts` exports `renderContract(contract)` that emits a ` ```json ` fenced, `JSON.stringify(_, null, 2)` canonical block with fixed key order.
6. `src/services/__tests__/diff-contract.test.ts` contains a test named `round-trips a full contract through renderContract → parseDiffContract` asserting `parseDiffContract(renderContract(c))` equals the normalized contract.
7. `src/services/__tests__/diff-contract.test.ts` contains a test named `rejects a schemaVersion 1 manifest` asserting a v1-shaped object yields `null`.

```json
{ "schemaVersion": 2, "estimatedFiles": 2, "estimatedTasks": 2,
  "nonEnumerableFanout": false,
  "filesToCreate": ["src/services/diff-contract.ts", "src/services/__tests__/diff-contract.test.ts"],
  "filesToEdit": [],
  "tasks": [
    { "id": "module", "files": ["src/services/diff-contract.ts"], "description": "v2 DiffContract type + DiffRequirement union + parseDiffContract (fail-safe) + renderContract (round-trip fenced)" },
    { "id": "tests", "files": ["src/services/__tests__/diff-contract.test.ts"], "description": "bun:test suite: round-trip, fail-safe null, v1 rejection, requirement drop, bad leafKind" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "symbol-present", "file": "src/services/diff-contract.ts", "symbol": "DiffContract", "description": "v2 interface with literal schemaVersion 2 plus leafKind/requirements/outOfScope" },
    { "kind": "symbol-present", "file": "src/services/diff-contract.ts", "symbol": "DiffRequirement", "description": "union of symbol-present | named-test | threshold requirement types" },
    { "kind": "symbol-present", "file": "src/services/diff-contract.ts", "symbol": "parseDiffContract", "description": "fail-safe parser extracting last json fence, validating schemaVersion===2, never throws" },
    { "kind": "symbol-present", "file": "src/services/diff-contract.ts", "symbol": "renderContract", "description": "canonical fenced json serializer enabling round-trip" },
    { "kind": "named-test", "testFile": "src/services/__tests__/diff-contract.test.ts", "testName": "round-trips a full contract through renderContract → parseDiffContract", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/diff-contract.test.ts", "testName": "rejects a schemaVersion 1 manifest", "mechanical": true }
  ],
  "outOfScope": [
    "Rewiring leaf-executor.ts / parseSizeManifest to consume DiffContract (separate downstream leaf)",
    "Actually evaluating/enforcing requirements against a change-set (this leaf only defines + parses the type)",
    "Migrating existing schemaVersion 1 LeafSizeManifest emitters or blueprint prompt strings"
  ] }
```