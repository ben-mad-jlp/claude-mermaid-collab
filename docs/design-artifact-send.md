# Design: send_artifact — cross-session / cross-user artifact handoff

Status: SPEC (feasibility-graded, not scheduled)
Date: 2026-08-12
Origin: human request — "send an artifact to another user's collab session", including
multiple users on one machine.

## Problem

Artifacts (documents, diagrams, designs, spreadsheets, snippets, images) are files under
`<project>/.collab/sessions/<session>/<type>/` (session-registry.ts:337-343, resolvePath
:655-668). They are reachable only by someone with that project open on that server.
There is no way to hand one to another person — another project, another session, another
OS user on the same machine, or another machine — short of exporting a file and sending
it out of band. `.collab` artifact dirs do not travel through git.

## Grounding (what the sweep established)

1. **Storage**: per-type file formats (`.md`, `.mmd`, `.design.json`, `.spreadsheet.json`,
   `.snippet`, image binary + `<id>.meta.json`). IDs are name-derived slugs, stable only
   within one session dir — there is NO global artifact identity. History lives in
   `.history/` files and the per-session `update-log.json`; neither has an import path.
2. **Round-trip**: content is lossless through `get_* → create_*` for every type
   (spreadsheet via `get_spreadsheet` JSON, NOT the CSV export; image via path/data-URI on
   `create_image`). Lost on re-create: the id (recomputed from name), version history, and
   `metadata.json` entries (replayable via `set_artifact_metadata`).
3. **Transport**: HTTP + bearer token per server (auth.ts). The desktop's connection store
   holds peer tokens (encrypted, desktop-side only); server→server `peerFetch` is
   deliberately tokenless and 401s on secured peers. `POST /api/artifact/register`/`notify`
   already exist as a raw file-import hook.
4. **Identity**: there is NO user/actor identity anywhere. The only addresses that exist:
   `serverId` (desktop-local), `baseUrl`, `project` (absolute path), `session` (name).
5. **Cross-instance precedent**: none — nothing moves data between instances today.
   `instance_topology`/`cartographer_sync`/`create_instance` are false friends (read-only
   diagnostics / design-scene instances).

## Design decisions (settled in discussion)

**D1 — The unit of addressing is a SERVER, not a user.** No identity layer exists and
inventing one is out of scope. "Another user" = another server (their instance on this
machine or another) or another project on a shared server. If a user-identity layer ever
lands, it slots in front of this as an address book that resolves to a server.

**D2 — Two-phase: inbox then adopt.** The receiver's server holds a machine-level
**artifact inbox** that is a MAILBOX, not an artifact store: it contains sealed envelopes
that no artifact surface (stores, history, rendering, update-log) ever reads. This is what
keeps an "agnostic" inbox from breaking the everything-is-project-scoped model — the
envelope only becomes an artifact when adopted.

**D3 — Adopt targets an EXISTING project + session, chosen at adopt time.** The receiver
has the context to choose; the sender never has to know the receiver's layout. Adoption
runs through the existing `create_*` verbs (the proven import path), so every store
invariant, sanitizer, and size cap applies. Mirrors `adopt_branch_as_epic`: park outside
the model, adopt through the gated door.

**D4 — v1 does not carry history.** `.history`/`update-log.json` have no import path, and
building one is a separate, riskier project (replaying another machine's log into a
session log interleaves timelines). The envelope carries a `historyNote` (count + span)
so the receiver knows what was left behind.

## Envelope format

One JSON file per send in `~/.mermaid-collab/artifact-inbox/<envelopeId>.json`
(envelopeId = UUID, minted by the RECEIVING server — the first global artifact-adjacent id
in the system, deliberately scoped to the mailbox only):

```jsonc
{
  "schemaVersion": 1,
  "envelopeId": "…",              // receiver-minted UUID
  "receivedAt": "…",
  "from": {                        // provenance, informational only
    "serverOwner": "…",            // serverOwner() label
    "baseUrl": "…",
    "project": "…",                // sender's project path (not resolvable here)
    "session": "…",
    "note": "…"                    // optional human message
  },
  "artifact": {
    "type": "document|diagram|design|spreadsheet|snippet|image|embed",
    "name": "…",                   // display name; id is re-derived on adopt
    "content": "…",                // text types: verbatim; image: base64 data URI
    "metadata": { }                // sender's metadata.json entry, replayed on adopt
  },
  "historyNote": { "versions": 12, "firstAt": "…", "lastAt": "…" },
  "state": "pending|adopted|dismissed",
  "adoptedTo": { "project": "…", "session": "…", "artifactId": "…" } // set on adopt
}
```

Size cap: reuse `MAX_IMAGE_SIZE` for images; a new `MAX_ENVELOPE_BYTES` (default 10MB)
for the whole envelope. The envelope never contains paths that the receiver resolves —
only content — so there is no traversal surface.

## Verbs + routes

