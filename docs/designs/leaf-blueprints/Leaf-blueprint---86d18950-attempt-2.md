# Blueprint: [Token burn #2] Reduce blueprint node turns/effort

## Diagnosis (confirmed by measurement + code inspection)
The blueprint node is the per-leaf cost sink:
- Model: opus (NODE_PROFILE)
- Effort: 'high' → drives deeper reasoning, more turns
- Observed: ~7-8 turns (num_turns from stream-json result), ~210k cache_read, ~$0.55 per blueprint node
- Compare: implement ~$0.18-0.23, review ~$0.21
- cache_read scales with (turns × context bytes per turn). Context per turn includes: system prompt + CLAUDE.md + growing conversation (prior tool outputs) + files re-read by the agent.

Root cause sites (read-only inspection):
- `src/services/leaf-executor.ts:328`
  ```ts
  export const NODE_PROFILE: Record<LeafNodeKind, { model: string; allowedTools: string; effort: EffortLevel }> = {
    blueprint: { model: 'opus', allowedTools: 'Read Write Grep Glob Bash', effort: 'high' },
    ...
  };
  ```
- `src/services/leaf-executor.ts:400` (`buildNodePrompt`)
  - `case 'blueprint':` returns a multi-line instruction. The model is told "Read the relevant code" (open-ended) with no turn target or narrow-read strategy. This leads to broad Glob/Read/Bash exploration → many turns → large history → high cache_read on every subsequent turn.
- `src/services/leaf-executor.ts:1146` (`const buildSpec = ...`)
  - Builds `NodeSpec { prompt: buildNodePrompt(...), model: nodeModel(kind), effort: nodeEffort(kind), ... }`
  - No `maxTurns` attached for any floor node.
- `src/agent/node-invoker.ts:72` (NodeSpec) and `buildNodeArgv` (Claude path, ~207):
  - `maxTurns?: number` is documented "Grok-only".
  - Only `buildGrokArgv` (~734) forwards `--max-turns`.
  - `buildNodeArgv` never emits it.
- `src/services/leaf-executor.ts:360` (`blueprintPath`) and runLeaf (~1578): blueprint always runs (unless reattach) in a fresh worktree cwd; the claude CLI loads the repo's CLAUDE.md.
- `src/services/leaf-executor.ts:238` area: existing caps are `ATTEMPT_CAP`, `NODE_BUDGET`, `REVISE_REUSE_CAP` etc. No per-kind turn cap.

MCP note (from ticket): ad3259e8 already removed MCP from build nodes via `strictMcpConfig` (no `--mcp-config`, allowedTools without mcp__). This cut cache_WRITE but not cache_READ (CLI already filtered unused MCP defs for these nodes). Therefore context-trim for cache_read MUST target:
- system prompt / CLAUDE.md content seen by the node
- injected blueprint body (N/A for blueprint itself; relevant for implement/review)
- the prompt text in `buildNodePrompt`
- the file-reads the model performs (volume + re-reads across turns)

CLAUDE.md at repo root is already tiny (versioning + testing + structure only). No MCP changes are in scope.

## Goal
Reduce blueprint node turns (primary) and context-per-turn (secondary) while keeping the produced plan quality acceptable. The plan is the single source the `implement` node follows and `review` validates.

Quality signal: review `VERDICT: PASS` rate and final leaf `accepted` rate must not regress materially. Measure via A/B on real leaves.

## Options (measure each)
All three are independent and additive. Implement as a single patch then A/B by overriding effort or temporarily reverting pieces.

### (a) Lower effort high → medium (largest single lever on depth/turns)
- Edit `src/services/leaf-executor.ts:329`:
  ```diff
  - blueprint: { model: 'opus', allowedTools: 'Read Write Grep Glob Bash', effort: 'high' },
  + blueprint: { model: 'opus', allowedTools: 'Read Write Grep Glob Bash', effort: 'medium' },
  ```
