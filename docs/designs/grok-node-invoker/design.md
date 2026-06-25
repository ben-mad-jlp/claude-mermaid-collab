# Grok Node Invoker — Design Document

| Field | Value |
|-------|-------|
| **Status** | Draft (rev 3 — re-review) |
| **Date** | 2026-06-25 |
| **Audience** | Senior engineers on mermaid-collab |
| **Version target** | v6.9.2 |
| **Scope** | Add `GrokNodeInvoker` behind the existing `NodeInvoker` interface so the leaf-executor daemon can spawn headless `grok` CLI runs instead of `claude -p` |

---

## Executive Summary

Today every headless daemon node runs through `ClaudeNodeInvoker` → `invokeNode` → `claude -p` (stdin prompt, `--output-format stream-json`). The leaf-executor (`runLeaf`) chains blueprint → implement → review (and waves / verify-pipeline extensions) by calling `deps.invoker.invoke(spec)` with a `NodeSpec` built from `NODE_PROFILE` and per-project overrides.

This design adds a parallel **`GrokNodeInvoker`** that spawns the headless **`grok` CLI** (v0.2.64, live-tested) with `--prompt-file`, `--output-format json|streaming-json`, and Claude-compatible flags (`--allowedTools`, `--permission-mode`, `--effort`, `-m`, `--max-turns`, `--cwd`, etc.). Wiring is provider-driven at `makeLeafExecutorDeps` time; the executor state machine, budget logic, and `NodeResult` contract stay unchanged.

**Explicitly out of scope:** worker-core / `@ai-sdk/xai` / `GrokOwnHarness`; MCP-dependent execution modes (verify pipeline, reviewer pipeline); per-node hybrid routing; `tier-override-store` (does not affect `runLeaf` in v1).

---

## Background & Motivation

### Current call chain

```
Orchestrator tick
  → launchWorker (coordinator-live.ts — `makeCoordinatorDeps`)
    → runLeaf (leaf-executor.ts)
      → deps.assertAuth()          // assertSubscriptionAuth today
      → deps.invoker.invoke(spec)  // ClaudeNodeInvoker → invokeNode
        → buildNodeArgv(spec)
        → Bun.spawn(['claude', '-p', ...], { stdin: prompt, cwd: spec.cwd })
        → parseNodeJson(stdout)
        → NodeResult
```

Key types (from `src/agent/node-invoker.ts`):

```typescript
export interface NodeSpec {
  prompt: string;
  model?: string;
  allowedTools?: string;
  strictMcpConfig?: boolean;
  appendSystemPrompt?: string;
  cwd: string;
  timeoutMs?: number;
  leafId?: string;
  epicId?: string;
  transcriptPath?: string;
  transcriptLabel?: string;
  permissionMode?: 'bypassPermissions' | 'acceptEdits' | 'default' | 'plan' | 'auto' | 'dontAsk';
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface NodeResult {
  /** exitCode===0 && !rateLimited && parsed result is_error!==true && authMode==='subscription'.
   *  NOTE: auth is enforced pre-spawn (HALT return); it is NOT re-checked in the ok predicate. */
  ok: boolean;
  exitCode: number;
  stdout: string;
  durationMs: number;
  usage?: NodeUsage;
  /** Transient pause signal (rate-limit OR unreachable). Mirrors `transient` in invokeNode. */
  rateLimited: boolean;
  unreachable?: boolean;
  capReset?: number;
  authMode: AuthMode;
  text?: string;
  parseError?: string;
}

export interface NodeInvoker {
  invoke(spec: NodeSpec): Promise<NodeResult>;
}
```

`makeLeafExecutorDeps` hardcodes:

```typescript
invoker: ClaudeNodeInvoker,
assertAuth: assertSubscriptionAuth,
```

(`leaf-executor.ts` — `makeLeafExecutorDeps`)

`launchWorker` hardcodes `const provider: ProviderId = 'claude'` for pool slot tagging (`coordinator-live.ts` — `launchWorker`).

`recordNode` defaults `provider: entry.provider ?? 'claude'` (`worker-ledger.ts` — `recordNode`).

### Why Grok CLI (not worker-core)

| Approach | Verdict |
|----------|---------|
| **Headless `grok` CLI** | **Selected.** Same spawn-and-capture shape as `invokeNode`; reuses `NodeInvoker` seam, transcript capture, timeout/kill logic, and executor tests with mock invokers. |
| **worker-core / `@ai-sdk/xai`** | **Rejected.** Different runtime (in-process AI SDK loop), duplicates harness work (`GrokOwnHarness`), and does not match the P1 "one bounded CLI invocation" primitive. |
| **Argv branch inside `invokeNode`** | **Rejected.** Mixes Claude stdin semantics, subscription auth, and stream-json parsing with Grok prompt-file and different JSON shape; harder to test and reason about. |

### Grok CLI behavior (live-tested, v0.2.64)

