# Blueprint — P1: Headless node primitive (`invokeNode`)

A **node** = ONE bounded, non-interactive `claude -p` invocation: spawn, run to
completion, capture stdout, return a structured result. No tmux, no TUI scrape,
no liveness polling — that distinguishes it from `ClaudeCodeAgent` (interactive
tmux session) and `GrokOwnHarness` (in-process loop). The node is the atomic
build-block a higher-level executor will chain.

---

## 1. CLI surface (CAPTURED FROM REAL `claude --help` @ this machine)

Real flags (exact names — confirmed present unless noted):

| Need | Real flag | Notes |
|---|---|---|
| Headless / print mode | `-p` / `--print` | Print response and exit. |
| Select model | `--model <model>` | alias (`opus`/`sonnet`/`fable`) or full id. |
| Restrict allowed tools | `--allowedTools` / `--allowed-tools <tools...>` | comma/space list. Also `--disallowedTools`, and `--tools <tools...>` to set the built-in set (`""` = none, `"default"`, or `"Bash,Edit,Read"`). |
| Working directory / cwd | **NO `--cwd` flag exists.** Set cwd on the spawned process (`Bun.spawn({ cwd })`). `--add-dir <dirs...>` only *adds* tool-access dirs, it does not change cwd. |
| Structured / JSON output | `--output-format <format>` = `text` \| `json` \| `stream-json` (only with `--print`). `json` = single result object; `stream-json` = realtime events. Also `--json-schema <schema>` for structured-output validation. |
| Turn / step cap | **`--max-turns` DOES NOT EXIST** in this CLI build (grep of `--help` = 0 hits). There is no per-invocation step cap flag. Bound a node via the wrapper instead: a wall-clock **timeout** (kill the process) + read `num_turns` from the `json` result afterward. **UNKNOWN-to-confirm:** whether a future CLI re-adds `--max-turns`; treat its absence as load-bearing. |
| Append system prompt | `--append-system-prompt <prompt>` | (also `--system-prompt` to replace). Mirrors claude-launch.ts contextPrompt usage. |
| Permission mode | `--permission-mode <mode>` = `acceptEdits` \| `auto` \| `bypassPermissions` \| `default` \| `dontAsk` \| `plan`. For a headless build node use `bypassPermissions` (or `--dangerously-skip-permissions`) — there is no human to answer prompts. |
| Session persistence | `--no-session-persistence` (only with `--print`) — recommended for throwaway nodes so they don't litter resumable sessions. |

### Auth-mode detection (THE load-bearing finding)

Mechanism: **`claude auth status --json`** (exit 0). Real output on this machine:

```json
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "email": "bmaderazo@jlpengineering.com",
  "orgId": "…",
  "subscriptionType": "max"
}
```

Decision rule for `authMode`:
- `subscription` ⇐ `loggedIn === true` AND `authMethod === "claude.ai"` AND `apiProvider === "firstParty"` AND `subscriptionType` ∈ {`max`,`pro`,…} (present & non-empty).
- `api` ⇐ `authMethod`/`apiProvider` indicates an API key (e.g. not `claude.ai`), OR env `ANTHROPIC_API_KEY` is set AND status does NOT report a claude.ai subscription. (Note: `--bare`/`CLAUDE_CODE_SIMPLE=1` forces ANTHROPIC_API_KEY-only auth — do NOT use `--bare` for nodes, it bypasses the subscription.)
- `unknown` ⇐ `auth status` failed to run/parse, or fields missing.

To **assert "this is the subscription, not an API key"**: require `authMethod==="claude.ai"` && `apiProvider==="firstParty"` && a truthy `subscriptionType`. Belt-and-braces: also assert `process.env.ANTHROPIC_API_KEY` is NOT the active credential — but the status JSON is authoritative (it reflects the resolved active auth), so the JSON check alone is sufficient and is the primary guard.

---

## 2. Exact `claude -p` invocation the NodeInvoker uses

argv (NOT a shell string — spawn directly, no shell quoting needed):

```
claude
  -p
  --output-format json
  --no-session-persistence
  --permission-mode bypassPermissions        # headless: no human to approve
  --model <spec.model>                        # if provided
  --allowedTools <spec.allowedTools>          # if provided (else inherit defaults)
  --append-system-prompt <spec.appendSystemPrompt>   # if provided
  <spec.prompt>                               # positional prompt (last)
```
- **cwd** is set on the spawn options (`Bun.spawn(argv, { cwd: spec.cwd })`), NOT a flag.
- Mirrors claude-launch.ts's existing flag set (`--allowedTools`, `--model`, `--append-system-prompt`, runtime-mode → permission flags) so a node and an interactive lane stay consistent. Difference: node adds `-p --output-format json --no-session-persistence` and uses argv (no `shellSingleQuote`).
- Do NOT use `--bare` (it forces API-key auth, defeating the subscription guard).

