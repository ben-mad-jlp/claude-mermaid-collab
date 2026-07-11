# Wireframe — Escalation Inbox / Notifications (#3)

> The #3 gap: escalations are server-backed (`escalation` table, `createEscalation`/`listOpenEscalations`/`resolveEscalation`) but only surface as **skill turn text** + a conditional footer in the sidebar panel that disappears when count = 0. No notification, no unread state, no history. This wireframe promotes them to a first-class **inbox** with a **notification** path.

## Backend facts (grounding)

- Row: `{ id, project, session, kind, questionText, status, createdAt, resolvedAt, serverId }`.
- **Dedup:** a new escalation with the same `(project, session, questionText)` that's still `open` returns the existing row — no duplicates.
- `status`: starts `open`; `resolveEscalation(id, status)` sets any string (`resolved`, `dismissed`, `answered`).
- `kind`: free string today — wireframe assumes a small set (`question`, `decision`, `blocker`, `approval`). **Decision needed: enumerate kinds.**
- **No notification mechanism exists** — only DB insert. Adding one is net-new.

## Inbox region (left column of the home shell)

```
┌─ ⚠ ESCALATIONS ─────────────── 2 open ─┐
│  [ All ▾ ]            [ Open ✓ Resolved ]│  ← kind filter + status toggle
│ ┌─────────────────────────────────────┐ │
│ │ ❓ question        collab / bugfixes  │ │  ← kind icon + source
│ │ "Drop the legacy render path or keep │ │
│ │  it behind a flag?"                   │ │  ← questionText (wraps, mono)
│ │ 6m ago                                │ │  ← relative createdAt
│ │ [↳ Jump to session]  [✓ Resolve ▾]    │ │  ← primary + split (resolved/dismissed)
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ 🔀 decision     collab / worker-live  │ │
│ │ "Run migrations before or after the   │ │
│ │  cutover?"                            │ │
│ │ 18m ago                               │ │
│ │ [↳ Jump to session]  [✓ Resolve ▾]    │ │
│ └─────────────────────────────────────┘ │
└──────────────────────────────────────────┘

Empty state:  "✓ No open escalations — all clear."
```

## Notification path (the actual "jump")

Three layers, escalating in intrusiveness — pick per decision below:

1. **Badge (always):** count on the left-rail shield icon + the sidebar `SupervisorPanel` header + the inbox tab. Already half-there (panel shows count); extend to the rail.
2. **Toast (in-app):** when a new `open` escalation arrives (WS push), a transient toast "⚠ New escalation — bugfixes" with a Jump action. Requires a WS event on `createEscalation` (net-new — server currently just inserts).
3. **OS notification (opt-in):** desktop/native push when the app is backgrounded. Use the existing `PushNotification` path if present; gate behind a setting.

## Interactions

| Control | Behavior |
|---------|----------|
| **Jump to session** | Same as today's panel: select session + fire `activateSessionCard` side-effects (open terminal, focus browser tab). |
| **Resolve ▾** | Split button: default `resolve`; menu adds `dismiss` (not actioned) — both call `resolveEscalation(id, status)`, differ only in recorded status for history. |
| **Kind filter** | Filter by `kind`. Needs enumerated kinds. |
| **Open / Resolved toggle** | Resolved view reads history — **needs a `listEscalations(status?)`**; today only `listOpenEscalations()` exists. Net-new query. |

## New work this implies (for later planning, not now)

- WS broadcast on `createEscalation` (drives toast + live badge without 10s poll).
- `listEscalations` w/ status filter + a history endpoint (for the Resolved tab).
- Enumerate `kind` values (shared const used by skill + UI icons).
- Optional: `PushNotification` integration + a setting.

## Open questions (carried)

1. Enumerate escalation `kind`s — what's the canonical set? (affects skill `escalation_create` too)
2. Is a Resolved/history tab worth it now, or open-only for v1?
3. Toast vs OS notification — both, or just in-app to start?

---
*Status: inbox + notification layers proposed. Backend deltas listed for the eventual build plan.*
