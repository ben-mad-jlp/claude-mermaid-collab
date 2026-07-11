# Blueprint: [Token burn #2] Reduce blueprint node turns/effort — it's the per-leaf cost sink

## Summary
The blueprint node is the dominant per-leaf cost: `opus + effort:'high'`, typically 7-8 turns, ~210k `cache_read_input_tokens` and ~$0.55 per leaf (vs implement ~$0.18-0.23, review ~$0.21). Because cache_read is paid on every turn for the cached prefix (system prompt + CLAUDE.md + conversation + file contents read so far), cutting turns or per-turn context size has first-order impact on the largest line item.

MCP stripping (commit ad3259e8 via `strictMcpConfig`) already removed ~200 tool schemas from nodes whose allowlist lacks `mcp__` (including blueprint) and cut cache *writes*, but did not move cache *reads* because the CLI filters unused defs for the loaded servers. Therefore further context reduction must target:
- system prompt (CLI)
- CLAUDE.md (auto-loaded by CLI from worktree root)
- the injected user prompt body for the 'blueprint' case
- the volume and size of file contents the model elects to read (each Read result is re-presented on subsequent turns)

Goal: implement one or more of the three options below, A/B on real leaves, and validate that blueprint quality remains acceptable (the plan the implement node follows) by watching review-pass rate and downstream leaf acceptance.

## Data (given)
- Blueprint: ~7-8 turns, ~210k cache_read, ~$0.55
- Implement and review are materially cheaper
- Re-attach already avoids re-running blueprint on resume when epic base is unchanged (planResume + restoreBlueprint path)

## Options (measure each)

### (a) Lower blueprint effort high → medium in NODE_PROFILE
**File:** `src/services/leaf-executor.ts`  
**Symbol:** `NODE_PROFILE` (exported const at the record literal)  
**Exact site (approx line 328-329 in current tree):**
```ts
export const NODE_PROFILE: Record<LeafNodeKind, { model: string; allowedTools: string; effort: EffortLevel }> = {
  blueprint: { model: 'opus', allowedTools: 'Read Write Grep Glob Bash', effort: 'high' },
```
**Change shape:** one-token edit on the blueprint entry only:
- `effort: 'high'` → `effort: 'medium'`
**Propagation (no code change required):** `nodeEffort(kind)` at ~976 already does:
  `nodeOverrides[kind]?.effort ?? projectEffort ?? ENV_NODE_EFFORT ?? NODE_PROFILE[kind].effort`
  and `buildSpec` passes `effort: nodeEffort(kind)` into the `NodeSpec`.
**Effect:** lower reasoning budget may produce fewer internal turns or shallower exploration. Reversible with a one-line revert. Must A/B for quality (opus+medium vs opus+high plan fidelity).

### (b) Cap blueprint turns
**Current state:** `NodeSpec` already declares `maxTurns?: number` (node-invoker.ts:72) and it is forwarded only for Grok:
- `buildGrokArgv` (node-invoker.ts:734): `if (spec.maxTurns != null) argv.push('--max-turns', String(spec.maxTurns));`
- `buildNodeArgv` (the claude path) never emits `--max-turns`.
- Grok doc comment says "Grok-only".

**Change sites and shape:**

1. `src/services/leaf-executor.ts`
   - Near the other caps (`ATTEMPT_CAP`, `NODE_BUDGET`, `REVISE_REUSE_CAP` etc., around lines 240-270), add a small constant:
     `export const BLUEPRINT_TURN_CAP = 6;`   // start at 6 to cut from observed 7-8; tune after measurement
   - In the blueprint launch site (inside `runLeaf`, the two `runNode('blueprint', buildSpec('blueprint', cwd))` calls around 1581 and 1593), or more cleanly inside `buildSpec`, ensure that when `kind === 'blueprint'` the returned spec carries `maxTurns: BLUEPRINT_TURN_CAP`.
     Preferred minimal shape: after constructing the spec object in `buildSpec`, or in a tiny wrapper used only for blueprint, set the field when kind==='blueprint'.
   - Optionally also expose `BLUEPRINT_TURN_CAP` so tests/docs can reference the measured value.