---

## 3. TypeScript interfaces

```ts
// src/agent/node-invoker.ts

export type AuthMode = 'subscription' | 'api' | 'unknown';

/** One bounded headless `claude -p` invocation. */
export interface NodeSpec {
  /** The user prompt (positional). Required. */
  prompt: string;
  /** Model alias or full id (--model). Optional → CLI default. */
  model?: string;
  /** Comma/space tool allowlist (--allowedTools). Optional. */
  allowedTools?: string;
  /** Appended system prompt (--append-system-prompt). Optional. */
  appendSystemPrompt?: string;
  /** Working dir set on the spawned process (NOT a CLI flag). Required for a build node. */
  cwd: string;
  /** Wall-clock cap (ms). On expiry the process is killed and rateLimited=false, ok=false. */
  timeoutMs?: number; // default e.g. 600_000
  /** Ledger correlation (optional but recommended). */
  leafId?: string;
  epicId?: string;
  /** Permission mode override. Default 'bypassPermissions'. */
  permissionMode?: 'bypassPermissions' | 'acceptEdits' | 'default' | 'plan' | 'auto' | 'dontAsk';
}

export interface NodeUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;        // from result.total_cost_usd if present
  numTurns?: number;       // from result.num_turns — the de-facto "steps"
}

export interface NodeResult {
  ok: boolean;             // exitCode===0 && !rateLimited && parsed result is_error!==true
  exitCode: number;
  stdout: string;          // raw stdout (the JSON result string, or text)
  durationMs: number;
  usage?: NodeUsage;
  rateLimited: boolean;    // detected via exit code / stderr signal (see §4)
  authMode: AuthMode;      // the mode in effect for this node (from the pre-flight guard)
  /** Best-effort parsed final assistant text from the json result (result.result). */
  text?: string;
  /** Set when --output-format json failed to parse. */
  parseError?: string;
}
```

---

## 4. `invokeNode(spec)` implementation plan

1. **Build argv** per §2 (push flags only when the corresponding spec field is set).
2. **Spawn**: `Bun.spawn(argv, { cwd: spec.cwd, stdout:'pipe', stderr:'pipe', env: process.env })`. Start a `performance.now()` timer.
3. **Timeout**: race the process exit against `spec.timeoutMs`; on timeout `proc.kill()`, mark `ok=false`, `rateLimited=false`, `exitCode = (whatever)`, note timeout in `parseError`/`text`.
4. **Capture** full stdout + stderr (await streams), `exitCode = await proc.exited`.
5. **Parse**: with `--output-format json`, stdout is a single JSON object. Extract `result.result` (final text), `result.num_turns`, `result.total_cost_usd`, `usage.input_tokens`/`output_tokens`, and `result.is_error`. On JSON.parse failure → set `parseError`, keep raw stdout, `text` = raw.
6. **Rate-limit detection** — **UNKNOWN-to-confirm-at-runtime.** No documented exit code / stderr string is guaranteed by `--help`. Detection heuristic (mark each as best-effort, confirm against a real 429 in the test plan):
   - stderr/stdout matches `/rate.?limit|429|too many requests|usage limit|overloaded|quota/i`, OR
   - the json result `subtype`/`is_error` indicates a limit.
   Name the exact signal in code as a `RATE_LIMIT_RE` constant with a `// CONFIRM: observed exit code = ? , observed stderr = ?` TODO. Until confirmed, `rateLimited` is heuristic-only.
7. **authMode**: carry the value resolved by the pre-flight guard (§5) into the result (do NOT re-run `auth status` per node — run once, cache).
8. Return `NodeResult`.

---

## 5. Pre-flight subscription-identity guard

- **Where**: a module-level `assertSubscriptionAuth(): AuthMode` in `src/agent/node-invoker.ts`, run **ONCE** before the first node (memoized, like the conformance gates in registry.ts). The executor calls it at startup; `invokeNode` calls the memoized getter.
- **Check**: run `claude auth status --json` (via `Bun.spawnSync`), parse, apply §1 decision rule.
- **Fail-closed**: if `authMode !== 'subscription'`, **throw** (`refusing to run nodes: active auth is '<mode>', expected claude.ai subscription`). Nodes never run under an API key by default — matches registry.ts's fail-closed conformance pattern (a non-conformant/non-subscription provider must NEVER launch).
- A `NODE_ALLOW_API=1` escape hatch MAY be added later, but default is fail-closed on subscription.

---

## 6. worker-ledger.ts schema extension (non-breaking)

Add new **optional** fields to `LedgerEntry` (all optional → existing callers compile unchanged):
`nodeKind?`, `nodesSpent?`, `authMode?`, `exitCode?`, `durationMs?`, `rateLimited?`, `leafId?`, `epicId?` (epicId already exists).

