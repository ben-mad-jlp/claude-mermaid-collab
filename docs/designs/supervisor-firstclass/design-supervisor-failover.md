# Supervisor Failover — design pass (spike `f68b3230`)

Resolves the failover/standby spike. **Conclusion: don't build a hot standby — the always-on server is already the failover authority. The one real gap is split-brain fencing, which is a small, mechanical, releasable change.**

*(Grok consult attempted for a second opinion but its API errored out; the skeptical pass below is done in-house. Worth a retry when the key/model is fixed.)*

## What already exists (so we don't rebuild it)

`src/services/supervisor-liveness.ts` — the **always-on root server** runs a liveness loop (~30s):
- reads the supervisor heartbeat (`supervisor_identity.updatedAt`),
- if **absent** → spawn a headless watchdog supervisor; if **stale** (>`SUPERVISOR_STALE_AFTER_MS` = 60s) → respawn,
- post-spawn **grace window** (180s) prevents double-spawn,
- the spawned lane is **watchdog-only** (reconcile + escalate, never plan).

So **detection + respawn already work.** All durable state is in SQLite (escalations, audit, decisions, work-graph), so a respawned watchdog **re-derives** its world on boot — there is **no state to transfer**.

## The three spike questions, answered

1. **Who detects the active supervisor is dead?** — *Already solved.* The server's liveness loop, via heartbeat staleness. Keep it.
2. **How does a replacement claim the role without split-brain?** — *The gap.* `register_supervisor` does `INSERT OR REPLACE id=1`, so the identity row always names the **latest** registrant — but nothing stops a previously-**hung-not-dead** supervisor from resuming and still acting after a replacement was spawned. Two supervisors nudging/clearing/escalating = split-brain.
3. **What state must transfer?** — *None.* Durable state is in SQLite; in-memory state is the server-owned liveness loop's, which never died. Respawn = re-derive.

## The fix: a server-enforced ownership fence (epoch)

The fence must be **server-enforced**, not client-honored — a hung/buggy supervisor cannot be trusted to police itself (this is the single-writer invariant `b9c4c5d` applied to the supervisor role).

1. **Epoch column.** Add a monotonic `epoch` to `supervisor_identity`. `register_supervisor` increments it and records `(session, epoch)` as the sole owner. *(A counter, not a timestamp — immune to clock skew.)*
2. **Gate every supervisor action server-side.** The MCP handlers for the mutating supervisor tools (`supervisor_nudge`, `supervisor_clear_session`, `escalation_create`/resolve, `supervisor_reconcile` writes, and the heartbeat) check: **is the caller the current identity owner?** If a newer epoch exists (someone took over), reject with a clear `superseded` error and do nothing.
3. **Supervisor self-exits on `superseded`.** On that error the watchdog stops its loop + heartbeat. (Politeness layer — the server-side reject is the real fence.)
4. **Detection unchanged.** Heartbeat staleness still drives respawn; the epoch just makes respawn *safe*.

Net: respawn → `register` (new epoch) → the old supervisor's very next action is rejected. At most one already-in-flight action from the old one can slip through the check→write window; for this tool that's low-harm (nudges are idempotent-ish; `/clear` is independently gated by `checkpoint_ready`).

## Skeptical pass (failure modes & why they're acceptable here)

- **Action in-flight when superseded** — check epoch immediately before each mutating call; residual one-action window is low-harm (idempotent nudges; clear is checkpoint-gated). *Not worth transactional fencing.*
- **Server itself dies** — then there is no MCP/API at all → total outage, not split-brain. The supervisor can't act without the server anyway. Out of scope for this fix; if we want server resilience that's an **OS-level keepalive** (launchd), not app code. *(Note it, don't build it here.)*
- **Clock skew** — irrelevant to the fence (epoch is a counter). Only detection uses timestamps, which is fine.
- **Epoch vs lease/TTL** — we need **both kinds** but already have one each: heartbeat-staleness (TTL) = *detection*; epoch (counter) = *fencing*. No separate lease, no consensus/quorum — it's one SQLite file on one machine.

## Why NOT a hot standby

A second always-running supervisor instance buys nothing here: the server already respawns within ~one stale window, respawn is cheap, and there's no state to keep warm. A standby would add a second thing that can split-brain — the opposite of the goal. **Rejected as over-engineering for a local-first single-machine tool.**

## Releasable implementation todo (acceptance-gated)

This design turns the spike into a mechanical change with a real gate. New todo:

**Title:** `[COORD-FIX] Supervisor ownership fence (epoch) — server-enforced, prevents split-brain on respawn`

**Scope:** (1) add `epoch` to `supervisor_identity` + `setSupervisorIdentity` increments it and returns it; (2) a server-side `assertSupervisorOwner(session)` (or epoch) guard in the mutating supervisor tool handlers that rejects a superseded caller with a `superseded` error; (3) supervisor skill self-exits its loop on `superseded`.

**Acceptance (the split-brain test):**
- Unit: given current epoch = 2, an action from epoch = 1 is **rejected**; from epoch = 2 is **allowed**.
- Integration: register A (epoch 1) → register B (epoch 2) → A's `supervisor_nudge`/`clear`/`escalation_create` are **no-ops** returning `superseded`; B's succeed. Heartbeat from A is also rejected (so A can't resurrect its ownership).

**Out of scope (noted, not built):** hot standby; server-process keepalive (OS/launchd); cross-machine HA.
