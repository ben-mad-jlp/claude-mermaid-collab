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
a research preview and per-session opt-in (`--channels`); when a session has no
channel, the Bridge reply affordance is DISABLED for it (no fallback — the tmux
nudge has been REMOVED from the system and is not an option). The same channel
later carries artifact-inbox arrivals and conductor cards.

**D8 — Scope: WATCHED (interactive) SESSIONS ONLY.** Daemon-driven sessions
(conductor, leaf builders) are handled in the daemon and already have their own
surfaces (mission_diagnostic, Bridge cards, the work-graph); they never emit or
store outlines. This makes D4's latest-only rationale airtight: every in-scope
session pauses awaiting the human by definition.

**D7 — Zen renders the same store, FULL tree, expandable.** `update_zen_summary`
today synthesizes an approximation of "where things stand"; the outline IS that,
agent-authored and exact. Zen shows the complete tree (collapsed to the top level
by default, needs-you pinned) and lets the human expand to any depth — same data
and same interaction as the Bridge, differing only in chrome. One store, two full
views.

## Format (v1)

A fenced block the agent emits as (the tail of) its final message. Plain-text
readable in the terminal, mechanically parseable:

````text
```outline v1
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
  highlighting; reply box wired to the channel bridge (disabled when the
  session has no channel — no other delivery path exists).
- Channel server (reply direction): a small MCP channel the plugin registers;
  :9002 route forwards Bridge replies to it.
- Zen: render the full tree of the same row, collapsed by default, expandable.


## Blind spots (watcher + grok adversarial pass, 2026-08-12)

Decisions still OWED before build:
- **B2 needs-you unification:** escalation cards auto-reap; outline nodes persist to
  the next turn. Rule: a needs-you node REFERENCES an escalation id when one exists,
  and the renderer greys it once that card resolves. Never duplicated state.

Security constraints (grok's pass; several are real):
- **S1 Outlines exfiltrate context by construction** — full-content trees carry
  whatever the turn discussed (keys, tool output). v1: size cap with explicit
  truncation markers; a redaction pass is OUT of scope but the store is loopback-
  local and zen must NOT sync rows off-box.
- **S2 The reply route is privileged input injection** — an unauthenticated local
  POST that puts words INTO a session. The route enforces the server's bearer auth
  semantics (no loopback exemption for THIS route), tags replies with provenance
  (`[bridge-reply user@host]`), and the UI shows sent-state per outline.
- **S3 Session-key spoofing** — nothing binds the Stop-hook POST to the session it
  claims. v1 mitigation: the hook includes the session's registered claudeSessionId
  and the route drops rows for unregistered (project, session) pairs; full binding
  is future work.
- **S4 Render inert** — node text renders as plain text only (no markdown, links,
  or actionable markup); needs-you pinning elevates VISIBILITY only, never actions.
  The agent controls this surface; the UI must not let it phrase buttons.
- **S5 Tree validation** — parser enforces max depth (12) and max nodes (500);
  over-limit input degrades to flat truncated list, never crashes the renderer.
- **S6 Durability** — the store survives server restart (file/db-backed like every
  other collab store, not in-memory).
- Discounted from grok's list: cryptographic tree-to-transcript binding and hash
  chains — over-engineered for a loopback trust domain; the turn id + timestamp
  shown in the UI lets a human spot-check against the transcript.

Also: stale-outline marking (an outline older than the session's last activity
renders greyed with its age), and format carries a version (```outline v1).

## Test spec

- Parser: fixture outlines round-trip to trees; bad indentation degrades to a
  flat list, never throws; needs-you/new prefixes classify correctly.
- Hook: given a Stop payload with an outline block, POSTs exactly one record;
  absent block → no POST; server down → exit 0 (turn never blocked). Mutation
  probe: corrupt the block marker, assert no POST.
- Store: overwrite semantics (second POST replaces the first); per-session
  isolation.
- UI: latest tree renders and expands; a needs-you node renders pinned regardless
  of depth; a reply POSTs to the channel route, and the reply box renders disabled
  with an explanatory tooltip when the session has no channel. (Component tests,
  mocked fetch/WS.)
- Contract test on the OUTPUT STYLE side is judgment, not code: ships as skill
  wording; graded by dogfood.
