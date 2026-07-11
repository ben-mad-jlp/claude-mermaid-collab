# Wireframe — PlannerView (planning conversation)

Where the Plan section's **💬 / `/focus`** lands. The Planner is a per-project Claude Code session running in tmux — **you talk to it in the terminal, like every other session.** PlannerView does NOT replace the terminal with a chat UI; it **arranges the planner's real terminal next to a structured side panel** (the plan/proposals/constraints/decisions it produces). This is the two-memories split made visible: left = the terminal conversation (the "why", narrative = primary memory), right = the "what/status" (graph) + the cross-thread glue (constraints). A Planner node in the System Map is a **session** → clicking it opens this same terminal.

## Layout (main area)

```
┌ Planner — myproj ───────────────────────────── ◐ 41% · ⟳ summarize · ⛶ full ┐
│ Threads:  [● Auth]   Onboarding•   Perf   + discuss            focus: Auth   │  epics = threads; • unread; tab → sends /focus to the terminal
├────────────────────────────────────────────┬──────────────────────────────┤
│  TERMINAL — planner session (tmux)           │  THIS EPIC — Auth refactor    │
│                                              │                               │
│  🧑 drop the legacy token path?              │  PLAN (this epic)             │
│  🤖 I'd keep it behind a flag till cutover.  │   ● token-store        done   │
│     Proposing 2 todos + a constraint.        │   ◐ login-form    fe · ⟳      │
│  🧑 do it                                    │   ◷ oauth-callback  ready     │
│  🤖 added. ⚑ proposed — review on the right. │   ⊘ refresh-rotation ⊘login   │
│  ...                                         │  ── PROPOSED Δ (await approval)│
│                                              │   + todo "oauth-callback"     │
│                                              │   ~ dep refresh → login-form  │
│                                              │   + constraint (below)        │
│                                              │     [ ✓ approve all ] [review]│
│                                              │ ──────────────────────────────│
│                                              │  ACTIVE CONSTRAINTS (4) 📌    │  project-level, shared across threads
│                                              │   • keep flag X until cutover │
│                                              │   • no breaking API in v5     │
│                                              │  DECISIONS (this epic)        │
│                                              │   ✓ keep legacy behind flag   │
│                                              │   ✓ JWT rejected — see note   │
│ [ talk to the planner…                    ]  │                               │
└──────────────────────────────────────────────┴──────────────────────────────┘
```

## Threads (epics) + `/focus`
- **Each top-level todo (epic) = a thread.** The thread tabs switch the conversation's active topic; selecting one issues `/focus <epic>` → the planner pulls that epic's subgraph + recent decisions + the active constraints into context. `•` = unread planner output in that thread.
- **+ discuss** starts a new thread; once it yields a top-level item, that becomes a new epic.
- It's ONE resident planner session, topic-scoped per thread (per the concurrency design) — not N separate chats. The shared **constraints** panel is what keeps threads from diverging (the explicit cross-epic visibility mechanism).

## Terminal pane (the conversation — primary memory)
- This is the planner session's **real tmux terminal** (reuse the existing terminal pane + `terminalStore`) — you talk to the planner here exactly as you do any session today. We are NOT replacing the terminal with a chat UI.
- The "why" lives here (reasoning, rejected options, open questions). It is the primary memory; the graph/constraints on the right are derived from it.
- **`/focus <epic>`** is a real slash command the planner skill handles; the thread tabs are a convenience that **send `/focus <epic>` into the terminal** and track unread — they never move the conversation out of the terminal.
- **⛶ full** expands the terminal to full width (hide the side panel) for heads-down conversation.

## Plan deltas → proposals → approval (the gate)
- As the conversation produces plan changes (new/changed todos, deps, constraints), they appear in the right panel as **PROPOSED Δ** (status `planned`), surfaced via the existing **`proposalStore`** (accept/reject).
- **Approve** flips `planned → ready`; the Coordinator then claims and executes. This is the **plan-level approval gate** (decision 3) — the same gate as the Plan section's ⚑ banner, just in context here. Nothing executes until approved.
- Approving in-context (right rail) or via `[review]` for a batch.

## Constraints + decisions (the two-memory split, visualized)
- **ACTIVE CONSTRAINTS** = project-level, **shared across all threads**. Every planner pass reads + proposes updates to them — this is the mechanism that surfaces cross-epic implications (change auth → constraint updates → visible in the onboarding thread). Editable/inspectable here.
- **DECISIONS** = per-epic record of what was decided + why (narrative-derived). A decision can be **promoted to a constraint** when it's project-wide.
- These two are the durable, structured residue of the narrative — and the **resume anchor** after a clear.

## Summarization / context-watchdog (lossless clear, visible)
- Header shows `◐ <ctx%> · ⟳ summarize`. At the threshold (or the 80% watchdog), the planner **summarizes the narrative → updates constraints + epic summaries → /clear → resume**.
- The conversation shows a marker — `— context refreshed; constraints + summaries preserved —` — so a `/clear` reads as a checkpoint, not a crash. Because constraints/decisions/summaries persisted, the thread continues seamlessly. (This is exactly why the right-panel state must be complete: it IS the resume.)

## Reconciliation (true-parallel editing — future)
- If two threads (or two people) make conflicting changes, a **reconcile banner** appears ("Auth & Onboarding both touched Y — reconcile") → runs the reconciliation pass (the spike that gates this UI). Deferred for solo context-switching; shown here for completeness.

## States
- **New / no plan** → empty conversation: "Let's plan myproj — what are we building?"; planner proposes initial epics.
- **Resumed after clear** → "resumed from checkpoint" with constraints + epic summaries loaded.
- **Planner offline** → "Planner not running — [resume]"; the plan stays readable (durable todos); conversation shows history read-only.
- **Awaiting approval** → ⚑ on the proposed Δ + the thread tab.

## Reuse map
| Element | Reuse | New |
|---------|-------|-----|
| Conversation | the existing **terminal pane + `terminalStore`** (the planner's real tmux) | thread tabs send `/focus` into it; ⛶ full toggle |
| Plan deltas | **`proposalStore`** (accept/reject) | map planner output → proposals |
| Plan list / status | the project todo store + status glyphs (shared w/ Plan section) | — |
| Approve | flips `planned`→`ready` (shared w/ Plan ⚑) | — |
| Planner asks human | **`questionStore`** | route to inline / escalation |
| Raw terminal | `onJump` / terminal store | ⌨ affordance |
| Host shell | mounts in main area (peer to `SupervisorView`) | thread tabs + constraints/decisions panels |

## Open
- ~~Chat surface vs terminal~~ → **RESOLVED: the terminal IS the conversation** (reuse the terminal pane). PlannerView = terminal + structured side panel; no separate chat UI.
- Side panel placement: right rail (as drawn) vs a bottom strip under the terminal — depends on terminal aspect ratio. (Lean: right rail on wide, collapsible.)
- Constraints editing — human-editable directly, or only via asking the planner? (Lean: inspect + pin/unpin by human; content changes go through the planner so it stays in the loop.)
- Decision→constraint promotion: manual, or planner-proposed? (Lean: planner-proposed, human-approved.)
- How `/focus` retrieval picks "relevant subgraph + recent decisions" — embedding lookup vs parentId+recency. (Ties to the reconciliation spike.)