| Property | Value |
|----------|-------|
| Binary | `grok` (e.g. `~/.grok/bin/grok`) |
| Auth | `~/.grok/auth.json` (OIDC); separate from Claude subscription |
| Headless entry | `--prompt-file <path>` + `--output-format json\|streaming-json` (NOT bare `-p` with prompt-file) |
| Compatible flags | `--allowedTools`, `--permission-mode bypassPermissions`, `--effort`, `-m`, `--max-turns`, `--cwd`, `--no-plan`, `--no-subagents`, `--no-memory`, `--disable-web-search` |
| JSON success shape | `{ text, stopReason, sessionId, thought }` — success when `stopReason === 'EndTurn'` |
| JSON failure | `stopReason === 'Cancelled'`, exit code 1 |
| streaming-json | thought/text chunks + terminal end object; tool events NOT on stdout (live in grok trace / `updates.jsonl`) |
| max-turns exceeded | exit 1, stderr contains `"Error: max turns reached"` |
| Built-in tool names | `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash` (matches `NODE_PROFILE` allowlists) |

---

## Goals

1. **Drop-in invoker:** Implement `GrokNodeInvoker: NodeInvoker` without changing `runLeaf` control flow, budget accounting, or `NodeResult` consumers.
2. **Provider selection at deps factory:** `makeLeafExecutorDeps` chooses invoker + auth guard based on resolved provider (project-level `orchestrator_config.nodeProvider`).
3. **Model mapping:** UI stores values like `grok-build`, `grok-composer-2.5-fast` in `node_profile_override.model`; **ledger records those opaque values**; CLI `-m` resolution happens only inside `buildGrokArgv` / `invokeGrokNode`.
4. **Floor path first:** blueprint / implement / review / waves (built-in tools only) run on Grok when configured; MCP execution modes remain Claude-only.
5. **Testability:** Pure functions (`buildGrokArgv`, `parseGrokOutput`, `resolveGrokModel`, `assertGrokAuth`) unit-tested like existing `buildNodeArgv` / `parseNodeJson`.
6. **Observability parity:** Transcript append, ledger rows (`provider`, `knownPrice`), inflight signals — best-effort, never fail the node.

## Non-Goals

| Item | Rationale |
|------|-----------|
| `GrokOwnHarness` / tmux / in-process worker-core | Retired as worker path (P7); this design is CLI-only |
| MCP tools in daemon nodes | Oversight for v1; floor uses built-in tools; `strictMcpConfig` strips `.mcp.json` for non-MCP kinds |
| MCP-dependent execution modes on Grok | **Verify pipeline** (`driveexec`, `report`); **reviewer pipeline** (`runReviewPipeline` with `mcp__mermaid__add_session_todo`); any spec whose `allowedTools` contains `mcp__` — Claude-only in v1 |
| Per-node-kind hybrid routing (grok implement, claude review) | Deferred; adds invoker switching mid-leaf |
| **`tier-override-store` wiring into `runLeaf`** | Existing grok entries in `tier-override-store` affect **worker-core / retired harness** routing only; `leaf-executor.ts` does not consult tier overrides. Daemon node provider is **project-level `nodeProvider` only** in v1. |
| UI for DaemonNodesMatrix grok models | User will add separately; this doc defines backend mapping contract |
| xAI rate-limit reset scraping | No observed cap-reset message yet; conservative backoff only |
| Session persistence across nodes | Both CLIs run single-shot; `grok` gets `--no-memory` |

**Future (not v1):** Wire `tier-override-store` into `makeLeafExecutorDeps` for epic-level provider overrides (separate from worker-core hybrid routing).

---

## Proposed Architecture

```
Orchestrator tick
  → launchWorker
    → getProjectNodeProvider(ledProject)  // orchestrator_config.nodeProvider
    → runLeaf
      → deps.assertAuth()                // assertSubscriptionAuth OR assertGrokAuth (throws)
      → deps.invoker.invoke(spec)
        ├─ ClaudeNodeInvoker → invokeNode (unchanged)
        └─ GrokNodeInvoker   → invokeGrokNode (NEW)
             → writePromptTempFile(spec.prompt)
             → buildGrokArgv(spec, promptFile)  // resolveGrokModel(spec.model) here only
             → Bun.spawn([grokBin, ...], { cwd: spec.cwd })
             → parseGrokOutput(stdout)
             → NodeResult (same contract)
```

Files touched (implementation phase):

| File | Change |
|------|--------|
| `src/agent/node-invoker.ts` | Grok primitive; **export `captureTranscript`**; separate Grok auth cache |
| `src/agent/grok-model.ts` (new) | `resolveGrokModel` alias table (single source of truth for CLI `-m`) |
| `src/services/orchestrator-config.ts` | `nodeProvider` column + `getProjectNodeProvider` / `setProjectNodeProvider` |
| `src/routes/orchestrator-routes.ts` | GET/POST `nodeProvider` alongside existing orchestrator config |
| `src/services/leaf-executor.ts` | `resolveNodeInvoker`, `resolveAssertAuth`, `requiresMcp`, `maxTurns` in `buildSpec` |
| `src/services/coordinator-live.ts` | Thread provider into `makeLeafExecutorDeps`; pool slot tag; `recordSessionProvider` on launch |
| `src/services/fleet-status.ts` | Headless grok lanes: `leaf_inflight` only (drop harness fallback) |
| `src/agent/__tests__/node-invoker.test.ts` | Grok argv/parser/auth/timeout tests |

---

## Key Decisions

### KD-1: Separate `GrokNodeInvoker` (not `invokeNode` branch)

**Decision:** New `invokeGrokNode` + `GrokNodeInvoker` object, parallel to `invokeNode` / `ClaudeNodeInvoker`.

