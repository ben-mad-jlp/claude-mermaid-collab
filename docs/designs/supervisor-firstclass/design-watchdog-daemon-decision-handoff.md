# Watchdog daemon ↔ supervisor LLM — decision handoff protocol

Realizes decision `eb3c3e60`: the mechanical watchdog runs as a deterministic **daemon**; an on-demand **supervisor LLM session** makes only the irreducible judgment (chiefly *escalate-this-stop-to-a-human-or-not*). This doc specifies the **handoff** between them.

## Principle the protocol must honor

- The **daemon never makes the judgment.** It detects, enqueues a decision request, and acts on the returned verdict — nothing more.
- The **LLM only judges a bounded input** (a captured snapshot) and returns a **structured verdict**. No loop, no side effects.
- Everything durable + auditable in SQLite → survives restarts, unit-testable, no in-memory judgment state.
- **Fail-safe toward the human:** if a request can't be resolved (no supervisor available, timeout), the daemon's default is **escalate**, never silently drop.

## Today vs target

- **Today:** an auto-spawned LLM supervisor *runs the whole loop* (`supervisor_watchdog_scan` → nudge/clear/`escalation_create`). Mechanical work + judgment are tangled in one LLM session.
- **Target:** a server **watchdog daemon** runs the loop (it already has the pure pieces — `selectWatchdogActions`, `detectPermissionPrompt`, the `idleTracker`). When it hits an **ambiguous stop** it can't classify deterministically, it hands one bounded decision to the LLM and acts on the verdict.

## Data model — a durable decision queue

New table (global supervisor.db, alongside identity/audit):

`supervisor_decisions`
- `id`, `project`, `workerSession`
- `signal` — e.g. `idle-at-prompt`, `stopped-unexpectedly`
- `snapshot` — the captured tmux pane / worker state the LLM needs to judge
- `sigHash` — dedupe key (workerSession + signal signature), so the same stuck stop is enqueued **once**
- `status` — `pending` | `resolved` | `consumed`
- `verdict` — `escalate` | `nudge` | `resume` | `wait` (null until resolved)
- `verdictReason` — the LLM's one-line rationale (audit)
- `resolvedBy` — supervisor session + **epoch** (ties to the `2dd13c65` fence)
- `createdAt`, `resolvedAt`

## Flow

**Daemon (deterministic, every tick):**
1. Sweep workers. Clear-cut cases handled directly by the pure heuristics (e.g. a recognized permission prompt → escalate immediately; idle-with-open-todo → nudge).
2. **Ambiguous stop** (idle but not a recognized prompt, or an unexpected stop) → `enqueueDecision({workerSession, signal, snapshot, sigHash})`. Dedupe on `sigHash` (reuse the `idleTracker` signature) so it's enqueued once.
3. Ensure a supervisor LLM session exists **while the queue is non-empty** (reuse the `supervisor-liveness` ensure path — on-demand, not always-on).
4. For each `resolved` request, **act deterministically**: `escalate` → `escalation_create`; `nudge`/`resume` → `supervisor_nudge`; `wait` → leave it. Mark `consumed`.
5. **Timeout:** a `pending` request older than T with no verdict → default **escalate** (fail-safe), mark consumed.

**Supervisor LLM session (judgment only, on-demand):**
- `supervisor_next_decision { project }` → oldest `pending` request + its `snapshot` (returns null when empty — the session can then idle/exit).
- The session reasons over the snapshot: is this a real decision point a human must see, or benign idle?
- `supervisor_resolve_decision { id, verdict, reason }` → writes the verdict. **Epoch-gated** (`2dd13c65`): a superseded supervisor's resolve is rejected.

The LLM's entire job shrinks to: read one snapshot → return one verdict. That's the irreducible judgment, isolated.

## Why this is the right shape

- The **daemon is fully unit-testable** with a fake verdict — no LLM in the test.
- The **LLM call is bounded and stateless** — one snapshot in, one verdict out; no context accumulation across the loop (the loop state lives in the daemon + SQLite).
- **On-demand** invocation honors "minimize LLM hits": the session is only needed when the queue is non-empty.
- **Fail-safe default = escalate** means a missing/dead supervisor degrades to "surface to the human," never to "silently ignore a stuck worker."
- Composes with the **epoch fence** (`2dd13c65`) and the **self-watchdog** (`183d784`) — both still protect the on-demand LLM session.

## Open sub-questions (decide during build)

- **On-demand spawn vs warm poll:** spawn a session when the queue fills (cold-start latency, fewer resources) vs keep one warm that polls. Lean spawn-on-demand; revisit if latency hurts.
- **Timeout T:** long enough for a cold supervisor to come up and decide; escalation is human-facing so minutes are fine. Start ~5 min.
- **Snapshot size:** cap the captured pane (last N lines) so the decision input stays bounded.

## Releasable implementation todo

Captured as a `ready` backend todo (see work-graph). Acceptance is the handoff contract:
- Daemon **enqueues** an ambiguous stop (and **does not** enqueue a clear-cut case it auto-handles); **dedupes** repeat enqueues by `sigHash`.
- On `verdict=escalate` daemon calls `escalation_create`; on `nudge` it nudges; marks `consumed`.
- **Timeout** with no verdict → default **escalate** (fail-safe).
- `supervisor_resolve_decision` is **epoch-gated** — a superseded supervisor's resolve is rejected.
