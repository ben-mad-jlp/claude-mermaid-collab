# Design: Code Browser Revamp + Pair Programming Mode

## Summary

Two adjacent but independent UI changes. Part 1 reshapes the sidebar "code" tab into a fast, preview-first browser where a single click opens a temp tab of *raw code* and promotion to a permanent tab is what links the file as a session artifact. Part 2 proposes a global "pair programming mode" toggle that shifts collab defaults toward narrated, checkpoint-heavy, conversation-driven work with Claude — the recommended first cut is client-only UX sugar on top of existing agent/vibe plumbing, with a small server surface if we later want cross-session awareness.

---

## Part 1: Code Browser

### Current state (file:line pointers)

- Sidebar entry: `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx:1175-1191` — when the "code" tab is active, renders `PseudoTreeBody` with click handler that calls `useTabsStore.openPermanent({ id: 'pseudo::<stem>', kind: 'code-file', ... })`.
- Tree body: `ui/src/components/layout/sidebar-tree/PseudoTreeBody.tsx` — wraps `TreeNodeRenderer` from `ui/src/pages/pseudo/PseudoFileTree.tsx`.
- File-row renderer with click/"link" handlers: `ui/src/pages/pseudo/PseudoFileTree.tsx:82-188`.
  - Row click → `onNavigate(node.path)` which bubbles up to `ArtifactTree.onNavigate` and calls `openPermanent(...)` with `kind: 'code-file'`.
  - Hover link button (chain-link SVG) at `PseudoFileTree.tsx:165-187` calls `handleLinkAndOpen` → `linkFile(...)` → `openPermanent` with `kind: 'artifact', artifactType: 'snippet'`. This is the "link button" to remove.
- Pane dispatcher: `ui/src/components/layout/editor/PaneContent.tsx:179-184` — `code-file` → `<PseudoViewer path={tab.artifactId} project={project} />`. That is: today the center pane for a code tab is *pseudo prose*, not the actual source.
- Pseudo fetch: `ui/src/pages/pseudo/PseudoViewer.tsx:41-71` via `fetchPseudoFile` in `ui/src/lib/pseudo-api.ts:107-139` (has a 32-entry LRU, hits `/api/pseudo/file`).
- Code (linked) rendering: `ui/src/components/editors/CodeEditor.tsx` — envelope-parsed snippet, used only for the `snippet`-artifact path (not `code-file`).
- Link-file surface: `ui/src/lib/link-file.ts` — `linkFile(project, session, filePath)` creates a linked snippet (envelope with `linked: true`) then calls `api.syncCodeFromDisk`. Called from `PseudoFileTree.tsx`, `CodeEditor.tsx` (link-and-navigate), and `GlobalSearch.tsx`.
- Tabs store: `ui/src/stores/tabsStore.ts` — `openPreview` (italic/temp), `openPermanent`, `promoteToPermanent` all exist and are production-used for other artifact kinds.

### Bottleneck analysis (why clicks feel slow)

1. **Opens as permanent, not preview** (`ArtifactTree.tsx:1182`) — every click mutates the persisted tab bar, which is a write to the zustand persist middleware (`tabs.v3`). Other artifact kinds use `openPreview` (see `ArtifactTree.tsx:638`) and replace the single preview slot in place. Code-file clicks instead append. Writes to `persist` serialise the full `bySession` map on every change.
2. **`PseudoViewer` full-remount per navigation** (`PseudoViewer.tsx:30-176`) — different `path` prop but same component instance because React remounts on key change; the `methods.map(PseudoBlock ...)` is unmemoized and every `PseudoBlock` re-parses call graph links. For large files with many functions this is visibly janky.
3. **Waterfall fetch, no prefetch** (`PseudoViewer.tsx:50-66`) — click → tab created → effect fires → fetch begins. Zero overlap with the click-render. The LRU in `pseudo-api.ts:97` helps on revisit but not on first click.
4. **No streaming / no skeleton** — `loading` is a centered spinner that replaces the entire pane, so the user perceives a full content swap instead of progressive reveal.
5. **`fileData?.methods` dependency on effect notifying parent** (`PseudoViewer.tsx:74-78`) fires on every fetch completion, potentially triggering upstream renders.
6. **Pseudo tree re-sort on every render is memoized fine** (`PseudoTreeBody.tsx:100-114`), but the parent `ArtifactTree` re-renders whenever the tabs store changes, which happens on every click — plausible cascade but secondary.
7. **Persisted tabs store writes** — `openPermanent` fires `set` which triggers the persist middleware's full JSON serialisation; at high tab counts this adds a few ms per click.