**Rationale:** Different prompt delivery, output format, auth, and parsers. Keeps Claude path byte-stable.

### KD-2: Prompt via ephemeral temp file, not stdin

**Decision:** Write `spec.prompt` to `mkdtemp('mermaid-node-')` + `prompt.txt`, pass absolute `--prompt-file`, delete in `finally`.

**Cleanup:** `unlink` + `rmdir` best-effort; failure must not affect `NodeResult`.

### KD-3: `--output-format streaming-json` for transcripts

**Decision:** Use `streaming-json` when `spec.transcriptPath` is set; `json` when absent (unit tests).

**Production note:** `buildSpec` / `buildWaveSpec` always set `transcriptPath` (`leafTranscriptPath`), so production Grok runs always use `streaming-json`. Claude always uses `stream-json` in `buildNodeArgv` regardless.

**Transcript helper:** Export existing `captureTranscript` from `node-invoker.ts` (today private at lines 28–34) as `export function captureTranscript(...)` so both `invokeNode` and `invokeGrokNode` share boundary-marker append logic. Included in **PR-1**.

### KD-4: Minimal `NodeSpec` extension — `maxTurns?: number` only

**Decision:** Add optional `maxTurns?: number`. No `grokSessionId` in v1.

### KD-5: Extend `AuthMode` with `'grok'`

**Decision:** `export type AuthMode = 'subscription' | 'api' | 'unknown' | 'grok';`

**Enforcement (mirrors Claude):**
- `runLeaf` calls `deps.assertAuth()` once at entry — `assertGrokAuth()` **throws** fail-closed when provider is grok and auth invalid.
- `invokeGrokNode` uses non-throwing `resolveGrokAuthMode()`; if not `'grok'`, returns early HALT `NodeResult` with `ok: false` **before spawn** (same pattern as `invokeNode` lines 412–426).
- Auth is **not** part of the `ok` predicate (see KD-6).

**Grok auth check (`assertGrokAuth`):**
1. Resolve binary (`resolveGrokBin()`).
2. Prefer `grok auth status --json` if available; fallback: read `~/.grok/auth.json`, verify parseable + `expires_at` in future.
3. Memoize in **separate** cache (KD-16).

### KD-6: `ok` semantics for Grok (aligned with Claude)

**Decision:** Auth enforced only pre-spawn; `ok` matches Claude structure with Grok-specific success field:

```typescript
// invokeGrokNode — after timeout check, parse, transient classification:
const transient = rateLimited || unreachable;
const ok = exitCode === 0 && !transient && parsed.stopReason === 'EndTurn';
```

**Transient / pause path (mirrors `invokeNode` lines 535–561):**

```typescript
// Rate limit: narrow stderr fallback only (KD-12); no structured api_error_status on Grok v1
const rateLimited =
  exitCode !== 0 &&
  parsed.stopReason === undefined &&  // no successful terminal object
  /\b429\b|rate limit (?:exceeded|reached)|too many requests/i.test(stderr);

const unreachable =
  !rateLimited &&
  exitCode !== 0 &&
  parsed.stopReason === undefined &&
  CONN_ERR_RE.test(stderr);

// Return: rateLimited: transient, unreachable, capReset: undefined (Grok v1)
```

**Failure cases:**

| Condition | `ok` | `rateLimited` | `nodesSpent` | `parseError` |
|-----------|------|---------------|--------------|--------------|
| `stopReason === 'Cancelled'` | false | false | consumed | `grok: run cancelled` + stderr |
| exit 1 + "max turns reached" | false | false | consumed | `grok: max turns reached` |
| timeout kill | false | false | consumed | `grok: node timed out after Nms (killed)` |
| auth HALT (pre-spawn) | false | false | not spawned* | `grok: HALT: ...` |
| unparseable stdout (complete run) | false | false | consumed | parser `parseError` |
| partial stdout on timeout | false | false | consumed | timeout message; `text` from last parseable chunk or `undefined` |

\*Budget: `runNode` increments `nodesSpent` before spawn; auth HALT at `runLeaf` entry prevents any node from starting. Per-node auth HALT inside `invokeGrokNode` still consumes budget (same as Claude subscription HALT inside `invokeNode`).

**Timeout partial output (KD-17):** On timeout, still call `captureTranscript` with partial stdout (mirror `invokeNode` lines 499–509). Set `text` to last parseable `text` chunk if any, else `undefined` (Claude sets `text: stdout` on timeout — Grok may use parsed partial for cleaner ledger `outputText`). `parseError` always includes timeout message.

### KD-7: Model resolution — ledger opaque, CLI resolved in invoker only **(contract A)**

**Decision:** **`nodeModel(kind)` is unchanged** — returns `nodeOverrides[kind]?.model ?? NODE_PROFILE[kind].model` (opaque UI/config value: `opus`, `sonnet`, `grok-build`, etc.). This value is stored in:
- `deps.recordNode({ model: nodeModel(kind) })`
- `deps.setInflight?.({ model: nodeModel(kind) })`
- `NodeSpec.model` (passed to invoker as-is)

**CLI `-m` resolution happens only inside `buildGrokArgv` / `invokeGrokNode`:**

```typescript
// buildGrokArgv — never in nodeModel()
if (spec.model) argv.push('-m', resolveGrokModel(spec.model, spec.transcriptLabel));
```