- `nodeEffort(kind)` (leaf-executor.ts:977) already resolves: nodeOverrides[kind]?.effort ?? projectEffort ?? ENV_NODE_EFFORT ?? NODE_PROFILE[kind].effort
- Existing machinery (orchestrator-config node_profile_override table, MERMAID_NODE_EFFORT, per-project effortOverride) still allows raising effort back to 'high' or 'xhigh' for a specific project or experiment without further code change.
- One-line change. Directly reduces reasoning effort for the dominant cost node.

### (b) Cap blueprint turns (hard ceiling on the long tail)
- Add a constant near the other caps (`src/services/leaf-executor.ts:238` region, after `ATTEMPT_CAP` / `NODE_BUDGET`):
  ```ts
  export const BLUEPRINT_MAX_TURNS = 5;
  ```
- In `buildSpec` (`src/services/leaf-executor.ts:1146`):
  ```ts
  const buildSpec = (kind: LeafNodeKind, cwd: string, ...): NodeSpec => ({
    prompt: buildNodePrompt(...),
    ...
    effort: nodeEffort(kind),
    maxTurns: kind === 'blueprint' ? BLUEPRINT_MAX_TURNS : undefined,
    ...
  });
  ```
- Forward the flag for the Claude path in `src/agent/node-invoker.ts`:
  - Update JSDoc at `NodeSpec.maxTurns` (line ~72) to: " `--max-turns` cap (forwarded to both claude and grok CLIs when set)."
  - In `buildNodeArgv` (after the `if (spec.effort)` / strictMcp / allowedTools block, before return):
    ```ts
    if (spec.maxTurns != null) argv.push('--max-turns', String(spec.maxTurns));
    ```
- Grok path already forwards it in `buildGrokArgv`. The same `NodeSpec` field now works for both providers.
- Cap value (5) is below the observed 7-8 to force the model to be decisive; tune after first A/B if quality drops (try 6).
- When hit: claude/grok will surface a terminal condition → node fails → executor treats like other failures (in-place retry then fresh attempt or block). Budget is already consumed on spawn (correct).

