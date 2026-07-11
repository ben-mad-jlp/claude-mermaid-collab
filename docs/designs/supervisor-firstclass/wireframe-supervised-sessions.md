# Wireframe — Supervised Sessions Region

> Today the whole sidebar `SupervisorPanel` body IS the supervised list, reusing `SessionCard` (the Watching card) + a 🔒 lock, ⚠ escalation indicator, and shield-toggle = "stop supervising". In the dedicated home view this becomes **one region** (right column, below the roadmap) — richer than a reused card, but still consistent with Watching.

## Backend facts (grounding)

- Supervised set: `GET /api/supervisor/supervised` → `{ project, session, source?, addedAt?, serverId? }[]`. Mutate via `POST`/`DELETE /api/supervisor/supervised`.
- Live data (status, ctx%, elapsed) is **merged from the Watching feed** (`subscriptionStore`) by matching project+session; falls back to polled `/api/session-status` (stale >120s → `unknown`).
- `source` distinguishes how a session became supervised (`manual` vs auto/roadmap-spawn).

## The region (right column, below roadmap)

```
┌─ SUPERVISED SESSIONS ───────────── 4 ──────────── [+ supervise…] [⊞ grid │ ☰ list] ┐
│  ─ claude-mermaid-collab ─────────────────────────────────────────────────────────│
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ ◐ bugfixes        🔒        82% ctx · 4m       [nudge] [open ▸] [⛔ stop]    │  │
│  │   ⚠ 1 escalation · roadmap: "REST surface"                                  │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ ● worker-live                 31% ctx · live    [nudge] [open ▸] [⛔ stop]   │  │
│  │   roadmap: "Backend store" (done)                                           │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│  ─ other-project ──────────────────────────────────────────────────────────────  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ ○ launch-smoke    idle (unknown)             [nudge] [open ▸] [⛔ stop]      │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                   │
│  Empty: "Not supervising any sessions. [+ supervise a session] or spawn from roadmap."│
└───────────────────────────────────────────────────────────────────────────────────┘
```

## What's richer than today's reused card

| Element | Today | Home-view region |
|---------|-------|------------------|
| Status / ctx% / elapsed | ✓ (SessionCard) | ✓ keep |
| 🔒 lock | ✓ | ✓ keep |
| ⚠ escalation | dot only | inline "⚠ N escalation" linking to inbox |
| **Roadmap link** | ✗ | show the roadmap item this session is spawned for (`sessionName` join) + its status |
| **Nudge** | ✗ (only via skill `supervisor_nudge`) | per-row [nudge] button → `supervisor_nudge` |
| Stop supervising | shield-toggle | explicit [⛔ stop] |
| `source` | hidden | subtle tag (manual / auto) — feeds #4 trust |

## Interactions

| Action | Behavior |
|--------|----------|
| Row click / [open ▸] | Same side-effects as today (select session, open terminal, focus browser). |
| [nudge] | Call `supervisor_nudge` for that session (today only available inside the supervisor skill loop — surface it in UI). |
| [⛔ stop] | `DELETE /api/supervisor/supervised` (today's shield-toggle behavior). |
| [+ supervise…] | Picker of known sessions in watched projects → `POST`. |
| ⚠ escalation link | Scroll/focus the matching card in the escalation inbox. |

## New work this implies (later)

- Surface `supervisor_nudge` as a REST/UI action (currently skill-only MCP tool).
- Join supervised rows ↔ roadmap items by `sessionName` (display roadmap context on the card).
- Show `source` (needs it returned by the supervised endpoint — it is, optional).

## Open questions (carried)

1. Should [nudge] be one-click, or open a small "what to nudge about" composer?
2. Grid vs list default — does the home view want dense list (more rows) given roadmap is above it?
3. Cross-server supervised rows: today navigation is suppressed across servers — keep, or allow read-only open?

---
*Status: region proposed — keeps Watching consistency, adds roadmap link + inline nudge + explicit stop + source tag.*
