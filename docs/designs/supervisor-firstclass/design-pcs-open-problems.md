# PCS Open Problems — grounded resolutions + Grok review

Resolutions to the 10 under-thought parts, each **grounded in the real code** by a research agent, then pressure-tested by Grok (\[\[consult-grok-pcs-and-structure]] consult 4). Verdicts marked ✅ accept / ⚠️ revise / ❌ rejected-by-grok.

## CROSS-CUTTING FINDING (changes the foundation)
**There is NO server-side Claude/Anthropic call path.** The only server-side LLM call is `consult_grok` (xAI, `src/mcp/setup.ts`); everything else is the tmux worker-session pattern (spawn `claude` CLI, read transcript). No `@anthropic-ai/sdk`.
→ FINAL RESOLUTION (after grounding the Claude Agent SDK): **the Supervisor is a tmux Claude session running the supervisor skill — NO SDK, NO API key.** The Agent SDK requires `ANTHROPIC_API_KEY` and cannot reuse the Claude Code subscription login (Anthropic restricts third-party programmatic subscription use), and is a heavyweight subprocess. So there is no free server-side Claude path; the supervisor's judgment lives in a Claude session (subscription auth), classifying by reading the last turn (as the current skill does). The reconciliation pass (#4), if/when built, likewise runs as a spawned Claude session (or is deferred), not a server LLM call. A fast server-side classifier (raw `@anthropic-ai/sdk`) remains an opt-in upgrade ONLY if a key is later added. Phase 0 therefore needs NO SDK — it shrinks to config/secrets + single-writer. ~~Earlier (now SUPERSEDED) decision: use the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`** **= programmatic Claude Code), NOT the raw** **`@anthropic-ai/sdk`.** It launches Claude Code itself (full skills + MCP + judgment) under the server's control and inherits Claude Code's ambient auth — **NO API key needed** (codebase has zero ANTHROPIC_API_KEY; tmux sessions already run `claude` on subscription auth). Run the **Supervisor as a per-EVENT Agent-SDK Claude Code turn** (feed durable state → structured decision → act) instead of a tmux session — which ALSO means the supervisor has no accumulating context, so the watchdog only applies to long-lived Planner/Workers, not the supervisor. The reconciliation pass (#4) is likewise an Agent SDK invocation. No model skew (it's Claude, not Grok), no raw API. Phase 0 foundation. (Earlier draft said add @anthropic-ai/sdk + API key — superseded.)

## Resolutions

### #1 Worker completion → acceptance gate  ⚠️ (simplify per Grok)
Add `acceptanceStatus: pending|accepted|rejected`; a todo unblocks dependents only when `done AND accepted`. Today done is **worker self-reported** (vibe-go 4.7 → update_task_status + complete_linked_todos); `computeWaves` readiness is topology-only (no status predicate).

- Agent proposed tiered: mechanical (tsc+tests) / independent VERIFIER agent / human gate.
- **Grok: drop the VERIFIER agent** — "LLM judging LLM on behavioral code is verification theater," doubles calls, noisy. **Keep: mechanical gate (tsc + tests pass) + human gate on critical-path.** Open: no reliable auto way to identify "critical path" (fan-out heuristic is weak).
- Recovery for `rejected`: back to in_progress (fix loop) vs failed+escalate — undefined (todo).

