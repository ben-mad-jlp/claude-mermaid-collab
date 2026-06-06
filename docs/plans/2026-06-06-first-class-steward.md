# Plan: First-class Steward — registered automation role above the Supervisor

> Committable mirror of work-graph epic `ddee669f` (session `supervisor-firstclass`), planned via the `planner` skill from `docs/designs/first-class-steward.md`. Approved by ben 2026-06-06.

## Decisions & constraints
- **Decision `3a122bc2`** (active): Steward = `minimal-flag` — a `role` flag on `supervisor_identity` + escalation routing + server-enforced proof gate; NOT a new daemon/queue. The steward LLM session IS the daemon; escalations ARE the queue.
- **Constraint `020b7ab1`** (active, approved): the entire steward auto-act path is gated behind `MERMAID_STEWARD_AUTO` (default OFF); the human-reserved routing floors (`operatorGated`/`approval`/`decision`/`assumption-invalidated`, and `override_accept` of an in-tree gate failure) live in **server code**, not config — a future `.collab/steward-policy.json` may only make routing *more* conservative; the proof gate is server-enforced (`git`/`tsc`/store, never LLM-asserted).

## Epic `ddee669f` — phases (dependency-ordered)

| Phase | Todo | Type | Depends on | Deliverable |
|-------|------|------|-----------|-------------|
| **P0** `3b9a4253` | Skill-only steward loop | backend | — | Codify the triage→act→resolve→keep-flowing loop on the shipped verbs; **zero schema**. Phase-0 smoke checklist proves it end-to-end. (Mostly already true: skill + verbs exist; we ran the loop manually this session.) |
| **P1** `7c6786c2` | Role + routing | backend | P0 | `supervisor_identity` `role` column (`id=1 CHECK`→`PRIMARY KEY(role)`, additive+backfill); `role` param on the 4 identity fns; `register_steward`; escalation `routedTo`/`operatorGated`/`proof`/`stewardAttempts` + new kinds; `routeOf` in `createEscalation`. **Gated behind `MERMAID_STEWARD_AUTO` (default OFF).** *Top risk — touches the live supervisor registration path.* |
| **P2** `da9d4565` | Server-side proof gate (safety core) | backend | P1 | Under a steward epoch, `reset_todo`/`override_accept_todo` require + server-re-validate a proof string; reject+re-route to human if absent/false. Rate-limit + hallucinated-resolve check + thrash guard. Audit every act. Tighten `skills/steward/SKILL.md`. `reset_todo` auto first, `override_accept` last. |
| **P3** `6fad27a0` | StewardPanel UI | ui | P1 | `StewardPanel.tsx` above `SupervisorPanel` in `Sidebar.tsx`; `GET /api/supervisor/steward-identity`; loud override-count; "steward sent this" provenance in `NeedsYouZone`. |
| **P4** `5661e2de` | Reclaim + liveness polish | backend | P2 | `steward_pause`/`resume`/`pause_status`; fail-open "steward dead, N queued"; `supervisor_watchdog_scan` includes steward; supersede kill-switch; `reset_todo` documented as the override undo. |

**Waves:** P0 → P1 → {P2, P3 parallel} → P4. Epic rolls up to `done` when all five land.

## Provenance
- Design exploration: 5 concepts (supervisor-superset / separate-steward-daemon / policy-router / context-supervised-agent / minimal-flag) → adversarial judge → synthesis. Winner minimal-flag (44/50).
- Full design: `docs/designs/first-class-steward.md`.