#### Concrete fixes + expected impact

| Fix | File:line | Impact |
| --- | --- | --- |
| Switch code-file row click from `openPermanent` → `openPreview` | `ArtifactTree.tsx:1182` | Instant tab swap (reuses preview slot), no persist bloat. Also enables (4) below. |
| Prefetch `fetchPseudoFile` on hover/mouseenter of tree rows | `PseudoFileTree.tsx:142` (attach `onMouseEnter`) | Hides fetch latency behind pointer travel (50–200 ms usually covers the whole fetch). LRU already caches. |
| Make `PseudoViewer` render the cached payload synchronously when present and revalidate in background (SWR pattern) | `PseudoViewer.tsx:41-71` | Instant render on revisit; no loading spinner flash. |
| Virtualize or `React.memo(PseudoBlock)` | `PseudoViewer.tsx:157-167` | Fixes jank on files with many methods. Cheap win. |
| Replace full-pane spinner with skeleton header + progressive method reveal | `PseudoViewer.tsx:102-107` | Perceived-latency win even without fixing fetch. |
| Default view = raw code (see requirement 2 below) | new `CodeFileView` component in `PaneContent.tsx:179-184` | Raw code with syntax highlight is usually faster to paint than the pseudo prose layout + call-graph hover popovers. |

### Requirement 1 — Snappiness

Covered by fixes above. Ordered by ROI:
1. Preview-slot click (one-line change in `ArtifactTree.tsx:1182`).
2. SWR on `fetchPseudoFile` cache hits (5-line change in `PseudoViewer.tsx`).
3. Hover-prefetch (10 lines in `PseudoFileTree.tsx`).
4. `React.memo(PseudoBlock)` (1 line).
5. Skeleton loading.

### Requirement 2 — Default to code, not prose

**Component responsible:** `PaneContent.tsx:179-184` currently hard-dispatches `code-file` → `PseudoViewer`. That is the switch point.

**Proposal:** introduce `CodeFileView` (new component under `ui/src/components/editors/CodeFileView.tsx`) rendered by default for `code-file` tabs. It:
- Fetches raw file text from a new lightweight endpoint (or reuses `api.syncCodeFromDisk`-style read path), or — pragmatically — reads from the pseudo-db record's stored source if we expose it; otherwise add `GET /api/code/file?project=&path=`.
- Renders via `SnippetEditor` in read-only mode with CodeMirror syntax highlight (we already have that language inference stack).
- Has a `"Prose"` toggle button in its toolbar that swaps in `<PseudoViewer ... />` side panel or replaces the main view. Persisted preference key in `uiStore`: `codeFileDefaultView: 'code' | 'prose'`.

**Where prose lives:** keep `PseudoViewer` as the prose component; surface it via:
- A toolbar toggle in `CodeFileView` (primary UX).
- Existing "Pseudo" side-by-side mode in `CodeEditor.tsx:513-524` is a good reference pattern.

This keeps `PseudoViewer` as a self-contained, still-useful component and only moves the *default* dispatch.

### Requirement 3 — Remove the link button

**Location:** `ui/src/pages/pseudo/PseudoFileTree.tsx:165-187` — the chain-link SVG button shown on row hover, and its handler `handleLinkAndOpen` at lines 93-115.