1. **`send_artifact { project, session, type, id, to: { server }, note? }`** (MCP)
   - Reads the artifact via the existing per-type manager (`get_*` equivalents), builds
     the envelope payload (sans receiver-minted fields).
   - `to.server`: a baseUrl, or a desktop-registered serverId. Delivery is always
     `POST <target>/api/artifact-inbox` — including the local-loopback "two users, one
     machine, two servers" case, so there is exactly one delivery path.
   - Auth: the target enforces its normal bearer auth. Two ways to satisfy it:
     (a) **desktop-brokered** — `invokeOnServer` already attaches the stored token; free.
     (b) **headless** — new optional `token` param on the verb; the caller supplies it
     (same trust model as `launch_remote_server` today). `peerFetch` stays tokenless;
     this verb does NOT ride it.
   - Response: `{ envelopeId, receivedAt }` re-read from the target (success = verified
     write, per the mission constitution).

2. **`POST /api/artifact-inbox`** (new route, receiving side)
   - Validates schema + size cap, mints envelopeId, writes the file, broadcasts a WS
     `artifact_inbox_updated` event. Rejects `state != pending` input fields.

3. **`artifact_inbox { state? }`** (MCP) + **`GET /api/artifact-inbox`**
   - Lists envelopes (id, type, name, from, receivedAt, state). The Bridge gets an
     "Artifact inbox (N)" card off the WS event — mail, not work-graph, so NOT an
     escalation (escalations auto-reap in 60s; mail must not).

4. **`adopt_artifact { envelopeId, project, session, name? }`** (MCP)
   - Refuses unless the project is registered AND the session dir exists (D3).
   - Dispatches to the matching `create_*` (document/diagram/snippet/spreadsheet/design/
     image via data-URI), then `set_artifact_metadata` replay; name collisions get the
     store's normal `-1` suffixing. Marks the envelope `adopted` with `adoptedTo`
     (file kept — the inbox is its own audit trail). Returns the new artifact id.
   - Verified-write: re-reads the created artifact before reporting success.

5. **`dismiss_artifact { envelopeId }`** — marks `dismissed`. No deletion verb in v1;
   a later reaper can age out non-pending envelopes.

## Receiver notification (D6 — nothing to tell, three surfaces)

The receiver is never told out of band; arrival is visible on every surface they already
look at:
1. **Bridge open** → the inbox route's WS `artifact_inbox_updated` broadcast updates the
   "Artifact inbox (N)" card live.
2. **Nothing open** → envelopes are durable files; the card shows the pending count on
   next launch. Mail can be read late, never missed.
3. **Live agent session, Bridge not visible** → the route also fires the existing
   session-subscriptions NUDGE at active sessions on the receiving server, so a working
   session gets poked in its terminal. (Reuses `session-subscriptions.ts` delivery; no
   new channel.)
The SENDER gets the verified receipt (envelopeId re-read from the target), so delivery
is confirmed independent of when the receiver looks.

## Discovery (D5 — settled: the receiver tells the sender)

**v1 has no discovery machinery. The target address is told out of band** — the receiving
user shares their `baseUrl` (+ token if secured), exactly like `launch_remote_server` and
the desktop's "add server" flow work today. Once used, the address lives in the desktop's
connection store like any other server.

What exists if discovery is ever wanted (deferred, not designed):
- Servers on non-loopback binds already ADVERTISE `_mermaidcollab._tcp` over mDNS
  (`bonjour-advertiser.ts`) — but nothing browses it; the picker half was never built.
- Same machine, same OS user: `~/.mermaid-collab/instances/*.json` (instance_topology).
- Same machine, DIFFERENT OS users is the known blind spot: the instances dir is
  per-user and loopback binds suppress the mDNS advert. The supported posture is the
  same as remote: bind `0.0.0.0` with token auth, then the advert (and a future browse)
  sees them. With D5, this blind spot costs nothing — the user just tells you the port.

## Feasibility verdict

**HIGH for v1 — no new infrastructure, ~1 epic of work.** Every hard part already
exists: lossless content round-trip through `create_*`, an authenticated HTTP surface,
a WS broadcast channel, and the desktop token store for remote delivery. The envelope
mailbox is a new store but deliberately dumb (JSON files in one dir, no DB, no
migrations).

Honest costs:
- **New route + 4 MCP verbs + mailbox module + Bridge inbox card + tests** — the bulk.
- **Headless remote send needs a token in hand** (desktop-brokered send is free). Same
  posture as remote launch; not new risk.
- **History does not travel** (D4) — visible in the envelope, deferred by design.
- **No user addressing** (D1) — "send to Ben" is really "send to Ben's server"; a wrong
  baseUrl delivers to the wrong machine's inbox. Mitigation: the receiving inbox is
  inert until a human adopts.

Out of scope for v1: history transfer, user identity/address book, send-with-reply,
auto-adopt rules, multi-artifact bundles (send N envelopes instead).

## Test spec (regression-grade)

- Round-trip per type: create → send (loopback) → adopt into a second project →
  content byte-equal (image: binary equal), metadata replayed.
- Adopt refuses a nonexistent project and a nonexistent session (D3).
- Envelope over `MAX_ENVELOPE_BYTES` rejected at the route with a named error.
- Unauthenticated POST to a token-secured server 401s; loopback succeeds per auth.ts
  semantics.
- Adopt is idempotent-guarded: adopting an already-adopted envelope refuses (state
  machine, not a second copy).
- Mailbox isolation: with a pending envelope present, every artifact list verb and the
  update-log replay are byte-identical to the no-envelope baseline (the "agnostic inbox
  breaks nothing" property, as a test).
