[[PARSE FAILED for 8a2efaf6]]

--- extracted text (what parseDiffContract saw) ---

```json
{ "schemaVersion": 2, "estimatedFiles": 1, "estimatedTasks": 3,
  "nonEnumerableFanout": false, "filesToCreate": ["src/services/diff-contract.ts"], "filesToEdit": [],
  "tasks": [
    { "id": "define-types", "files": ["src/services/diff-contract.ts"], "description": "Define DiffContractTask, DiffContractRequirement (union), and DiffContract v2 interfaces" },
    { "id": "parse-fn", "files": ["src/services/diff-contract.ts"], "description": "Implement parseDiffContract fail-safe extractor mirroring parseSizeManifest" },
    { "id": "render-fn", "files": ["src/services/diff-contract.ts"], "description": "Implement renderContract serializer that round-trips through parseDiffContract" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "symbol-present", "file": "src/services/diff-contract.ts", "symbol": "DiffContract", "description": "the v2 typed contract interface matching the schema in the leaf spec (schemaVersion, estimatedFiles, estimatedTasks, nonEnumerableFanout, filesToCreate, filesToEdit, tasks, leafKind, requirements, outOfScope)" },
    { "kind": "symbol-present", "file": "src/services/diff-contract.ts", "symbol": "DiffContractRequirement", "description": "union type of the three requirement kinds: symbol-present, named-test, threshold" },
    { "kind": "symbol-present", "file": "src/services/diff-contract.ts", "symbol": "parseDiffContract", "description": "fail-safe parser: extracts LAST ```json fence from given sources, validates schemaVersion===2 and required fields, never throws, returns null on any malformed input" },
    { "kind": "symbol-present", "file": "src/services/diff-contract.ts", "symbol": "renderContract", "description": "serializes a DiffContract back into a fenced ```json block string such that parseDiffContract(renderContract(c)) deep-equals c" }
  ],
  "outOfScope": ["Wiring parseDiffContract into leaf-executor.ts's blueprint/gate flow — that is a separate leaf per the shadow-mode rollout plan (bug e2fc870a); this leaf only creates the standalone module."]
}
```

**Blueprint for `f7868bfd`: create `src/services/diff-contract.ts`**

**Context read:**
- `src/services/leaf-executor.ts:245-275` — the existing v1 `LeafSizeManifest` interface and its doc comment (additive-only, schemaVersion bump convention).
- `src/services/leaf-executor.ts:1176-1231` — `parseSizeManifest`, the fail-safe v1 parser this new v2 parser should mirror in *shape* (extract last ```json fence via `matchAll(/```json\s*([\s\S]*?)```/g)`, `JSON.parse` in a `try/catch`, validate field-by-field, `continue` to the next source on any failure, return `null` if all sources fail — never throw).
- `src/services/split-decision.ts:1-60` — `parseSplitDecision`, a good reference for a hand-rolled fail-safe validator with no external schema library (this repo does not use zod/io-ts for these fence-parsed contracts; stay consistent — no new dependency).
- Confirmed via grep: no `diff-contract.ts`, no prior `DiffContract`/`leafKind`/`requirements` symbols anywhere in `src/`. This is a **new, standalone module** — do not import it from `leaf-executor.ts` or wire it into the blueprint/gate pipeline. That integration is out of scope for this leaf (tracked separately, per the shadow-rollout plan referenced in the project's own conventions around `LeafSizeManifest.schemaVersion`).

**File to create: `src/services/diff-contract.ts`**

1. **Types** (all exported):

```ts
export type DiffContractRequirement =
  | { kind: 'symbol-present'; file: string; symbol: string; description: string }
  | { kind: 'named-test'; testFile: string; testName: string; mechanical: true }
  | { kind: 'threshold'; source: 'gate-output' | 'grep-count'; metric: string;
      comparison: 'gte' | 'lte' | 'eq'; value: number; mechanical: true };

export interface DiffContractTask {
  id: string;
  files: string[];
  description: string;
}

export type LeafKind = 'feature' | 'fix' | 'refactor' | 'test' | 'infra';

/** v2 typed diff contract — the BLUEPRINT node's structured output, superseding
 *  {@link LeafSizeManifest} (v1) with named leafKind + machine-checkable requirements.
 *  ADDITIVE-ONLY, same convention as v1: never repurpose a field, bump schemaVersion
 *  for incompatible shape changes. */
export interface DiffContract {
  schemaVersion: 2;
  estimatedFiles: number;
  estimatedTasks: number;
  nonEnumerableFanout: boolean;
  filesToCreate: string[];
  filesToEdit: string[];
  tasks: DiffContractTask[];
  leafKind: LeafKind;
  requirements: DiffContractRequirement[];
  outOfScope: string[];
}
```

2. **`parseDiffContract(...sources: Array<string | undefined>): DiffContract | null`**
   - Same source-scanning loop as `parseSizeManifest`: for each source, skip falsy, find all ```` ```json ```` fences with `matchAll(/```json\s*([\s\S]*?)```/g)`, skip if none, take the **last** fence, `JSON.parse` inside `try/catch` (catch → `continue` to next source).
   - Validate strictly (any failure → `continue`, never throw):
     - `raw.schemaVersion === 2` exactly (this parser is v2-only; a v1 fence with `schemaVersion: 1` must fall through to `null` so callers know to use `parseSizeManifest` instead — do not coerce).
     - `estimatedFiles`, `estimatedTasks`: finite numbers `>= 0`.
     - `nonEnumerableFanout`: boolean.
     - `leafKind`: one of the 5 literal strings above (reject anything else).
     - `filesToCreate`, `filesToEdit`, `outOfScope`: arrays, filtered to strings only (same `toStrArr` pattern as `parseSizeManifest`).
     - `tasks`: array of objects, each coerced the same way `parseSizeManifest` coerces `tasks` (missing `id`/`description` → `''`, missing/bad `files` → `[]`) — do not reject the whole contract for one malformed task, mirror the existing lenient-per-task coercion.
     - `requirements`: array; each entry validated per its `kind` discriminant:
       - `symbol-present` → require `file`, `symbol`, `description` all non-empty strings; else drop that one requirement (don't fail the whole contract — same lenient-filter posture as tasks).
       - `named-test` → require `testFile`, `testName` non-empty strings; force `mechanical: true` regardless of input.
       - `threshold` → require `source` ∈ `{'gate-output','grep-count'}`, `metric` non-empty string, `comparison` ∈ `{'gte','lte','eq'}`, `value` a finite number; force `mechanical: true`.
       - Any entry with an unrecognized `kind` or missing required fields is dropped from the array (filter, not reject-all) — matches the file's existing "malformed sub-part → drop/flag, don't nuke the whole parse" style (c.f. `splitDecisionMalformed`).
   - Return the validated `DiffContract` object, or fall through to `return null` after exhausting all sources.

3. **`renderContract(contract: DiffContract): string`**
   - Serialize back into the exact fenced format the blueprint prompt emits: `` "```json\n" + JSON.stringify(contract, null, 2) + "\n```" `` (or equivalent single-line fence — pick one and keep it internally consistent).
   - Round-trip requirement: for any valid `DiffContract` value `c`, `parseDiffContract(renderContract(c))` must deep-equal `c` (field order doesn't matter; all required fields must survive, including empty arrays for `outOfScope`/`requirements`/`tasks`).

**Notes for the implementer:**
- No new imports needed beyond what's already in-repo style (plain TS, no schema-validation library).
- Do not touch `leaf-executor.ts` in this leaf — `LeafSizeManifest`/`parseSizeManifest` stay untouched; this is a net-new, currently-unimported module.
- Keep the doc-comment on `DiffContract` explicit about the additive-only contract, matching the existing convention at `leaf-executor.ts:255-260`.

--- raw stdout tail (last 4000 chars) ---

rt type LeafKind = 'feature' | 'fix' | 'refactor' | 'test' | 'infra';\n\n/** v2 typed diff contract — the BLUEPRINT node's structured output, superseding\n *  {@link LeafSizeManifest} (v1) with named leafKind + machine-checkable requirements.\n *  ADDITIVE-ONLY, same convention as v1: never repurpose a field, bump schemaVersion\n *  for incompatible shape changes. */\nexport interface DiffContract {\n  schemaVersion: 2;\n  estimatedFiles: number;\n  estimatedTasks: number;\n  nonEnumerableFanout: boolean;\n  filesToCreate: string[];\n  filesToEdit: string[];\n  tasks: DiffContractTask[];\n  leafKind: LeafKind;\n  requirements: DiffContractRequirement[];\n  outOfScope: string[];\n}\n```\n\n2. **`parseDiffContract(...sources: Array<string | undefined>): DiffContract | null`**\n   - Same source-scanning loop as `parseSizeManifest`: for each source, skip falsy, find all ```` ```json ```` fences with `matchAll(/```json\\s*([\\s\\S]*?)```/g)`, skip if none, take the **last** fence, `JSON.parse` inside `try/catch` (catch → `continue` to next source).\n   - Validate strictly (any failure → `continue`, never throw):\n     - `raw.schemaVersion === 2` exactly (this parser is v2-only; a v1 fence with `schemaVersion: 1` must fall through to `null` so callers know to use `parseSizeManifest` instead — do not coerce).\n     - `estimatedFiles`, `estimatedTasks`: finite numbers `>= 0`.\n     - `nonEnumerableFanout`: boolean.\n     - `leafKind`: one of the 5 literal strings above (reject anything else).\n     - `filesToCreate`, `filesToEdit`, `outOfScope`: arrays, filtered to strings only (same `toStrArr` pattern as `parseSizeManifest`).\n     - `tasks`: array of objects, each coerced the same way `parseSizeManifest` coerces `tasks` (missing `id`/`description` → `''`, missing/bad `files` → `[]`) — do not reject the whole contract for one malformed task, mirror the existing lenient-per-task coercion.\n     - `requirements`: array; each entry validated per its `kind` discriminant:\n       - `symbol-present` → require `file`, `symbol`, `description` all non-empty strings; else drop that one requirement (don't fail the whole contract — same lenient-filter posture as tasks).\n       - `named-test` → require `testFile`, `testName` non-empty strings; force `mechanical: true` regardless of input.\n       - `threshold` → require `source` ∈ `{'gate-output','grep-count'}`, `metric` non-empty string, `comparison` ∈ `{'gte','lte','eq'}`, `value` a finite number; force `mechanical: true`.\n       - Any entry with an unrecognized `kind` or missing required fields is dropped from the array (filter, not reject-all) — matches the file's existing \"malformed sub-part → drop/flag, don't nuke the whole parse\" style (c.f. `splitDecisionMalformed`).\n   - Return the validated `DiffContract` object, or fall through to `return null` after exhausting all sources.\n\n3. **`renderContract(contract: DiffContract): string`**\n   - Serialize back into the exact fenced format the blueprint prompt emits: `` \"```json\\n\" + JSON.stringify(contract, null, 2) + \"\\n```\" `` (or equivalent single-line fence — pick one and keep it internally consistent).\n   - Round-trip requirement: for any valid `DiffContract` value `c`, `parseDiffContract(renderContract(c))` must deep-equal `c` (field order doesn't matter; all required fields must survive, including empty arrays for `outOfScope`/`requirements`/`tasks`).\n\n**Notes for the implementer:**\n- No new imports needed beyond what's already in-repo style (plain TS, no schema-validation library).\n- Do not touch `leaf-executor.ts` in this leaf — `LeafSizeManifest`/`parseSizeManifest` stay untouched; this is a net-new, currently-unimported module.\n- Keep the doc-comment on `DiffContract` explicit about the additive-only contract, matching the existing convention at `leaf-executor.ts:255-260`.","ttft_ms":1549,"ttft_stream_ms":1176,"time_to_request_ms":17,"type":"result","duration_ms":60806,"uuid":"5c35a8f0-6f5b-44be-bdbb-5eb0047530b3"}


--- stderr tail (last 4000 chars) ---

