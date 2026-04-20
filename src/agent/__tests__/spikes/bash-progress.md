# Spike: Live Bash stdout progress

**Task:** `p2-spike-bash-progress`
**Phase:** 2 — tool-call rendering
**Question:** How do we surface live `Bash` tool stdout to the UI as it streams, before the tool_result frame lands?

## Goal

Render live stdout (and stderr) for long-running Bash tool invocations in the agent UI with sub-second latency. Final `tool_result` already projects fine via the `assistant` / `user` frames — this spike is strictly about the *in-flight* bytes.

## Option A — Tail the JSONL transcript file

Claude Code persists every turn to `~/.claude/projects/<slug>/<sessionId>.jsonl`. Watch that file with a tail-follow reader and emit deltas keyed by `tool_use_id`.

Pros:
- Survives child restarts; file is the source of truth.
- No coupling to the stdin/stdout framing of `--output-format stream-json`.

Cons:
- Filesystem polling / fs.watch quirks on Linux (inotify coalescing) — debounce needed.
- Claude flushes the JSONL in larger chunks than the stdout stream; latency is worse (observed 500ms–2s lag).
- Path resolution depends on `cwd` slug hashing — fragile across claude-cli versions.
- Duplicates work the child-manager already does (line-parsing JSON).

## Option B — Parse `stream_event` → `content_block_delta` with `bash_output` delta

`child-manager.ts` already forwards every stdout line as a parsed `stdout-frame` event (see lines 179–205). `projector.ts` only handles `text_delta` today (line 38). Extend it to handle `event.delta.type === 'input_json_delta'` for tool_use blocks and, per stream-json schema, the `bash_output` partial deltas that arrive on the same content block as the `tool_use` start.

Pros:
- Zero new I/O — reuses the existing stdout pipe and line reader.
- Arrives in the same frame cadence as assistant text deltas (tens of ms).
- Keyed by `content_block_start.content_block.id` (the `tool_use_id`), which we already need for tool-call rendering.
- Pure projector change, easily unit-tested with synthetic frames.

Cons:
- Shape of `bash_output` partial deltas is only documented informally; needs a fixture capture to pin down.
- Requires `--include-partial-messages` flag — already set in `buildArgv()` (child-manager.ts:55), so no new CLI surface.

## Recommendation

**Go with Option B (stream_event deltas).** It composes cleanly with the existing projector pipeline, has materially lower latency, and avoids a second I/O path. Option A is kept as a fallback for the historical-replay / resume case, but even there we replay the JSONL through the same parser, so the projector logic is shared.

## Evidence / References

- `src/agent/child-manager.ts:47-65` — argv already enables `--include-partial-messages` and `stream-json` I/O.
- `src/agent/child-manager.ts:179-205` — every stdout line is JSON-parsed and emitted as `stdout-frame`; Option B plugs in downstream with no new plumbing.
- `src/agent/projector.ts:26-60` — existing `stream_event` / `content_block_delta` branch; extend with a `bash_output` / `input_json_delta` case emitting a new `AgentEvent` kind (e.g. `tool_progress`).
- Follow-up task: capture a real fixture of a long `Bash` turn and commit under `src/agent/__tests__/fixtures/` so the projector test can assert on exact delta shape.