### (c) Trim injected blueprint prompt / exploration strategy (fewer + smaller reads)
- Edit only the `case 'blueprint':` arm inside `buildNodePrompt` (`src/services/leaf-executor.ts:410`).
- Add a turn target and narrow-read contract at the top of the returned array. Keep the machine-readable trailing ```json contract and the "ALSO output COMPLETE ... as FINAL reply" paragraph intact (they are load-bearing).
- Example tightened text (exact strings can be wordsmithed for brevity while preserving meaning):
  ```ts
  case 'blueprint':
    return [
      'You are the BLUEPRINT node for ONE leaf todo. Do NOT write implementation code. Target 3-5 turns max.',
      `Title: ${title}`,
      `Description: ${description}`,
      'Read MINIMALLY: use title+description to pick 1-3 entrypoint files via Glob or Grep first; read only those and their direct imports. Do not broad-glob the tree or re-read unrelated modules. Never re-Read a file whose content you already received in prior tool results.',
      `Produce a precise, self-contained implementation blueprint and WRITE it to \`${bp}\`.`,
      'The blueprint must cite the real files/symbols to touch and the exact change shape.',
      '',
      'FINISH the blueprint file with EXACTLY ONE trailing fenced ```json block (the',
      ... (rest of contract text unchanged) ...
    ].join('\n');
  ```
- Effect: reduces both turn count (less exploration) and bytes carried in conversation history (no re-read payloads) → lower cache_read per turn.
- The prompt body itself is small; the win is in the agent's subsequent tool-use behavior.
- Note: implement + review still inline the emitted blueprint body (see their arms in the same function). A tighter plan also shrinks context for them, but the ticket focuses on blueprint node cost.

## Measurement & A/B plan (required)
After the change lands:
1. Instrument / query `worker_ledger` (via existing summary or direct SQL) for rows where `nodeKind='blueprint'` (or `phase='blueprint'`):
   - `steps` (== num_turns)
   - `cacheReadTokens`
   - `costUsd`
   - durationMs
2. Compare review nodes in same leaves: fraction of `VERDICT: PASS`.
3. Compare leaf terminal outcomes: `accepted` vs `blocked`/`rejected` rate.
4. Run on a small set of varied leaves (small, medium, multi-file) both before and after (or with overrides). Use:
   - Per-project `node_profile_override` (effort) for effort A/B without code flip.
   - Code constant or env for the maxTurns/prompt variant.
5. Acceptance bar: cache_read and steps drop materially (target ≥30-40% reduction on the blueprint line item) with no statistically significant drop in pass/accepted rate. If quality slips, raise cap to 6 or keep effort high + cap only.

Existing telemetry already captures everything needed (recordNode in runNode, steps from usage.numTurns, cacheReadTokens).

## Non-goals / out of scope for this leaf
- Changes to MCP allowlists or --strict-mcp-config for build nodes (already done, doesn't affect read).
- Broad CLAUDE.md surgery (it's tiny; per-node system overrides via appendSystemPrompt are possible but not first-order here).
- Altering implement/review prompts except the natural effect of a smaller inlined blueprint.
- Adding wave or verify-pipeline specific caps unless data shows they are also sinks.

## Risks & mitigations
- Quality regression (bad plans → review fails or bad impl): mitigated by A/B + the one-in-place blueprint retry already present in runLeaf (~1588). Cap is not draconian; prompt still requires "precise, self-contained".
- Claude CLI rejects `--max-turns`: surfaces as node failure (parseable); fallback is to remove the line or make attachment provider-aware (nodeProvider is resolved later in runNode). Start with unconditional forward — same shape as effort.
- Over-trim of prompt loses required contract: keep the exact "FINISH ... EXACTLY ONE trailing" + schema + "ALSO output COMPLETE" paragraphs verbatim.

## Files / symbols to touch (precise)
- `src/services/leaf-executor.ts`
  - `NODE_PROFILE` (exported const at ~328): change only the blueprint effort value.
  - Add `BLUEPRINT_MAX_TURNS` export near other caps (~238).
  - `buildNodePrompt` (exported fn at 400): edit only the `case 'blueprint':` array (add guidance + target; contract text untouched).
  - `buildSpec` (internal at 1146): attach `maxTurns` for blueprint.
  - (Reference only: `blueprintPath`, `nodeEffort`, `runNode`, `runLeaf` attempt loop.)
- `src/agent/node-invoker.ts`
  - `NodeSpec` interface JSDoc for `maxTurns` (~72).
  - `buildNodeArgv` (exported fn at 207): add the forwarding `if` (one line, same pattern as other optionals; placed after effort/allowedTools pushes).
- No other production files are required. Test files may grow assertions later but current spies (model, allowedTools, cwd) and argv containment tests are unaffected.

## Rollout
1. Make the edits (effort + constant + wire + prompt trim + argv forward).
2. `npm run test:ci` (or targeted leaf-executor + node-invoker tests).
3. Land. Push tags if version bump needed (per Claude.md).
4. A/B a handful of leaves via override or re-dispatch; compare ledger metrics + acceptance.
5. If good, leave effort at 'medium' + cap in place as new baseline. Tune cap value from data.

## Trailing size manifest (for the implementation work this blueprint describes)
```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 3,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/services/leaf-executor.ts", "src/agent/node-invoker.ts"],
  "tasks": [
    { "id": "lower-blueprint-effort", "files": ["src/services/leaf-executor.ts"], "description": "Change NODE_PROFILE.blueprint.effort from 'high' to 'medium'." },
    { "id": "cap-blueprint-turns", "files": ["src/services/leaf-executor.ts", "src/agent/node-invoker.ts"], "description": "Add BLUEPRINT_MAX_TURNS, attach in buildSpec for blueprint, forward --max-turns in buildNodeArgv (claude path)." },
    { "id": "trim-blueprint-prompt", "files": ["src/services/leaf-executor.ts"], "description": "Tighten buildNodePrompt case 'blueprint' with turn target and narrow-read strategy; preserve contract." }
  ] }
```