**`transcriptLabel` shapes** (no new `NodeSpec` field):

| Builder | `transcriptLabel` value | Example |
|---------|-------------------------|---------|
| `buildSpec` | `kind` | `'blueprint'`, `'implement'` |
| `buildWaveSpec` | `` `${kind}:${target.ref}` `` | `'wimplement:src/foo.ts'`, `'research:task-1'` |

`resolveGrokModel` must parse the kind prefix from wave labels — see `parseKindFromTranscriptLabel` below. Per-kind `maxTurns` is unaffected: `buildSpec` / `buildWaveSpec` pass the typed `kind` directly to `resolveGrokMaxTurns(kind)`.

**`resolveGrokModel` alias table** (single source of truth in `src/agent/grok-model.ts`; ships in PR-1):

| Stored / UI value | `grok -m` CLI id | Notes |
|-------------------|------------------|-------|
| `grok-build` | `grok-build-0.1` | CLI requires full id (live-tested); differs from worker-core default string but same model tier |
| `grok-build-0.1` | `grok-build-0.1` | Passthrough |
| `grok-composer-2.5-fast` | `grok-composer-2.5-fast` | Passthrough |
| `opus` / `sonnet` / `haiku` | kind-based default (below) | `console.warn` + fallback |

**Kind-based defaults** (when stored value is null or a Claude alias):

| Kind category | Grok default `-m` |
|---------------|-------------------|
| Reasoning-heavy (`blueprint`, `review`, `driveplan`) | `grok-build-0.1` |
| Implementation / read (`implement`, `research`, `wimplement`, `verify`, `fix`, `summary`) | `grok-composer-2.5-fast` |

**`resolveGrokModel` implementation** (`src/agent/grok-model.ts`):

```typescript
/** Floor: 'blueprint'. Waves: 'wimplement:src/foo.ts' → 'wimplement'. */
export function parseKindFromTranscriptLabel(label?: string): LeafNodeKind | undefined {
  if (!label) return undefined;
  const kind = label.split(':')[0];
  if (!LEAF_NODE_KINDS.includes(kind as LeafNodeKind)) return undefined;
  return kind as LeafNodeKind;
}

export function resolveGrokModel(stored: string | undefined, kindHint?: string): string {
  const kind = parseKindFromTranscriptLabel(kindHint);
  const trimmed = stored?.trim();
  // 1. Passthrough / alias table lookup (grok-build → grok-build-0.1, etc.)
  if (trimmed && !['opus', 'sonnet', 'haiku'].includes(trimmed)) {
    return GROK_MODEL_ALIASES[trimmed] ?? trimmed;
  }
  // 2. Claude alias or absent stored → per-kind default
  if (trimmed && ['opus', 'sonnet', 'haiku'].includes(trimmed)) {
    console.warn(`resolveGrokModel: Claude alias '${trimmed}' on grok provider; using kind default`);
  }
  return kindDefaultGrokModel(kind);
}
```

**Unit test (PR-1):** `resolveGrokModel('sonnet', 'wimplement:src/foo.ts')` → `'grok-composer-2.5-fast'`.

**Intentional divergence:** Daemon node models (`grok-build` → `grok-build-0.1`) and worker-core `DEFAULT_MODEL_BY_PROVIDER` may use different stored strings; both map to the same CLI tier via their respective resolvers.

### KD-8: Provider selection in `makeLeafExecutorDeps`

```typescript
function resolveNodeInvoker(provider: ProviderId): NodeInvoker {
  switch (provider) {
    case 'grok-build': return GrokNodeInvoker;
    default:           return ClaudeNodeInvoker;
  }
}

function resolveAssertAuth(provider: ProviderId): () => AuthMode {
  switch (provider) {
    case 'grok-build': return assertGrokAuth;
    default:           return assertSubscriptionAuth;
  }
}
```

`makeLeafExecutorDeps(..., provider: ProviderId = 'claude')` sets:
- `invoker: resolveNodeInvoker(provider)`
- `assertAuth: resolveAssertAuth(provider)`
- `nodeProvider: provider`

### KD-9: `recordNode` telemetry at `runNode`

**Decision:** Extend `runNode` ledger write (`leaf-executor.ts` — `runNode`):

```typescript
deps.recordNode({
  project,
  todoId: leaf.id,
  session: sessionKey,
  epicId,
  leafId: leaf.id,
  nodeKind: kind,
  provider: deps.nodeProvider ?? 'claude',
  model: nodeModel(kind),              // opaque config value (contract A)
  knownPrice: Boolean(res.usage?.costUsd),
  authMode: res.authMode,
  exitCode: res.exitCode,
  durationMs: res.durationMs,
  rateLimited: res.rateLimited,
  inputTokens: res.usage?.inputTokens ?? 0,
  outputTokens: res.usage?.outputTokens ?? 0,
  cacheReadTokens: res.usage?.cacheReadTokens ?? 0,
  cacheCreationTokens: res.usage?.cacheCreationTokens ?? 0,
  costUsd: res.usage?.costUsd ?? 0,
  steps: res.usage?.numTurns ?? 0,
  parseError: res.parseError ? (res.parseError.startsWith('grok:') ? res.parseError : `grok: ${res.parseError}`) : null,
  // only prefix when deps.nodeProvider === 'grok-build'
  outputText: res.text ?? null,
  ...
});
```