2. `src/agent/node-invoker.ts`
   - `buildNodeArgv` function (around lines 210-230, after the `if (spec.effort)` push):
     Add:
     ```ts
     if (spec.maxTurns != null) argv.push('--max-turns', String(spec.maxTurns));
     ```
   - Update the JSDoc on `NodeSpec.maxTurns` (line ~72) to read: "Optional hard cap on conversation turns (passed as --max-turns). Applies to both Claude and Grok nodes when the CLI supports the flag for the chosen invocation style."
   - No change to `parseNodeJson` or result handling is required; if the cap is hit the CLI will surface an error that the executor already treats as a failed node (rateLimited=false, ok=false) → existing blueprint failure/retry path applies.

**Notes for measurement:**
- If the installed `claude` CLI does not yet accept `--max-turns` for `-p`, the flag is a harmless no-op and the cap still acts as an explicit budget visible in code + ledger. Pair with prompt discipline (c) for real enforcement.
- The cap is applied only to the blueprint node (per the leaf goal); do not change other opus nodes (review, driveplan) in this leaf.

### (c) Trim the injected blueprint prompt/context so each turn re-reads less
**Primary controlled surface:** the string returned by `buildNodePrompt('blueprint', ...)` (leaf-executor.ts:400-466, the `case 'blueprint':` arm, lines ~410-434).