Add columns via the SAME additive-migration idiom already in `openDb()` (the `PRAGMA table_info` → `ALTER TABLE ADD COLUMN` block that added `epicId`):

```ts
const add = (name: string, decl: string) => {
  if (!cols.some(c => c.name === name)) db.exec(`ALTER TABLE worker_ledger ADD COLUMN ${name} ${decl}`);
};
add('nodeKind', 'TEXT');
add('nodesSpent', 'INTEGER');
add('authMode', 'TEXT');
add('exitCode', 'INTEGER');
add('durationMs', 'INTEGER');
add('rateLimited', 'INTEGER');   // 0/1 like knownPrice
add('leafId', 'TEXT');
```
- Update the `recordPhase` INSERT column list + bindings to include the new fields (`entry.field ?? null`, `rateLimited ? 1 : 0`). Existing rows backfill as NULL.
- `rowToEntry` coerces `rateLimited` to Boolean like it does `knownPrice`.
- No index changes required; `idx_ledger_ts`/`project`/`todo` cover node queries too.
- **Non-breaking guarantee**: columns are additive + nullable, fields are optional, and `recordPhase` already swallows failures — a node that records a row needs only `project`/`todoId`/`session`/`phase`/`provider`/`model`/`source` (set `phase='node'`, `provider='claude'`, `source='node'`, `model=spec.model`).

---

## 7. Thin `NodeInvoker` interface (NOT the WorkerAgent port)

The node primitive is deliberately NOT a `WorkerAgent` (no tmux launch, no pane
detectors, no event stream). It is a one-shot function behind a tiny seam:

```ts
// src/agent/node-invoker.ts
export interface NodeInvoker {
  invoke(spec: NodeSpec): Promise<NodeResult>;
}
export function assertSubscriptionAuth(): AuthMode; // memoized pre-flight guard
export function invokeNode(spec: NodeSpec): Promise<NodeResult>; // default impl
export const ClaudeNodeInvoker: NodeInvoker;        // wraps invokeNode
```
- **Lives in**: `src/agent/node-invoker.ts` (sibling of `worker-agent.ts`/`registry.ts`). It does NOT touch the registry or the WorkerAgent port — a later leaf can compose nodes into a higher-level executor.

---

## 8. File-by-file change list

**New files**
- `src/agent/node-invoker.ts` — `NodeSpec`/`NodeResult`/`NodeUsage`/`AuthMode`, `assertSubscriptionAuth()`, `invokeNode()`, `ClaudeNodeInvoker`, `RATE_LIMIT_RE`, argv builder.
- `src/agent/__tests__/node-invoker.test.ts` — unit tests for argv construction, json parse, authMode rule, rate-limit regex, ledger field mapping (mock spawn).

**Edited files**
- `src/services/worker-ledger.ts` — extend `LedgerEntry` (optional fields), add additive `ALTER TABLE` migrations, extend `recordPhase` INSERT, extend `rowToEntry` for `rateLimited`.

**No edits to**: `worker-agent.ts`, `registry.ts`, `claude-code.ts`, `grok-own.ts`, `claude-launch.ts` (the node primitive is additive — it neither replaces nor routes through the interactive port).

---

## 9. Test plan — run ONE node in a throwaway worktree

1. `git worktree add /tmp/node-probe-$$ HEAD` (throwaway tree).
2. Pre-flight: assert `claude auth status --json` parses and yields `authMode==='subscription'` (fail-closed otherwise) — confirms the guard before any spend.
3. Run one node: `invokeNode({ prompt: "Print the word OK and nothing else.", cwd: '/tmp/node-probe-$$', allowedTools: '', model: 'sonnet', timeoutMs: 120000 })`. Assert `ok===true`, `exitCode===0`, `text` contains `OK`, `durationMs>0`, `usage.numTurns>=1`, `rateLimited===false`.
4. Run one node that WRITES (`permission-mode bypassPermissions`, prompt "create file probe.txt with content hi") and assert the file exists in the worktree — confirms cwd threading via spawn options (no `--cwd` flag).
5. Confirm a ledger row was appended (`queryLedger({ project })` shows `phase='node'`, `authMode='subscription'`, `exitCode=0`, populated `durationMs`).
6. (Best-effort) Force/observe a rate-limit to CONFIRM the §4 `RATE_LIMIT_RE` signal and the real exit code; update the `// CONFIRM` TODO with the observed values. `git worktree remove --force /tmp/node-probe-$$`.

---

## KEY UNKNOWNS / flags

- **No `--max-turns` flag** in this CLI build — there is no per-call step cap; bound nodes with a wall-clock timeout and read `num_turns` post-hoc.
- **No `--cwd` flag** — cwd MUST be set on the spawned process.
- **Rate-limit signal is UNKNOWN** — no documented exit code/stderr string; detection is a heuristic regex with a runtime-confirm TODO (test plan step 6).