`knownPrice: false` when Grok omits `total_cost_usd` (typical). `source` remains `'node'`.

### KD-10: Per-kind `--max-turns` policy

**Decision:** When `deps.nodeProvider === 'grok-build'`, attach `maxTurns` in `buildSpec` / `buildWaveSpec` from `GROK_MAX_TURNS_BY_KIND`:

| Kind | Default | Rationale |
|------|---------|-----------|
| blueprint | 30 | Multi-file planning + writes; raised from 25 (large blueprints) |
| implement | 50 | Editing loop; Claude has no cap — dogfood smoke showed multi-file impl ~15–25 turns |
| review | 20 | Read-only judgment |
| research | 25 | Read-only per task |
| wimplement | 35 | Single-file edit |
| verify | 20 | Read + bash |
| fix | 30 | Edit after failure |
| summary | 10 | Short read-only |
| driveplan / driveexec / report / reviewer-review | **N/A** | MCP-guarded; Claude-only |

**Env overrides:**

| Env var | Scope |
|---------|-------|
| `MERMAID_GROK_MAX_TURNS` | Global blunt override (all kinds) |
| `MERMAID_GROK_MAX_TURNS_IMPLEMENT` | Per-kind (pattern: `_BLUEPRINT`, `_REVIEW`, etc.) |

Resolution order: per-kind env → `GROK_MAX_TURNS_BY_KIND[kind]` → global env.

**Failure behavior:** `max turns reached` → `exitCode !== 0`, `ok: false`, `rateLimited: false` (NOT transient — do not pause). **`nodesSpent` already consumed** (incremented before spawn, same as timeout). Executor follows normal retry / fresh-attempt path for the leaf, not headless-breaker pause.

**New failure mode vs Claude:** Claude nodes can run unbounded turns until wall-clock timeout; Grok may fail earlier. Monitor `parseError: 'grok: max turns reached'` in ledger; tune per-kind defaults or env overrides.

### KD-11: Binary resolution

```typescript
function resolveGrokBin(): string {
  return process.env.GROK_BIN?.trim() || 'grok';
}
```

Pre-flight at `assertGrokAuth`: `Bun.which(resolveGrokBin())` or `grok --version`. Fail-closed: `GROK_BIN not found; install grok CLI or set GROK_BIN`.

### KD-12: Rate-limit / unreachable heuristics (narrow — match Claude)

**Decision:** Use the **same narrow stderr fallback as Claude** (`invokeNode` line 528):

```typescript
/\b429\b|rate limit (?:exceeded|reached)|too many requests/i.test(stderr)
```

**Do NOT:**
- Scan Grok `text` field for rate-limit signals
- Use broad patterns (`quota`, `usage limit`, `rate.?limit` on stdout) — lesson from Claude 4ec5a13c

**Forward-compatible:** If Grok JSON adds `errorCode: 'RATE_LIMIT'` on terminal object, treat as `rateLimited: true` without regex.

**Unreachable:** Reuse `CONN_ERR_RE` on stderr when no parseable terminal object (same gates as Claude).

**capReset:** Always `undefined` for Grok v1.

### KD-13: Usage / cost telemetry — best-effort sparse

Map `usage`, `num_turns`, `total_cost_usd` when present in terminal JSON. `knownPrice: false` when cost absent (KD-9).

### KD-14: Grok argv defaults and cwd spawn semantics

**`buildGrokArgv` always includes:**

```
--prompt-file <abs-path>
--output-format streaming-json   # when spec.transcriptPath set
--permission-mode <spec.permissionMode ?? bypassPermissions>
--cwd <abs(spec.cwd)>            # Grok CLI flag
--no-plan --no-subagents --no-memory --disable-web-search
```

**Spawn cwd (KD-14):** Set **both**:
1. `Bun.spawn([grokBin, ...argv], { cwd: spec.cwd, ... })` — process working directory
2. `--cwd` with `path.resolve(spec.cwd)` — Grok CLI internal cwd

They **must match** (same resolved absolute path). Test: assert `path.resolve(spec.cwd)` equals `--cwd` argv value.

Claude sets only spawn `cwd` (no `--cwd` flag exists). Grok requires the explicit flag per live-testing.

### KD-15: MCP execution-mode guard (verify + reviewer + any mcp__)

**Decision:** When `deps.nodeProvider === 'grok-build'`, **fail loud before any node spawn** if the leaf would enter an MCP-dependent execution mode.

```typescript
/** True when this leaf dispatch requires MCP tools (Claude-only in v1). */
export function requiresMcp(leaf: Todo, project: string): boolean {
  const mode = leafExecutionMode(leaf);  // existing helper
  if (mode === 'verify') return true;    // driveplan/driveexec/report; driveexec uses verb MCP tool
  if (mode === 'review') return true;    // runReviewPipeline: mcp__mermaid__add_session_todo (leaf-executor buildReviewSpec)
  // Floor/waves: allowedTools checked at spec build — if any kind adds mcp__, guard here too
  return false;
}

// runLeaf — immediately after deps.assertAuth():
if (deps.nodeProvider === 'grok-build' && requiresMcp(leaf, project)) {
  throw new Error(
    'grok-build provider cannot run MCP-dependent leaves (verify pipeline, reviewer pipeline). ' +
    'Set orchestrator_config.nodeProvider to claude for this project.'
  );
}
```