### #2 Claim release / worker failure  ✅ (mostly sound)
Lease: `claimedAt + claimLeaseMs` (default ~15min) on the todo; Coordinator reconcile tick releases expired claims → ready; `tmux has-session` check for hard-crash; retry cap (2) → `blocked` + `createEscalation(kind:blocker)`. No worker heartbeat (Claude sessions can't reliably self-heartbeat on a timer — confirmed: `session-notify` fires on state transitions, not a timer). Reuses the 120s-staleness pattern (today UI-only, `SupervisorPanel.tsx:192`). Open: lease duration per task-size; re-spawn backoff to avoid storms; gap between launch and first status row (use tmux check).

### #3 Material-change / plan staleness  ⚠️ (spam risk)
Add `planVersion` to roadmap item (bump ONLY on dependsOn change / status rollback — not every edit). Worker emits `escalation_create(kind:'assumption-invalidated', questionText=JSON{affectedTodoIds, reason})` on discovered divergence; the single supervisor (only cross-session view) re-validates dependents. Reuses the existing escalation table.

- **Grok: the worker signal will be spammy + single-supervisor re-validation is a bottleneck.** Needs rate/threshold; this is "too little, too late" vs real graph↔code drift (see new gap below).

### #4 Reconciliation pass  ❌→ (weakest; needs the SDK)
Spec'd: `reconcile(base, deltaA, deltaB, constraints)` = deterministic pre-checks (orthogonal subtrees short-circuit, cycle detect) + LLM middle + deterministic post-checks (cycle/ref/constraint via existing `detectCycles`). Test harness: 5 fixtures + eval rubric, LLM mocked. Needs version columns (none exist).

- **Grok ranked this WEAKEST**: "acknowledges no-Claude-path then proposes an LLM pass anyway; deterministic checks are wishful — real merges have semantic conflicts cycle-detection won't catch."
- Resolution: only viable WITH the Anthropic SDK (cross-cutting decision). Keep it gated behind the spike; treat as research-grade. Solo context-switching does NOT need it.

### #5 Classifier trust  ⚠️ (needs the SDK to be coherent)
Structured output `{classification, confidence}`; confidence=low → always escalate; regex pre-filter for `?`; escalation debounce on `(session, text-hash)`; eval fixture set. Today classification is freehand prose in the supervisor skill (read_last_assistant_turn → LLM judges).

- **Grok: making this spawn tmux/Grok destroys the stateless-classifier invariant** → REQUIRES the Anthropic SDK to be an in-process call. With the SDK, structured-output + confidence + debounce + eval is sound.

### #6 Context-watchdog handshake  ✅ (addresses concrete bugs) — PARTIALLY BUILT (2026-05-31)
**Built:** server-side persistence of contextPercent. `session-status-store.ts` gained `contextPercent`+`contextUpdatedAt` columns (nullable, migrated via `addColumnIfMissing` — verified on the live repo DB, zero data loss) + `recordContextPercent()` (upsert that does NOT clobber the activity `status`; seeds `status='active'` only when no row exists). `POST /api/session/context-update` now persists before broadcasting, so the supervisor/watchdog can read context% from durable state via `GET /api/session-status` instead of the browser-transient WS message. 6 store unit tests. tsc clean.
**Correction to the original resolution:** "add the statusline hook to `plugin.json`" is NOT possible — Claude Code plugins do not support a `statusLine` key (confirmed: plugin.json schema has no such field; plugin settings.json only supports `agent`/`subagentStatusLine`). The statusline stays wired via `setup.sh` → `~/.claude/settings.json`. Install-reliability of the statusline is therefore a separate, still-open concern (can't be solved in plugin.json); the durable server-side read path above is the part the watchdog actually needs and is now done.
**Built (2026-05-31, part 2):** the `checkpoint_ready` HARD GATE handshake.
- `session_status` gained `checkpointReadyAt` (migrated); `recordCheckpointReady`/`clearCheckpointReady`/`isCheckpointReady(maxAge=10min)` + `ClaudeStatus += 'checkpoint_ready'` (also allowed in `/api/session-notify`).
- MCP `checkpoint_ready` — a session calls it at the END of its checkpoint with `checkpointTodoId` (vibe-checkpoint's primary path — writes into the in_progress todo) OR `checkpointDocId`. The server **re-verifies the artifact was JUST written** (recency gate, default 120s) before recording readiness — never trusts a self-report. Broadcasts `claude_session_checkpoint_ready`.
- MCP `supervisor_clear_session` — the gate: sends `/clear` (via `sendTmuxKeys`, or peer for remote) ONLY if `isCheckpointReady`; refuses with `checkpoint-not-ready` otherwise; consumes the marker on success; broadcasts `supervisor_session_cleared`. Peer sessions gate via the peer's `/api/session-status` (federation still vaporware per #7).
- Producer wired: `skills/vibe-checkpoint` Step 4 now calls `checkpoint_ready` with the in_progress todo id.
- Tests: 11 store unit tests (incl. gate age/consume/no-reopen) + MCP-wire smoke (`scripts/smoke-coordinator-mcp.ts`, 22/22: refuse→verify(doc+todo)→gate-passes→reject-missing). tsc clean.
**Built (2026-05-31, part 3):** the supervisor control-loop driver.
- `context-watchdog.ts` — pure, deterministic `selectWatchdogActions(rows, now, cfg)`: per session returns `checkpoint` (contextPercent ≥ threshold[80] + fresh reading + safe/idle boundary `status==='waiting'`) or `clear` (recent `checkpointReadyAt`). Time injected → 9 unit tests (unsafe-boundary skip, stale-reading skip, custom threshold, mixed fleet). `DEFAULT_WATCHDOG_CONFIG` = 80% / 5min context-freshness / 10min checkpoint-age.
- MCP `supervisor_watchdog_scan { project, thresholdPercent? }` → `{ actions }`. The supervisor calls it each tick (skill Step 10b): nudge `checkpoint` actions to run `/vibe-checkpoint`, issue `supervisor_clear_session` for `clear` actions.
- **Resume confirmation:** uses the EXISTING `claude_session_registered` broadcast (fired on re-`/collab` register) — skill Step 10b treats it (or the session reappearing active/waiting next reconcile) as resume-confirmed; a cleared session that doesn't re-register within a tick or two → escalate.
- Wired into `skills/supervisor` (Step 2 + new Step 10b, no renumber). MCP-wire smoke 26/26 (scan drives idle-hot→checkpoint, ready→clear, ignores cold). tsc clean; 55 unit tests across the watchdog/status/coordinator suites.
**Built (2026-06-01, part 4):** durable watchdog debounce. New `watchdog_debounce(project,session,action,emittedAt)` table in session-status.db + `tryEmitWatchdogAction(project,session,action,cooldownMs,now)` (emit-and-record; suppresses a repeat within cooldown, default 10min) and `resetWatchdogDebounce`. `supervisor_watchdog_scan` now debounces the repeatable `checkpoint` nudge ONLY (returns `{actions, suppressed}`); `clear` passes through every tick (marker-consumed on success, and a failed clear must retry). `supervisor_clear_session` resets the debounce on a successful clear so the next high-context cycle can re-nudge. Survives a supervisor restart (was in-session memory per skill Step 12). 4 store unit tests + MCP-wire smoke (28/28: 2nd scan suppresses repeat checkpoint, still emits clear).
**Built (2026-06-01, part 5):** per-project watchdog threshold. `watched_project` gained `watchdogThresholdPercent` (nullable, migrated) + `getWatchdogThreshold`/`setWatchdogThreshold`. `supervisor_watchdog_scan` precedence = explicit arg → per-project config → 80% default (returns `thresholdPercent` used). New `set_watchdog_threshold { project, thresholdPercent|null }` MCP tool (validates 1-100). Added `MERMAID_SUPERVISOR_DIR` env override so supervisor.db is isolatable in tests/smoke. 6 store unit tests + MCP-wire smoke (33/33: default ignores a 55% session, threshold→50 makes it a checkpoint candidate, out-of-range rejected).
**Still open:** live end-to-end (real session crossing the threshold → checkpoint → clear → resume), which needs a running app + a plugin release for the new tools/skill. #6 is otherwise complete server-side.

ORIGINAL (for reference):

Add `checkpoint_ready` session-notify status; supervisor sends `/clear` ONLY after receiving it (the persisted handshake); resume confirmed by the new session binding (`register_claude_session` → `claude_session_registered`). **contextPercent is unreliable today**: `statusline.sh` is installed by `setup.sh`, NOT in `plugin.json`, and is browser-transient. Fix: add the hook to `plugin.json` + persist `contextPercent` server-side (in the status store) so the supervisor can read it via HTTP. **Grok: correct, addresses real bugs.**

### #7 Single-writer / federation  ⚠️ (it's vaporware today — own that)
Finding: **cross-machine todo WRITES don't exist** — remote sessions are read-only via `peerFetch`; the peer registry is in-memory, pushed by the browser. Resolution: formalize "writes only happen on the project's local/home server" (assert project-is-local in claim/complete handlers); home-server + failover as a later upgrade (`homeServerId` on watched_project). **Grok: this is a hand-wavy deferral — admit federation is still vaporware rather than calling it architecture.** The WS-via-MCP requirement (below) is "ugly but necessary."

### #8 todo.type assignment  ✅
Infer from the blueprint task's `files: [...]` via a path-rules map at `sync_task_graph` time → `profile`; `full` default when no rule matches; multi-domain → `full`; worker can `escalate` on a tool gap. Store `profile` on the task-graph entry, NOT the generic todo schema. Open: define the actual profile taxonomy + tool sets.

### #9 Decision-records / constraints schema + /focus  ✅
New `decision_record` table in roadmap.db (project-scoped): `{id, project, epicId(null=project-level), kind(decision|constraint|assumption), status(proposed→approved→active→superseded), title, rationale, alternatives, supersededBy, linkedTodos[], authorSession, approvedBy, ...}`. `/focus <epic>` = 3 cheap SQLite queries (epic+project constraints; epic+children; cross-epic via linkedTodos) — **NO embeddings** (none in codebase; O(10s-100s) rows). Decision_record is a separate table, NOT a todo kind. Constraints (kind=constraint) need human approval; decisions auto-approve.

### #10 UI liveness events  ✅ (with a catch)
New WS events: `coordinator_queue_updated`, `supervisor_decision`, `watchdog_event`, `supervised_session_changed`, `peer_registry_changed`, `escalation_resolved`. **Catch:** the tmux supervisor can't push WS directly — events must be emitted via an MCP call (e.g. a `supervisor_heartbeat` tool that accepts structured state and broadcasts). Once the Supervisor is a server process (SDK), this is natural.

## NEW gaps Grok surfaced (were completely unaddressed)
- **Supervisor as single-point-of-failure.** It's now control-plane AND sole cross-session view. No failover, no audit log that survives restart, no emergency human override beyond "escalate." If it loops/OOMs/corrupts, the project dies. → needs a supervisor audit log + override + (eventually) failover. **NEW TODO.**
- **Graph↔code semantic drift.** The unified todo-graph has no continuous validation against reality (imports, module boundaries, call graphs). `assumption-invalidated` is too-little-too-late. → needs a periodic reconcile of plan-graph vs actual code. **NEW TODO.**
- **Observability.** tmux + SQLite + daemon + Electron + federation = debugging hell; no unified trace/replay. → structured logging + a trace/replay for an orchestration run. **NEW TODO.**

## Net
The foundation gets one more keystone: **Phase 0 adds the Anthropic SDK** (server-side LLM-as-function) — without it the Supervisor classifier and reconciliation are incoherent. The execution-completion model simplifies to **mechanical + human gates** (no verifier agent). Federation is honestly "single-machine-write for now." Three new cross-cutting gaps (supervisor SPOF, graph↔code drift, observability) join the backlog.
