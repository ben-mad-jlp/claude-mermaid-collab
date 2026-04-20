# Spike: PreToolUse hook as policy bridge

**Task:** `p3-spike-hook-bridge`
**Phase:** 3 — permissions
**Question:** Can a Claude Code PreToolUse hook block on stdin while consulting a Unix socket, and will `--print` mode honor the hook envelope JSON (`permissionDecision` / `permissionDecisionReason` / `systemMessage`)?

## Goal

Use Claude Code `PreToolUse` hooks as the authoritative gate for agent tool calls. The hook itself is a thin bridge: it receives the tool-call payload on stdin, round-trips it over a Unix domain socket to an in-process policy/approval service inside the mermaid-collab server, and writes the returned verdict envelope back to stdout. No business logic lives in the hook script — all allow/deny/ask decisions come from the long-running parent process that already owns session state.

## Unknowns

1. **Does the CLI block on hook stdout until close in `--print` mode?** — i.e. is there a streaming bypass where a tool call can fire before the hook envelope arrives, or is it strictly synchronous like interactive mode?
2. **Can the hook script open + read + write a Unix socket within <100ms p50?** — spawn cost of Bun/Node on every tool call is the dominant risk; need to measure whether a minimal shell-level `socat` / `nc -U` variant is cheaper than a JS runtime startup.
3. **Is the returned envelope `{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"deny|allow|ask", permissionDecisionReason:"..."}}` respected in `--print` runs the same as interactive?** — particularly `permissionDecision: "ask"`, which has no human to prompt in `--print` and may silently degrade to either allow or deny.

## Experiment plan

Three small harness scripts under `src/agent/__tests__/spikes/fixtures/`:

1. **`hook-echo.sh`** — logs stdin to a tempfile and emits a fixed deny envelope on stdout. Wired via a temporary `.claude/settings.json` with a `hooks.PreToolUse` entry scoped to `Bash`. Confirms the CLI actually invokes the hook and honors the deny verdict in `--print` mode.
2. **`hook-socket-bridge.ts`** — Bun script. Connects to `$CLAUDE_MERMAID_POLICY_SOCK`, forwards the PreToolUse JSON payload, reads one line of response, writes it to stdout, exits 0. Measures wall time from stdin-close to stdout-close.
3. **`hook-bridge.spec.ts`** — a Bun/Node test that (a) spawns a toy Unix socket server returning canned verdicts keyed by `tool_name` + regex on `tool_input`, (b) writes a temporary settings file pointing `PreToolUse` at `hook-socket-bridge.ts`, (c) runs `claude --print -p 'run ls' --permission-mode default`, and (d) asserts that the final transcript shows tool refusal / acceptance matching the canned verdict. Run matrix: `{allow, deny, ask}` × `{Bash, Read, Write}`.

## Measurements to record

- **Block time** — wall clock from hook spawn to CLI tool dispatch (proves the CLI waits).
- **RTT latency** — socket connect + write + read + close, p50/p95 over 100 iterations.
- **`permissionDecision: "ask"` behavior in `--print`** — expected: treated as deny with reason surfaced; record actual.
- **Exit-code vs zero-with-envelope** — does exit code 2 still deny even without a JSON envelope? Does non-zero with a valid envelope override the envelope?
- **`systemMessage` field** — whether it surfaces in the JSONL transcript, the `--print` stdout, neither, or both.

## Findings

| scenario | exit code | envelope | CLI behavior observed | latency ms | notes |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |
|  |  |  |  |  |  |
|  |  |  |  |  |  |
|  |  |  |  |  |  |
|  |  |  |  |  |  |
|  |  |  |  |  |  |

**What we learned:** _(fill in after running the harness)_

Per-unknown pass/fail:
- U1 (blocking in `--print`): _pending_
- U2 (<100ms p50 socket RTT): _pending_
- U3 (envelope parity with interactive): _pending_

## Recommendation

_Pending experiment results._ Decision is go / no-go on **PreToolUse hook + Unix-socket bridge** vs alternatives:

- **MCP permission-prompt tool** — heavier, requires the agent to already speak MCP, couples policy to the tool protocol.
- **Supervising parent process** — intercept at the spawn boundary; strongest control but duplicates what the hook already does.
- **Stdin proxy** — rewrite the stream-json stream in-flight; brittle and violates the documented extension point.

If **go**, integration points:
- `src/agent/child-manager.ts:47-65` — extend `buildArgv()` / env to inject `CLAUDE_MERMAID_POLICY_SOCK` and materialize the settings fragment that registers the hook.
- New module `src/agent/policy/` — owns the Unix socket server, verdict cache, and the allow/deny/ask decision tree. Reuses session identity already tracked by child-manager.

## Evidence / References

- Claude Code hook docs — `PreToolUse` event shape, envelope fields (`hookSpecificOutput.permissionDecision`, `permissionDecisionReason`, `systemMessage`), exit-code semantics.
- `src/agent/child-manager.ts:47-65` — argv / env surface where the hook registration and socket path must be injected.
- `.claude-plugin/` — config area; confirm whether plugin-scoped `settings.json` is picked up by `claude --print` the same as project-scoped.
- Follow-up action: once the harness lands, commit captured hook stdin payloads and verdict envelopes under `src/agent/__tests__/fixtures/hooks/` so the policy module can be unit-tested without spawning the CLI.