**Covered paths:**
| Execution mode | MCP surface | Guard |
|----------------|-------------|-------|
| `verify` | `driveexec` → `mcp__...__<verb>`; `report` → `mcp__mermaid__add_session_todo` | `requiresMcp` |
| `review` (e.g. `type: 'reviewer'`) | `buildReviewSpec` adds `mcp__mermaid__add_session_todo` | `requiresMcp` |
| Floor / waves | Built-in tools only | Allowed on Grok |

`launchWorker` catch path: release claim + escalate (same as auth HALT).

### KD-16: Separate Grok auth cache

**Decision:** Do **not** reuse Claude's `cachedAuthMode` (`node-invoker.ts` lines 270–307).

```typescript
let cachedGrokAuthMode: AuthMode | null = null;

export function assertGrokAuth(): AuthMode {
  if (cachedGrokAuthMode === null) {
    cachedGrokAuthMode = authModeFromGrokStatus(readGrokAuthStatus());
  }
  if (cachedGrokAuthMode !== 'grok') {
    throw new Error(`refusing to run grok nodes: active auth is '${cachedGrokAuthMode}', expected grok OIDC ...`);
  }
  return cachedGrokAuthMode;
}

function resolveGrokAuthMode(): AuthMode {
  if (cachedGrokAuthMode === null) {
    cachedGrokAuthMode = authModeFromGrokStatus(readGrokAuthStatus());
  }
  return cachedGrokAuthMode;
}

export function _resetGrokAuthCache(): void {
  cachedGrokAuthMode = null;
}
```

Claude keeps `_resetAuthCache()` unchanged. Tests that exercise both providers reset **both** caches.

**Daemon assumption:** One `nodeProvider` per project per process lifetime; mixed-provider leaves within a project are not supported in v1.

### KD-17: Timeout and partial streaming-json behavior

On timeout (`timedOut === true`):
1. `captureTranscript` with partial stdout (best-effort).
2. `ok: false`, `rateLimited: false`.
3. `parseError: 'grok: node timed out after ${timeoutMs}ms (killed)'`.
4. `text`: best-effort from `parseGrokOutput(partialStdout).text` if a chunk exists; else `undefined`.
5. Temp prompt file deleted in `finally` even on timeout.

Unit test: feed truncated streaming-json (no terminal `stopReason` line) → assert `ok: false`, partial `text` if mid-stream text chunk parsed.

---

## Detailed Design

### Project provider config (PR-3a — not deferred)

**Schema migration** (`orchestrator_config`):

```sql
ALTER TABLE orchestrator_config ADD COLUMN nodeProvider TEXT NOT NULL DEFAULT 'claude';
```

**API** (`orchestrator-config.ts`):

```typescript
export function getProjectNodeProvider(project: string): ProviderId {
  // read nodeProvider; validate ∈ {'claude','grok-build'}; default 'claude'
}

export function setProjectNodeProvider(project: string, provider: ProviderId): void;
```

**Routes** (`orchestrator-routes.ts`): Include `nodeProvider` in existing GET orchestrator config response; accept `nodeProvider` in POST body.

**Dogfood shortcut (pre-UI):** `MERMAID_NODE_PROVIDER=grok-build` env overrides DB read in `getProjectNodeProvider` (development only; documented in rollout).

**Routing authority:** Project-level `orchestrator_config.nodeProvider` (via `getProjectNodeProvider`) selects invoker/auth — **not** the per-session provider pin.

**Fleet labeling:** `session-status-store.recordSessionProvider` is written at launch (PR-3b) so `fleet-status` cards show the correct provider. It does **not** drive invoker selection.

### `buildGrokArgv(spec: NodeSpec, promptFile: string): string[]`

```typescript
export function buildGrokArgv(spec: NodeSpec, promptFile: string): string[] {
  const absCwd = path.resolve(spec.cwd);
  const argv: string[] = [
    '--prompt-file', promptFile,
    '--output-format', spec.transcriptPath ? 'streaming-json' : 'json',
    '--permission-mode', spec.permissionMode ?? 'bypassPermissions',
    '--cwd', absCwd,
    '--no-plan', '--no-subagents', '--no-memory', '--disable-web-search',
  ];
  if (spec.model) argv.push('-m', resolveGrokModel(spec.model, spec.transcriptLabel));
  if (spec.effort) argv.push('--effort', spec.effort);
  if (spec.allowedTools !== undefined) argv.push('--allowedTools', spec.allowedTools);
  if (spec.appendSystemPrompt) argv.push('--append-system-prompt', spec.appendSystemPrompt);
  if (spec.maxTurns != null) argv.push('--max-turns', String(spec.maxTurns));
  return argv;
}
```

### `invokeGrokNode(spec: NodeSpec): Promise<NodeResult>`

Mirror `invokeNode` structure (wall-clock timing, concurrent drain, timeout race, `KILL_GRACE_MS`, `DRAIN_CAP_MS`).

Spawn:

```typescript
const grokBin = resolveGrokBin();
const argv = buildGrokArgv(spec, promptFile);
proc = Bun.spawn([grokBin, ...argv], {
  cwd: spec.cwd,
  stdout: 'pipe',
  stderr: 'pipe',
  env: process.env,
});
```

### Changes to `leaf-executor.ts`

