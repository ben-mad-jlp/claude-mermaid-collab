# Vibe: ui-1

## Goal
Make the collab UI's status surfaces coherent — the left column (session switcher / cards) and the Bridge (fleet graph, escalation zones/badges) must show identical escalation + worker-liveness state at any instant. Kill the "active on the card but stale in the Bridge" class of desync. Epic `d5b1ff4e`.

## Context
- **`audit-ui-status-surfaces`** — read-only audit mapping every status surface → store/selector/load-trigger/scope, producing the desync matrix D1–D10 collapsed to root causes R1–R4.
- **`design-ui-status-coherence`** — the design (done): one source per fact (liveness = subscriptionStore; escalations = supervisorStore split into open/resolved slices), ONE refresh path (`useStatusSync`: WS ingest over the 5 existing events + a single bootstrap hydrate, with an epoch+merge race guard), shared scoped selectors (`statusSelectors`) consumed identically by both surfaces. Canonical scope = aggregated-watched. Right-sized via a Grok skeptical review (converge on existing stores + shared selectors, not a new megastore).
- **Constraint `b2fe36b1`** — no NEW WS events, no polling.
- **Impl graph (planned, awaiting planner promotion to `ready`):** L1 store split+race-guard ∥ L2 selectors → L3 sync hook · L4 Bridge-liveness re-point · L5 surface migration → L6 reviewer → L7 [LAND] (human).

Worktree: `.collab/agent-sessions/worktrees/ui-1`. Branch `collab/ui-1-*`.

## Pair Mode
Disabled

## Agent Mode
Enabled
