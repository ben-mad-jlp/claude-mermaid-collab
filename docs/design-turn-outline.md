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

**D4 — Storage: per watched session, ring buffer.** Watched-session infrastructure
exists; outlines append per turn with turn id + timestamp. Retention: last N turns
(default ~50) per session; no history migration concerns — it's a cache of the
transcript, which remains the source of truth.

**D5 — UI: merged-unread tree with a read cursor.** Each outline is a turn-delta.
The Bridge (per watched session) tracks the human's read cursor; on arrival it
renders the MERGE of unread outlines as one expandable tree — top level always
answers "since you last looked". Two node semantics learned from the live demo:
- `Needs you:` is a FIRST-CLASS node kind — pinned/badged by the renderer, never
  buried (maps to the one-red discipline the Bridge already has).
- "NEW since read" is a node PROPERTY (highlight), not a separate branch.

**D6 — Channels stay on the roadmap for the REVERSE direction.** Pushing
artifact-inbox arrivals / conductor cards INTO a receiving session's context is
strictly better than the tmux nudge — revisit when channels leave research preview.

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
- Route + store: POST/GET /api/turn-outlines (per project+session, ring).
- Bridge: outline tree panel per watched session; read cursor persisted; merge
  of unread outlines; needs-you pinning; NEW highlighting.

## Test spec

- Parser: fixture outlines round-trip to trees; bad indentation degrades to a
  flat list, never throws; needs-you/new prefixes classify correctly.
- Hook: given a Stop payload with an outline block, POSTs exactly one record;
  absent block → no POST; server down → exit 0 (turn never blocked). Mutation
  probe: corrupt the block marker, assert no POST.
- Store: ring truncation at N; per-session isolation.
- UI: three unread outlines merge into one tree; advancing the cursor collapses
  them to read; a needs-you node renders pinned regardless of depth; badge counts
  unread outlines. (Component tests, mocked fetch/WS.)
- Contract test on the OUTPUT STYLE side is judgment, not code: ships as skill
  wording; graded by dogfood.