1. **`LeafExecutorDeps`:**
   ```typescript
   nodeProvider?: ProviderId;  // default effective 'claude' when undefined
   ```

2. **`nodeModel(kind)`:** **Unchanged** — opaque config value only (KD-7 contract A).

3. **`buildSpec` / `buildWaveSpec`:** When `deps.nodeProvider === 'grok-build'`, add `maxTurns: resolveGrokMaxTurns(kind)`.

4. **`runLeaf`:** `requiresMcp` guard after `assertAuth()` (KD-15).

### Changes to `coordinator-live.ts` (PR-3b)

In `launchWorker`, after pool name is assigned (alongside existing `sessionName` persist):

```typescript
const provider = getProjectNodeProvider(ledProject);  // not hardcoded 'claude'
// pool slot tagging: getOrCreateSlot / poolSessionName use `provider`

// Best-effort — same durability pattern as sessionName persist (lines ~1731–1735).
// fleet-status reads session_status.provider; without this pin, grok lanes show 'claude'.
try {
  recordSessionProvider(poolProject, poolName, provider);
} catch { /* best-effort; pool name + ledger still carry provider */ }

// ... headless leaf branch:
const res = await runLeaf(project, todo, await makeLeafExecutorDeps(project, ledProject, todo, carried, provider));
```

Import `recordSessionProvider` from `session-status-store.ts`.

### Changes to `fleet-status.ts` (PR-3b)

Today (`fleet-status.ts` — `buildFleetRow`): `provider` comes from `session-status-store.getStatus().provider`, defaulting to `'claude'`. Grok-tagged lanes without `leaf_inflight` fall back to `getGrokHarnessForInspection().isAlive()` (retired in-process harness).

**Changes:**
1. **Liveness:** Headless grok lanes use **`leaf_inflight` exclusively** for `working` status. Remove harness `isAlive` fallback for pool-tagged grok lanes post-P7.
2. **Provider label:** Rely on `recordSessionProvider` pin from `launchWorker`. Update comment block (lines ~219–222) to document headless grok path.
3. **Fallback (optional):** When `session_status.provider` is null, fall back to `getProjectNodeProvider(project)` so fleet cards stay correct even if the pin write failed.

### Transcript format

Store raw Grok stdout; boundary markers via exported `captureTranscript`. No normalization in v1.

---

## Alternatives Considered

| Alternative | Pros | Cons | Outcome |
|-------------|------|------|---------|
| Single `invokeNode` with `if (provider)` branches | One spawn function | Mixed auth, prompt, parsing; high regression risk | Rejected |
| worker-core `generateText` loop | Rich tool loop | Not single CLI invocation | Rejected |
| Hybrid per-kind routing | Optimize cost/quality | Two auth systems per leaf | Deferred |
| `json` output only | Simpler parser | Loses incremental transcript | Rejected for production |
| Grok via API key in env | CI-friendly | Conflicts with OIDC CLI auth | Out of scope |
| **Shell wrapper normalizing Grok → Claude stream-json** | Reuse `parseNodeJson` | Operational complexity, temp files, wrapper maintenance, hides real failures | Rejected |
| **`MERMAID_NODE_PROVIDER` env (dogfood)** | Opt-in before DB column | Not durable across hosts | **Accepted as dev shortcut** in PR-3a alongside DB column |

---

## Testing Strategy

### Unit tests (no real spawn)

| Suite | Cases |
|-------|-------|
| `buildGrokArgv` | Required flags; `--cwd` === `path.resolve(spec.cwd)`; `-m` from `resolveGrokModel`; omits Claude flags |
| `parseGrokOutput` | json `EndTurn`; `Cancelled`; streaming-json terminal line; **truncated stream (no terminal)** |
| `resolveGrokModel` | `grok-build` → `grok-build-0.1`; Claude alias fallback; **wave label** `resolveGrokModel('sonnet', 'wimplement:src/foo.ts')` → `grok-composer-2.5-fast` |
| `parseKindFromTranscriptLabel` | `'blueprint'` → `'blueprint'`; `'wimplement:foo.ts'` → `'wimplement'`; invalid → `undefined` |
| `assertGrokAuth` / `_resetGrokAuthCache` | valid / expired / missing; independent from `_resetAuthCache` |
| Rate-limit | Narrow stderr 429; **no** false positive when `text` contains "quota" |
| Timeout | Partial stdout → `captureTranscript` called; `ok: false`; `parseError` mentions timeout |
| Temp file | Deleted on throw, timeout, success |

### Integration tests

| Suite | Approach |
|-------|----------|
| `leaf-executor.test.ts` | Inject `nodeProvider: 'grok-build'` + mock invoker (existing pattern); assert `provider`, `knownPrice` in `recordNode` |
| `requiresMcp` | Reviewer leaf + grok provider → throws before invoke |
| `makeLeafExecutorDeps` | Provider grok → `GrokNodeInvoker` + `assertGrokAuth` |

### Manual test plan

1. `grok auth status` healthy machine.
2. Single blueprint node — worktree file + transcript.
3. Induce max-turns exhaustion — `ok: false`, `nodesSpent` consumed, **no pause**.
4. Airplane mode — `unreachable: true`, pause path.
5. Kill mid-stream (low timeout) — partial transcript file, `ok: false`.
6. Reviewer leaf on grok project — fail loud at dispatch.

---

## PR Plan