**Action:** delete the button and `handleLinkAndOpen`. Keep `linkFile` import *only* if used elsewhere in the same file (it isn't). The intent motion (link → tab) is subsumed by the temp/promote flow in requirement 4. Audit call sites of `linkFile` after removal to make sure none assumed this entry point.

### Requirement 4 — Temp tab + promote-to-link

**Mental model:** temp tab = browsing the file (ephemeral, italic, single-slot); permanent tab = linked artifact (persistent + gets synced with disk, appears in artifact lists).

**Proposed flow:**

1. Single-click in code tree → `openPreview({ id: 'pseudo::<stem>', kind: 'code-file', artifactId: <absPath>, name: <basename> })`. No artifact is created. The `PseudoViewer` / `CodeFileView` reads from pseudo-db or raw-disk endpoint. (`ArtifactTree.tsx:1180-1188` is the edit point.)
2. Promotion triggers:
   - **Double-click** on the tab title (already implemented for other kinds in `TabBar.tsx` — confirm and reuse).
   - **Editing** the code in `CodeFileView` (readonly → user presses "Edit" or types). Today `code-file` is rendered read-only via `PseudoViewer`; in the new world, any edit intent should flip the tab from preview→permanent.
   - **Explicit action** e.g. right-click "Keep tab" or a pin button in the tab itself.
3. On promotion, **if `tab.kind === 'code-file'`**, run a side-effect:
   ```
   const snippetId = await linkFile(project, session, tab.artifactId);
   // Replace the preview tab with the now-linked snippet artifact tab
   closeTab(tab.id);
   openPermanent({ id: snippetId, kind: 'artifact', artifactType: 'snippet', artifactId: snippetId, name: tab.name });
   ```
   This reuses the existing `linkFile` helper and existing `CodeEditor` rendering for linked snippets — no new backend surface.

**Hook point:** wrap `useTabsStore.promoteToPermanent` or create a `promoteCodeFile` thunk in a new `ui/src/lib/promote-code-file.ts`. Tab UI components (`Tab.tsx`, `TabBar.tsx`) and the CodeFileView editor-on-first-keystroke handler call it. The tabsStore itself stays pure — side effects live in the thunk.

**Existing API surface recap (nothing new required for the MCP side):**
- Client: `linkFile` (`ui/src/lib/link-file.ts`) → `api.createSnippet` + `api.syncCodeFromDisk`.
- MCP: `link_code_file`, `list_code_files`, `sync_code_from_disk`, `push_code_to_file`, `propose_code_edit` all already exist. No server changes.

### Open questions (Part 1)

- Does the raw-code read use a new `/api/code/file` endpoint or piggyback on the pseudo-db's stored source text? (The latter is faster if available but may be stale.) Recommend: new endpoint, tiny fs read, trivial to implement.
- How do we surface the "this tab is temp" affordance for code files specifically? Italic tab title is the current convention — keep it.
- What happens on promotion if the file has already been linked in this session previously? `linkFile` creates a new snippet each call — we should first check `snippets` for an existing envelope whose `filePath` matches and reuse the id.
- Deep links / URL state: `pseudo::<stem>` id scheme is fine for preview tabs; confirm nothing in the URL-sync layer assumes every `code-file` tab eventually becomes a linked snippet.

---

## Part 2: Pair Programming Mode

### Problem framing

"Pair programming mode" is underspecified — it means different things to different users. We need to pick an interpretation, ship a minimal version that feels right, and leave room to grow.

The collab tool already has adjacent concepts: `agentMode` in session state (flipped via the `vibe-active` skill), `register_claude_session` (multiple Claude instances can register against a project/session), agent checkpointing, preview vs permanent tabs, and an agent-chat panel (`uiStore.agentChatVisible`). Pair mode should layer on these, not re-invent them.

### Candidate interpretations

**A. Narrated pair — "Claude is driving, explains out loud."**
Pair mode makes agent actions *slow, narrated, and confirmatory*. Before edits, Claude posts a plan snippet; preview tabs stay preview until the user confirms; auto-checkpoints fire before every multi-file change; agent speaks in first-person plural ("let's...").

**B. Driver/navigator rotation — "User drives, Claude navigates" (or inverse).**
Explicit roles. When the user is driver, Claude is limited to read-only tools + commentary + suggestions in a side rail. When Claude is driver, user gets a "pause/take-over" button and every tool call is interruptible.

**C. Shared cursor / shared tabs — "Multiple Claudes + human share UI state."**
Leverages `register_claude_session`. When two Claude sessions are registered, their active tabs and cursors are broadcast to all viewers; selections are highlighted with per-session colors; chat becomes a shared channel.

**D. Review-pairing — "Second Claude reviews every change."**
Pair mode spawns a shadow reviewer Claude (different model?) that watches every file edit and posts inline review comments. Essentially automated code review as you type.

**E. TDD pair — "Claude writes the test, you write the impl (or vice versa)."**
Strict ping-pong: pair mode enforces the red/green/refactor cycle with UI gates. Ties into the existing `test-driven-development` skill.

### Recommended design: Start with A, with a door to C

**Rationale.** A is the highest-leverage, lowest-risk first cut: it's pure client UX changes layered on agent tool-call events we already emit, and it matches the intuition most users have when they say "pair with me." C is the sexiest but requires multi-session awareness we don't yet broadcast over websockets in a structured way. D and E are niche. B is interesting but adds a mode-within-a-mode that will be confusing before we've nailed A.

**What pair mode changes (first cut):**

1. **Narrated planning.** When pair mode is ON and the agent is about to execute a tool that mutates code (Edit/Write/bash-write/propose_code_edit), the agent first posts a short "About to do X because Y" message. This is enforced via a system-prompt suffix appended when pair mode is on, injected by the client in the next turn's user/system context.
2. **Auto-checkpoint before agent edits.** Hook into the existing checkpoint system (`.collab/agent-checkpoints.db`) to force a checkpoint on every tool-use boundary when pair mode is on. Server-side change: one flag on the agent run payload.
3. **Preview-tab sticky.** In pair mode, tabs opened by the agent stay as preview (italic) until the user double-clicks to promote. Encourages the user to review before committing the tab to their working set.
4. **Confirm-before-push.** `CodeEditor.tsx` Push button already has a diff modal (`CodeEditor.tsx:349-356`). In pair mode, also block `propose_code_edit` auto-accept flows — always require explicit user accept.
5. **Chat-first layout.** `agentChatVisible = true` and the chat pane gets a wider default split. Agent messages are styled slightly larger/differently to emphasise conversation over output.
6. **Subtle visual chrome.** A thin colored border around the app (e.g. amber top-bar) so the user always knows pair mode is on.

**Fuller vision (path to C):**

- When two+ Claude sessions are registered for the same `project::session`, broadcast tab-focus and cursor events across them via an extension to the existing websocket. Show per-session avatars on active tabs.
- A "pair session" concept at the MCP layer: `start_pair_session(participants: string[])` that binds sessions and enables shared todo lists. Probably a follow-up.

### Toggle and persistence

- **UI entry point.** A toggle in the `Header.tsx` (top bar) — icon + label, placed near the edit-mode and agent-chat toggles. Keyboard shortcut (e.g. `Cmd+Shift+P`) for power users.
- **State.** Add to `ui/src/stores/uiStore.ts`:
  ```
  pairMode: boolean;
  setPairMode: (on: boolean) => void;
  togglePairMode: () => void;
  ```
  Persisted in the same `persist` store as the rest of UIState. **Global, not per-session**, because the UX friction is a user preference, not a session property. (Contrast with `agentMode` which lives in session state because it describes *what the session is for*.)
- **Server-side mirror (minimal).** Add an optional `pairMode: boolean` on agent-run payloads so the server can apply the auto-checkpoint + narrated-planning system-prompt suffix. No persistent server state required.

### Interaction with existing `agentMode`

`agentMode` (from vibe-active skill) means "this session is in agent-driven execution mode." Pair mode is orthogonal: you can be in agentMode + pair (narrated, checkpoint-heavy agent runs) or agentMode + not-pair (classic fire-and-forget). Non-agent + pair mode is also meaningful: it just means the human-only interactions (tabs, editing) behave more cautiously.

Rule of thumb: **agentMode decides *who* is driving, pairMode decides *how* carefully they drive.**

### Minimal first cut (what ships in v1)

1. `uiStore.pairMode` + header toggle + keyboard shortcut.
2. Amber app-chrome border when on.
3. Preview-tab-sticky behavior: agent-opened tabs stay `isPreview: true` even when opened via `openPermanent`, if pair mode is on. One-liner in `tabsStore.openPermanent`.
4. System-prompt suffix appended to agent turns when pairMode is on, requesting pre-edit narration.
5. Force-checkpoint flag in agent-run payload.

Estimated 1–2 day build. Everything else (shared cursors, role rotation, TDD enforcement) is vNext.

### Open questions (Part 2)

- Does the narrated planning need to be *blocking* (agent stops until user ACKs) or just *emitted* (agent narrates but keeps going)? Recommend: emitted in v1, blocking as a separate "strict pair" sub-mode later.
- Should pair mode affect model selection (e.g. Opus for narration, Sonnet for execution)? Probably no — keep it orthogonal.
- Does the amber border belong here or is there a better pattern (status badge in header)? Worth a quick design sketch.
- Cross-session awareness (interpretation C) needs a websocket channel design doc of its own before we commit.

---

## Risks / unknowns

- **`code-file` preview semantics today.** `openPreview` uses a single preview slot — if the user already has a preview tab open for another artifact (say, a diagram), clicking a code file will evict it. That's consistent with existing behavior; call it out but don't change it.
- **`linkFile` creates snippets on promotion.** Repeated promote→close→promote of the same file would create duplicate snippets unless we dedupe by `envelope.filePath`. Add the lookup-first logic noted in Part 1 open questions.
- **Pseudo-db data freshness.** If we default the view to raw code, users lose the curated prose on first open. Discoverability of the prose toggle must be clear (labeled "Prose"/"Pseudo" button, not an icon-only).
- **Server-side agent-run changes for pair mode are small but touch the agent projector.** Low risk, but needs tests around the new `pairMode` flag not breaking existing runs.
- **Persisted `uiStore` migration.** Adding `pairMode` is additive; no migration needed. Confirm `persist` middleware handles missing keys gracefully (it does in zustand by default).