**Current prompt (exact text shape today):**
```ts
return [
  'You are the BLUEPRINT node for ONE leaf todo. Do NOT write implementation code.',
  `Title: ${title}`,
  `Description: ${description}`,
  'Read the relevant code (Read/Grep/Glob and Bash for inspection ONLY — no mutations).',
  `Produce a precise, self-contained implementation blueprint and WRITE it to \`${bp}\`.`,
  'The blueprint must cite the real files/symbols to touch and the exact change shape.',
  '',
  'FINISH the blueprint file with EXACTLY ONE trailing fenced ```json block (the',
  'machine-readable size manifest — the prose blueprint goes above it). It MUST be',
  'the LAST json fence in the file and parse as:',
  '```json',
  '{ "schemaVersion": 1, "estimatedFiles": <int>, "estimatedTasks": <int>,',
  '  "nonEnumerableFanout": <bool>,',
  '  "filesToCreate": ["<path>"], "filesToEdit": ["<path>"],',
  '  "tasks": [ { "id": "<slug>", "files": ["<path>"], "description": "<one line>" } ] }',
  '```',
  'estimatedFiles = total distinct files created+edited. estimatedTasks = number of',
  'independent units of work. nonEnumerableFanout = true ONLY if there are sites you',
  'CANNOT statically enumerate (dynamic dispatch, string-keyed/reflective call sites).',
  '',
  `ALSO output the COMPLETE blueprint (the same prose + the trailing json block) as your`,
  `FINAL reply message — verbatim — so the executor has the blueprint even if the file`,
  `read fails. (Write the file AND emit the full text as your final message.)`,
].join('\n');
```

**Trim change shape (keep contractual obligations, cut verbosity and add economy pressure):**
- Keep every requirement that the executor and size-gate parser rely on:
  - "Do NOT write implementation code."
  - "WRITE it to `.collab/leaf-blueprints/${leaf.id}.md`"
  - The exact JSON shape description + "It MUST be the LAST json fence"
  - "ALSO output the COMPLETE blueprint ... as your FINAL reply message — verbatim"
- Shorten framing sentences.
- Insert an explicit economy rule immediately after the role sentence:
  "Economy rule: minimize turns and bytes re-read per turn. Glob + targeted Grep before broad Reads. Read the smallest hunks needed to cite exact symbols and change shape. After a bounded exploration (aim ≤5 tool-using turns) synthesize the plan and manifest. Do not re-read files you already have in context."
- Condense the "read the relevant code" line into the economy rule.
- Keep the schema block (it is small and required for the contract).

Resulting prompt will be materially shorter on the wire and will steer the model toward fewer, higher-signal tool calls, directly reducing the number of conversation turns and the cumulative cache_read of file contents.

**Secondary surfaces (document, do not necessarily mutate in first patch):**
- CLAUDE.md (repo root) is auto-loaded by the `claude -p` CLI into the cached system context for every node run in a checkout of this tree. It is small today, but any growth directly multiplies the per-turn cost for the most expensive node. A future split (short machine-oriented CLAUDE.md for worktrees + a human-oriented one, or a `.claude/` dir with node-specific instructions) is out of scope for this leaf but should be noted.
- File-read volume is governed by model behavior + prompt guidance (addressed above) + the concrete codebase the leaf targets. No executor change can pre-filter file content for the blueprint node without changing the semantics of "read the relevant code."
- No appendSystemPrompt is currently passed for leaf nodes (unlike interactive workers in claude-launch.ts / judgment-llm.ts). Adding one for blueprint would increase (not decrease) context; do not do so here.

**Do NOT touch for this leaf:** MCP allowlists, strictMcpConfig, or .mcp.json — the note in the request is explicit.

## Quality bar
The blueprint node output (both the .md and the verbatim final message) must remain sufficient for a correct implement pass with acceptable review iteration count. After any change:
- Run A/B on a handful of leaves spanning floor-eligible and waves-eligible sizes.
- Monitor: blueprint num_turns, cache_read_tokens, costUsd (from worker-ledger), review verdict distribution, final leaf outcome rate.
- Revert or tune the constant/prompt wording if acceptance drops materially.

## Exact symbols and call sites to edit (for the implementer)
- `src/services/leaf-executor.ts`:
  - `NODE_PROFILE` object (blueprint entry effort field)
  - `buildNodePrompt` function, the `'blueprint'` case return array
  - Add `BLUEPRINT_TURN_CAP` constant near other caps
  - `buildSpec` (or the call sites at the two `runNode('blueprint', buildSpec...)` locations) to attach `maxTurns`
  - `nodeEffort` / resolution comments if helpful for future readers
- `src/agent/node-invoker.ts`:
  - `NodeSpec` JSDoc for `maxTurns`
  - `buildNodeArgv` implementation (add the push for `--max-turns`)
- No other production files need modification for the core three options.
- Test files (`src/services/__tests__/leaf-executor.test.ts`) may require tiny updates only if they contain brittle exact-string matches on the *blueprint* prompt text (current tests exercise implement/review prompts more); treat as follow-on hygiene.

## Rollout / measurement notes
- Change is additive and easily toggled (one-line effort, one constant, prompt wording).
- Ledger already records per-node `steps` (num_turns), `cacheReadTokens`, `costUsd` — use `ledger-stats` and worker-ledger queries for before/after.
- The size manifest contract and `parseSizeManifest` are unchanged.

```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 4,
  "nonEnumerableFanout": false,
  "filesToCreate": [], "filesToEdit": ["src/services/leaf-executor.ts", "src/agent/node-invoker.ts"],
  "tasks": [ { "id": "lower-blueprint-effort", "files": ["src/services/leaf-executor.ts"], "description": "Change NODE_PROFILE.blueprint.effort from high to medium" }, { "id": "cap-blueprint-turns", "files": ["src/services/leaf-executor.ts", "src/agent/node-invoker.ts"], "description": "Add BLUEPRINT_TURN_CAP, wire maxTurns into blueprint NodeSpec, forward --max-turns in buildNodeArgv" }, { "id": "trim-blueprint-prompt", "files": ["src/services/leaf-executor.ts"], "description": "Shorten buildNodePrompt('blueprint') body and add explicit economy/turn-minimization guidance" }, { "id": "docs-and-constants", "files": ["src/services/leaf-executor.ts"], "description": "Add exported turn-cap constant near other caps and update nearby comments" } ] }
```