| PR | Title | Contents | Depends on |
|----|-------|----------|------------|
| **PR-1** | Grok node primitive | `buildGrokArgv`, `parseGrokOutput`, `resolveGrokModel`, `parseKindFromTranscriptLabel` (+ alias table), `assertGrokAuth`, `resolveGrokAuthMode`, `_resetGrokAuthCache`, `invokeGrokNode`, `GrokNodeInvoker`, `AuthMode: 'grok'`, **export `captureTranscript`**, unit tests (incl. wave kind-hint) | — |
| **PR-2** | Leaf executor wiring | `LeafExecutorDeps.nodeProvider` (defaults `undefined` → effective `'claude'`), `resolveNodeInvoker`, `resolveAssertAuth`, `GROK_MAX_TURNS_BY_KIND`, `requiresMcp`, `buildSpec` maxTurns, `runNode` `provider`/`knownPrice`/`parseError` prefix; tests pass `nodeProvider: 'grok-build'` via deps fixture | PR-1 |
| **PR-3a** | Node provider config + API | `orchestrator_config.nodeProvider` migration, `getProjectNodeProvider` / `setProjectNodeProvider`, `MERMAID_NODE_PROVIDER` dev override, orchestrator-routes GET/POST | — |
| **PR-3b** | Coordinator + fleet wiring | Thread provider through `launchWorker` → `makeLeafExecutorDeps`, pool slot tag, **`recordSessionProvider(poolProject, poolName, provider)`**, `fleet-status` headless grok liveness via `leaf_inflight` + provider fallback | PR-2, PR-3a |
| **PR-4** | MCP guard + docs | `requiresMcp` hardening, reviewer + verify test cases, README operator note | PR-3b |
| **PR-5** | UI (separate owner) | DaemonNodesMatrix grok models; orchestrator `MODEL_CHOICES`; `nodeProvider` toggle | PR-3a, PR-3b |

PR-1 and PR-2 merge safely with provider still `'claude'` at coordinator (Grok code dormant until PR-3b). PR-3a can merge independently (config defaults `'claude'`).

---

## Rollout

1. **Dark launch:** PR-1 merged; no behavior change.
2. **Dogfood:** PR-3a → set `nodeProvider='grok-build'` via API or `MERMAID_NODE_PROVIDER` for one project.
3. **Live:** PR-3b enables coordinator routing.
4. **Monitor:** Ledger `provider`, `grok: max turns reached`, pause rate.
5. **Rollback:** Set `nodeProvider` back to `'claude'`.

---

## Open Questions

| ID | Question | Owner | Default if unresolved |
|----|----------|-------|----------------------|
| OQ-1 | Exact CLI model ids | Implementer | **Resolved:** `grok-build` → `grok-build-0.1` in alias table (KD-7) |
| OQ-2 | `grok auth status --json` shape | Implementer | Fall back to `~/.grok/auth.json` |
| OQ-3 | Config storage for `nodeProvider` | Config PR | **Resolved:** `orchestrator_config.nodeProvider` (PR-3a) |
| OQ-4 | Claude model on grok provider | Product | Warn + kind default (KD-7) |
| OQ-5 | streaming-json terminal line format | QA | Parser handles whole-buffer + last-line scan |
| OQ-6 | Tier overrides vs project provider | Product | **Resolved non-goal:** tier-override-store does not affect `runLeaf` v1 |
| OQ-7 | `thought` in ledger | Observability | `text` only in `outputText` |
| OQ-8 | xAI 429 corpus | Ops | Ship Claude-narrow regex; extend after observation |

---

## Appendix A: Reference snippets (current codebase)

**`NODE_PROFILE` defaults** (`leaf-executor.ts` — `NODE_PROFILE`):

```typescript
blueprint: { model: 'opus', allowedTools: 'Read Write Grep Glob Bash', effort: 'high' },
implement: { model: 'sonnet', allowedTools: 'Read Edit Grep Glob Bash', effort: 'medium' },
review:    { model: 'opus', allowedTools: 'Read Grep Glob Bash', effort: 'high' },
```

**`runNode` invoke seam** (`leaf-executor.ts` — `runNode`):

```typescript
res = await deps.invoker.invoke(spec);
```

**`ProviderId`** (`worker-agent.ts`):

```typescript
export type ProviderId = 'claude' | 'grok-build' | 'codex';
```

**Claude `ok` predicate** (`node-invoker.ts` — `invokeNode`):

```typescript
const ok = exitCode === 0 && !transient && !parsed.isError;
// auth enforced pre-spawn only; not in ok
```

**Reviewer MCP spec** (`leaf-executor.ts` — `buildReviewSpec`):

```typescript
allowedTools: `${NODE_PROFILE.review.allowedTools} mcp__mermaid__add_session_todo`,
```

---

## Appendix B: Example Grok spawn

```bash
grok \
  --prompt-file /tmp/mermaid-node-abc123/prompt.txt \
  --output-format streaming-json \
  --permission-mode bypassPermissions \
  --cwd /absolute/path/to/worktree \
  --no-plan --no-subagents --no-memory --disable-web-search \
  -m grok-build-0.1 \
  --effort medium \
  --allowedTools "Read Edit Grep Glob Bash" \
  --max-turns 50
```

Spawn opts: `{ cwd: '/absolute/path/to/worktree' }` (same path as `--cwd`).