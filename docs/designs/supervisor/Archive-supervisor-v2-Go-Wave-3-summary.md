# Wave 3 Implementation (v2)

## Tasks
- **ui-supervisor-rework** — REWORKED `ui/src/stores/supervisorStore.ts` (v2 global state: watchedProjects / roadmapByProject / escalations / locks + load/add/remove/resolve actions; invoke() reused; localStorage cache; dropped SupervisorTarget) and `ui/src/components/layout/SupervisorPanel.tsx` (watched projects → roadmap items with status chip + spawned-session live status + ClaudePixAvatar + lock glyph; Escalations inbox with resolve; kept ClaudePixAvatar/statusBg/props; removed old SupervisorRow + add-target picker). Coupled correctly — verify confirmed action/type agreement, no tsc errors.
- **ui-supervise-toggle** — `ui/src/components/layout/SubscriptionsPanel.tsx`. Added `useSupervisedSessions()` hook (polls GET /api/supervisor/supervised), a shield-SVG supervise toggle on each Watching row (POST/DELETE /api/supervisor/supervised via mc.invokeOnServer + fetch fallback, refresh after). Only pre-existing allowtransparency errors remain.
- **supervisor-skill-v2** — REWROTE `skills/supervisor/SKILL.md`. 13-section v2 skill: single foreground supervisor; self-heal on start; per-project roadmap planning; approval-gated roadmap_spawn_session + user /collab binding; reconcile each turn + 720s ScheduleWakeup; claudeSessionId via /tmp binding files; 2-bucket classify (read_last_assistant_turn) → nudge vs escalate; escalation drain; attended-lock; debounce; never answer/drive/relay.

## Verification
- ui-supervisor-rework: STATUS done — store/panel agree, no tsc errors on either file.
- ui-supervise-toggle: STATUS done — 5 changes present, only pre-existing allowtransparency errors.
- supervisor-skill-v2: markdown, matches spec (frontmatter + 13 sections).

## Wave TSC
clean for Wave 3 files (only pre-existing project-wide errors from the shared working tree / broken prod build remain — not from supervisor v2).
