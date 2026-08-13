# Design: turn outlines — the terminating message as an expandable tree

Status: SPEC (decisions settled in conversation, 2026-08-12 evening)
Origin: human idea — "the terminating message of every response is an outline tree,
stored per watched session, so the human reads as deep or as shallow as he wants."

## Problem

Catching up on a watched session means scrolling transcript. Long status messages
(the watcher's own are the worst offenders) bury the one line the human must not
miss under paragraphs they may not need. The human's real question is always
"what do I need to know since I last looked?", at a depth they choose.

## Decisions (settled)

**D1 — Agent-authored; the outline IS the terminating message.** Not a summary pass:
a writing rule in the output style / skill contract. No second model, no lag, no
drift — the tree the UI renders is exactly what the agent said.

**D2 — Reorganization, NOT summarization.** The outline carries the SAME content a
prose terminating message would, in tree geometry: top level = the scannable spine
(≈ the bolded lead-ins of the current style), children = the full sentences and
reasoning, deepest nodes = evidence/details. Depth replaces scrolling. A tree that
drops content fails review.

**D3 — Transport = Stop hook, not channels.** The Stop hook payload carries
`last_assistant_message` SYNCHRONOUSLY (official docs recommend exactly this over
transcript-tailing, which lags on async writes). Channels were evaluated and
rejected for output: they push events INTO a session (external → Claude), are
transient, a research preview, and gated — output via a per-turn reply tool is
non-idiomatic. Pipeline: plugin Stop hook → parse the outline block from the final
message → POST {session, project, turn, outline} to :9002 (new route) → store.

**D4 — Storage: LATEST ONLY, one outline per watched session.** A terminating
message means the session is paused awaiting the human — it cannot produce a second
outline until acted on, so an "unread backlog" cannot exist and nothing is ever
missed. One row per (project, session), overwritten each turn with turn id +
timestamp; the transcript remains the history. (An earlier ring-buffer +
read-cursor-merge design was DELETED by this insight — do not resurrect it.)

**D5 — UI: the latest tree, expandable, with reply-in-place.** The Bridge renders
each watched session's stored outline as an expandable tree. Node semantics from
the live demo:
- `needs-you:` is a FIRST-CLASS node kind — pinned/badged by the renderer, never
  buried (maps to the one-red discipline the Bridge already has).
- `new:` is a node PROPERTY (highlight) marking what changed this turn, not a
  separate branch.

**D6 — The REPLY path is a channel: the round trip closes in the UI.** Channels
push events INTO a session — exactly the reply direction. The Bridge outline tree
gets a reply affordance (freeform text; optionally node-anchored): POST to :9002 →
the collab channel server forwards into that session's context → the session
resumes. This replaces the tmux poke for the human→session direction and makes the
Bridge a remote console: read at your depth, answer in place. Caveats: channels are
a research preview and per-session opt-in (`--channels`); ship the reply path
behind that availability, with the tmux nudge as fallback. The same channel later
carries artifact-inbox arrivals and conductor cards.

**D7 — Zen renders the same store.** `update_zen_summary` today synthesizes an
approximation of "where things stand"; the outline IS that, agent-authored and
exact. Zen shows the top one-two levels of the same stored row (needs-you pinned),
Bridge shows the full depth. One store, two views.

## Format (v1)

A fenced block the agent emits as (the tail of) its final message. Plain-text
readable in the terminal, mechanically parseable:

````text
```outline
▸ Top-level point in one line
  ▸ Full sentence(s) of explanation — the prose that would have been the paragraph.
    ▸ Evidence, ids, file:line — the deepest detail.
  ▸ needs-you: the single action awaiting the human (node kind, not prose)
```
````

Parse rules: two-space indent = child; `▸ ` prefix per node; `needs-you:` /
`new:` prefixes mark node kinds/properties; everything after the prefix is
verbatim text (may wrap). Absent block = no outline recorded for the turn
(surface as "no outline", never synthesize one).

## Feasibility

HIGH, small epic. Existing pieces: plugin hook shipping, session registration,
watched-session store, Bridge tree rendering machinery, WS broadcast. New pieces:
- Output-style/skill rule (the writing contract, D2 wording matters most).
- Stop hook script: extract ```outline block from `last_assistant_message`,
  POST to :9002; silent no-op when absent or server down (never block the turn).
- Route + store: POST/GET /api/turn-outlines (one row per project+session).
- Bridge: outline tree panel per watched session; needs-you pinning; NEW
  highlighting; reply box wired to the channel bridge (tmux-nudge fallback).
- Channel server (reply direction): a small MCP channel the plugin registers;
  :9002 route forwards Bridge replies to it.
- Zen: render top levels of the same row.

## Test spec

- Parser: fixture outlines round-trip to trees; bad indentation degrades to a
  flat list, never throws; needs-you/new prefixes classify correctly.
- Hook: given a Stop payload with an outline block, POSTs exactly one record;
  absent block → no POST; server down → exit 0 (turn never blocked). Mutation
  probe: corrupt the block marker, assert no POST.
- Store: overwrite semantics (second POST replaces the first); per-session
  isolation.
- UI: latest tree renders and expands; a needs-you node renders pinned regardless
  of depth; a reply POSTs to the channel route and falls back to tmux nudge when
  the session has no channel. (Component tests, mocked fetch/WS.)
- Contract test on the OUTPUT STYLE side is judgment, not code: ships as skill
  wording; graded by dogfood.
