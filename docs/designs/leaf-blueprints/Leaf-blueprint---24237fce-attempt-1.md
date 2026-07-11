Blueprint written. Full text below.

---

# Z9 — Trust + action polish + mobile-parity (design-zen-mode Phase 5)

Implementation blueprint. Phase 5 closes the Zen surface: make the "force refresh" trustworthy, give every action an optimistic+undoable feel, let the operator pin an item as human-only and tune the watchdog threshold from the UI, and *verify* the whole Zen surface is a pure HTTP-read-model + WS thin client so the Phase-2 mobile app is a straight port.

This is mostly small additive wiring on top of Z5–Z8 (already landed). No new tables. No schema migration. Reuses the store's "confirm-on-ok / keep-prior-on-failure" convention and the existing `notificationStore` toast.

---

## Context — what already exists (do NOT rebuild)

- **Force/refresh plumbing**: `session-summary-loop.ts` already captures pane → hashes → interprets via the configured `summary` model, persists into the module `cache`, and `broadcast({type:'session_summary_updated', …})`. The change-gate is `shouldSummarize()` (line ~277): returns false when `hash === prev.summaryPaneHash`. Driven once per tick by `orchestrator-live.ts` (`runSessionSummaryTick`).
- **Snooze (sessions)**: `supervisorStore.snoozeSession(project, session, untilMs)` sets `sessionSummaries[key].snoozedUntil`; `triageSelectors.selectTriageStack` already excludes snoozed sessions. Escalations have NO snooze yet.
- **Operator-gating**: the wire field `Escalation.operatorGated` + the deterministic outranking (`SEV_GATED_OR_WEDGED`) already exist (`triageSelectors.ts`, Z4 test). There is NO setter to *mark* an existing escalation operator-gated, and no UI for it.
- **Watchdog threshold**: durable store getters/setters exist (`supervisor-store.ts` `getWatchdogThreshold` / `setWatchdogThreshold`, column `watched_project.watchdogThresholdPercent`) and the MCP tool `set_watchdog_threshold` (`setup.ts:5145`). There is NO REST route and NO UI.
- **capture-pane** REST (`/api/supervisor/capture-pane`) shows the peer-forward pattern to copy for the new refresh route. **nudge** REST is the optimistic-action target.
- **Toasts**: `notificationStore` (`addToast`/`removeToast`) with `duration` auto-dismiss.
- **PaneLinesPopover** is already click/tap-driven (no hover-to-reveal) — good for mobile.

---

## TASK 1 — backend: force-proof out-of-band re-summarize

**File:** `src/services/session-summary-loop.ts` (edit)

Add a module-level force set + an exported request fn, and have the tick bypass the change-gate + throttle for force-requested keys (consuming the flag).

1. Near the `cache` declaration add:
   ```ts
   /** Keys (`${project}::${session}`) the UI force-requested an out-of-band refresh
    *  for — bypasses the change-gate + throttle in shouldSummarize for ONE tick. */
   const forceRefresh = new Set<string>();
   export function requestForceRefresh(project: string, session: string): void {
     forceRefresh.add(`${project}::${session}`);
   }
   ```
   Add `forceRefresh.clear()` inside the existing `__resetSummaryState()` for test hygiene.

2. In `shouldSummarize(...)` add a `forced: boolean` param (last param). When `forced`, skip the `hash === prev?.summaryPaneHash` change-gate AND the throttle branch — return `true` as long as `wsPresentNow && paneNonEmpty && !prev?.summaryInFlight`. Keep the in-flight guard (don't double-fire).

3. At the call site (line ~503) compute `const forced = forceRefresh.has(key)` and pass it. After computing `forced`, **consume** it: `if (forced) forceRefresh.delete(key);` (delete regardless of whether it summarizes, so a frozen/dead pane can't wedge the set).

**File:** `src/services/session-summary-loop.ts` — also export a convenience driver so the route doesn't reach into tick internals:
```ts
export async function forceSummarizeSession(project: string, session: string): Promise<void> {
  requestForceRefresh(project, session);
  await runSessionSummaryTick({ watchedProjects: () => new Set([project]) });
}
```
(The default `listSessions = listSupervised` already filters to watched projects; scoping `watchedProjects` to the single project keeps the forced tick cheap. The forced key is consumed inside; other sessions in that project follow their normal change-gate.)

> Force-proof rationale: the bug we're killing is "I clicked Refresh and nothing happened because the pane hash didn't change." Bypassing the change-gate + throttle (but NOT the in-flight guard) guarantees a fresh interpret + a `session_summary_updated` broadcast with a new `summaryUpdatedAt`.

## TASK 2 — backend: refresh-summary REST route

**File:** `src/routes/supervisor-routes.ts` (edit) — add directly after the `/api/supervisor/capture-pane` block (~line 530), mirroring its peer-forward shape:

```ts
// POST /api/supervisor/refresh-summary — force an out-of-band re-hash/re-summarize of
// ONE session, bypassing the change-gate (Z9 "force-proof"). Peer → forward; local →
// forceSummarizeSession (which runs a scoped tick and broadcasts session_summary_updated).
if (url.pathname === '/api/supervisor/refresh-summary' && req.method === 'POST') {
  try {
    const { project, session, serverId } = (await req.json()) as
      { project?: string; session?: string; serverId?: string };
    if (!project || !session) return jsonError('project and session are required', 400);
    if (serverId && getPeer(serverId)) {
      const peer = getPeer(serverId)!;
      const res = await fetch(peer.baseUrl + '/api/supervisor/refresh-summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, session }),
      });
      return Response.json(await res.json());
    }
    const { forceSummarizeSession } = await import('../services/session-summary-loop.ts');
    await forceSummarizeSession(project, session);
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
  }
}
```
(Dynamic import matches the file's existing lazy-import style, e.g. escalation-history.)

## TASK 3 — backend: watchdog-threshold REST route

**File:** `src/routes/supervisor-routes.ts` (edit) — add a GET + POST pair. Reuse the already-imported supervisor-store helpers (`getWatchdogThreshold` / `setWatchdogThreshold`; add to the existing import block if not already imported).

```ts
// GET /api/supervisor/watchdog-threshold?project=… → { project, thresholdPercent|null }
if (url.pathname === '/api/supervisor/watchdog-threshold' && req.method === 'GET') {
  const project = url.searchParams.get('project');
  if (!project) return jsonError('project is required', 400);
  return Response.json({ project, thresholdPercent: getWatchdogThreshold(project) });
}
// POST /api/supervisor/watchdog-threshold { project, thresholdPercent:number|null }
if (url.pathname === '/api/supervisor/watchdog-threshold' && req.method === 'POST') {
  try {
    const { project, thresholdPercent } = (await req.json()) as
      { project?: string; thresholdPercent?: number | null };
    if (!project) return jsonError('project is required', 400);
    if (thresholdPercent !== null &&
        (typeof thresholdPercent !== 'number' || thresholdPercent < 1 || thresholdPercent > 100)) {
      return jsonError('thresholdPercent must be a number 1-100, or null to clear', 400);
    }
    setWatchdogThreshold(project, thresholdPercent ?? null);
    return Response.json({ project, thresholdPercent: thresholdPercent ?? null });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
  }
}
```
Validation mirrors the MCP `set_watchdog_threshold` handler (setup.ts:5145) exactly.

## TASK 4 — backend: operator-gate setter + route

**File:** `src/services/supervisor-store.ts` (edit) — add after the other `UPDATE escalation …` helpers (~line 844):
```ts
/** Operator-gate an EXISTING open escalation ("only you"): force the human floor so the
 *  steward/AI can never auto-answer it, and pin it to the top tier of the triage stack. */
export function setOperatorGated(id: string, gated: boolean): void {
  const d = openDb();
  d.prepare('UPDATE escalation SET operatorGated = ?, routedTo = ? WHERE id = ?')
    .run(gated ? 1 : 0, gated ? 'human' : 'human', id);
}
```
(routedTo always lands 'human' here — un-gating doesn't re-route to steward; that's a deliberate one-way safety. Keep both branches 'human' or simplify to a single literal.)

**File:** `src/routes/supervisor-routes.ts` (edit) — add near the `/decide` regex route (~line 414). Re-broadcast so every surface re-ranks immediately (reuse `escalation_created` upsert path — the store already folds a re-broadcast in place):
```ts
const gateMatch = url.pathname.match(/^\/api\/supervisor\/escalation\/([^/]+)\/operator-gate$/);
if (gateMatch && req.method === 'POST') {
  const id = decodeURIComponent(gateMatch[1]);
  const { gated } = (await req.json().catch(() => ({}))) as { gated?: boolean };
  const esc = getEscalation(id);
  if (!esc) return jsonError(`escalation not found: ${id}`, 404);
  setOperatorGated(id, gated !== false); // default true
  const updated = getEscalation(id)!;
  getWebSocketHandler()?.broadcast({ type: 'escalation_created', ...updated });
  return Response.json({ ok: true, operatorGated: gated !== false });
}
```
(Use the existing single-escalation getter — confirm its export name, `getEscalation`, in supervisor-store.ts; if absent, read via `listEscalations`/`listOpenEscalations` find.)

---

## TASK 5 — frontend store: actions + snooze-escalation + threshold mirror

**File:** `ui/src/stores/supervisorStore.ts` (edit)

a) **refreshSummaryNow** — add to the interface + impl:
```ts
refreshSummaryNow: (serverId: string, project: string, session: string) => Promise<boolean>;
// impl:
refreshSummaryNow: async (serverId, project, session) => {
  const res = await invoke(serverId, '/api/supervisor/refresh-summary', 'POST', { project, session, serverId });
  return !!res?.ok; // the fresh summary arrives via the session_summary_updated WS ingest
},
```

b) **snoozeEscalation (the generic `snoozeItem`)** — escalations need a local-only snooze mirroring `snoozeSession`. Add state `snoozedEscalations: Record<string, number>` (id → untilMs; NOT persisted — live signal) and:
```ts
snoozeEscalation: (id: string, untilMs: number) =>
  set((state) => ({ snoozedEscalations: { ...state.snoozedEscalations, [id]: untilMs } })),
```
Filtering happens in the selector (Task 7) so an expired snooze re-surfaces purely on the ticking clock — no server change, matching the spec's "client-side timer + flag, re-surfaces on expiry."

c) **markOperatorGated** — optimistic + confirm-on-ok:
```ts
markOperatorGated: async (serverId, id, gated = true) => {
  // optimistic: flip the field locally so the triage stack re-ranks instantly
  set((state) => updateOpenItem(state, id, { operatorGated: gated, routedTo: 'human' }));
  const res = await invoke(serverId, `/api/supervisor/escalation/${encodeURIComponent(id)}/operator-gate`, 'POST', { gated });
  if (!res?.ok) set((state) => updateOpenItem(state, id, { operatorGated: !gated })); // rollback
  return !!res?.ok;
},
```

d) **watchdog threshold** — add `watchdogThresholdByProject: Record<string, number | null>` plus `loadWatchdogThreshold(serverId, project)` (GET → set keyed) and `setWatchdogThreshold(serverId, project, thresholdPercent)` (optimistic set keyed, POST, rollback on failure). Live signal — not persisted to localStorage.

> Optimistic-clear/undo for nudge (the spec's "sent → X toast + 5s undo, reconciled against server"): implemented at the card layer (Task 6) using `notificationStore` — the store already does confirm-on-ok; the card adds the visual optimistic-clear + the 5s undo window before actually firing. No new store action required, but expose the existing `nudge` return (already `Promise<boolean>`) for reconciliation.

## TASK 6 — frontend hook: ticking clock (`useNow`)

**File:** `ui/src/hooks/useNow.ts` (create)

ZenMode currently computes `now = Date.now()` only at render, so a snooze can't expire and the desaturate can't kick in without an unrelated store update. Add a minimal ticking clock:
```ts
import { useEffect, useState } from 'react';
/** Re-render every `intervalMs` so age-based UI (freshness desaturate, snooze expiry)
 *  advances without an external event. Default 5s. */
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
```

## TASK 7 — frontend: triage selectors exclude snoozed escalations

**File:** `ui/src/lib/triageSelectors.ts` (edit)

`selectTriageStack` / `selectTriageTop` must accept an optional `snoozedEscalations: Record<string, number> = {}` arg and skip an escalation when `snoozedEscalations[e.id] && now < snoozedEscalations[e.id]`. (Sessions already snooze-filter via `snoozedUntil`.) Keep the signature backward-compatible (new trailing optional param) so existing callers + the Z4 unit test still compile. Add a focused unit case in `triageSelectors.test.ts`: a snoozed operator-gated escalation drops out of the stack until `now` passes its `untilMs`, then re-surfaces.

## TASK 8 — frontend: SessionParagraphCard action polish

**File:** `ui/src/components/supervisor/zen/SessionParagraphCard.tsx` (edit)

Add three things, all tap-driven (no hover), all reading from store actions threaded as props (keep the component prop-driven like today):

1. **Force-refresh button** in the header row (next to the status pill): "↻" / "Refresh" that calls a new prop `onRefresh(project, session)` → `refreshSummaryNow`. While the `summaryUpdatedAt` hasn't advanced yet, show a brief spinning/disabled state (local `useState` `refreshing`, cleared when a newer `summary.summaryUpdatedAt` arrives via props, or after a 6s timeout fallback). This is the visible proof the force worked.

2. **"Only you" operator-gate toggle** — a small button (shown when `escalation` is present and open): calls `onMarkOperatorGated(serverId, escalation.id, !gated)`. When `escalation.operatorGated` is truthy, render a pinned "🔒 only you" chip in the header and style the card border accent (it already deterministically outranks via Task 7's selector — this just gives the human the control + the visual confirmation).

3. **Optimistic clear + toast + 5s undo** for the answer actions (`onAnswerPane` / `onDecideEscalation` / Approve / Skip). Refactor the click handlers so that instead of firing immediately they:
   - set a local `pendingAction` ({label, fire:()=>Promise<boolean>}) and visually collapse/clear the needs-input block (optimistic),
   - `addToast({type:'info', title:`sent → ${label}`, message:'tap to undo', duration:5000})` and stash the toast id,
   - start a 5s timer; on expiry actually call `fire()` and, on a falsy result, re-open the block + `addToast({type:'error', title:'send failed'})` (reconcile against server — reuses the store's confirm-on-ok return),
   - an **Undo** affordance (a button rendered while `pendingAction` is set, OR clicking the toast — keep it in-card for testability) cancels the timer, removes the toast, and restores the block. (`notificationStore.addToast`/`removeToast`.)

   Keep "Other…" send and Snooze going through the same optimistic path for consistency; Snooze additionally calls `onSnooze` immediately (snooze is itself the undo-friendly action — no server write).

Thread the new props from ZenMode (Task 9). Preserve the raw-question + Other… guardrails from Z8 unchanged.

## TASK 9 — frontend: ZenMode wiring

**File:** `ui/src/components/supervisor/zen/ZenMode.tsx` (edit)

- Replace `const now = Date.now();` with `const now = useNow();` (Task 6) so freshness desaturate + snooze expiry advance live.
- Pull new store bits: `refreshSummaryNow`, `markOperatorGated`, `snoozeEscalation`, `snoozedEscalations`, `watchdogThresholdByProject`, `loadWatchdogThreshold`, `setWatchdogThreshold`.
- Pass `snoozedEscalations` into `selectTriageTop(...)` (Task 7).
- Thread `onRefresh`, `onMarkOperatorGated`, and a real `onSnooze` for escalations (`snoozeEscalation(escalation.id, Date.now()+10*60_000)`) into `SessionParagraphCard` and `FocusCard`/`WedgeFocusCard` where applicable.
- Mount the threshold control (Task 10).

## TASK 10 — frontend: watchdog threshold control

**File:** `ui/src/components/supervisor/zen/ThresholdControl.tsx` (create) — a compact per-project numeric control (number input 1–100 + "default" clear button). On change calls `setWatchdogThreshold(serverId, project, value|null)` (optimistic, Task 5d). On mount/per project, `loadWatchdogThreshold`. Render it in ZenMode near the Projects PillList (one per watched project, or a single control bound to the focused/first project — keep it simple: one row per project under the Projects zone). Pure HTTP read-model; no hover.

## TASK 11 — mobile-parity audit (verification deliverable)

**File:** `docs/designs/design-zen-mode/z9-mobile-parity-audit.md` (create)

Walk every Zen zone (`VerdictBar`, `CalmCanvas`, `FocusCard`, `WedgeFocusCard`, `SessionParagraphCard`, `PaneLinesPopover`, `PillList`/`ProjectPill`/`SessionPill`, `ThresholdControl`) and record, per component, that:
- all data comes from `supervisorStore` (HTTP read-models) + WS ingest + the local `subscriptionStore`/`freshnessStore` — NO direct DOM/electron-only APIs, NO `window.mc` reach-arounds outside the store's `invoke()` (which already falls back to same-origin `fetch` in a plain browser — the mobile transport),
- every interaction is **tap** (`onClick`), with NO hover-to-reveal (Tailwind `hover:` is decorative only; confirm PaneLinesPopover/popovers open on click, which they do today),
- no fixed-pixel widths that break < 400px (note any `w-[28rem]` etc. that already cap with `max-w-[80vw]` — PaneLinesPopover already does).

Any violation found becomes an inline fix in the corresponding component (expected: none or trivial). This file IS the Phase-2 port checklist.

---

## Tests

- `triageSelectors.test.ts` — snoozed-escalation exclusion + re-surface (Task 7).
- `session-summary-loop.test.ts` — `forceSummarizeSession` re-summarizes a FROZEN pane (same hash) that the normal change-gate would skip; emits `session_summary_updated`.
- supervisor-store: a small bun test that `setOperatorGated(id,true)` sets `operatorGated=1` + `routedTo='human'`, and the watchdog-threshold round-trips (the watchdog test file already exists).
- (Optional) a SessionParagraphCard RTL test: clicking an answer optimistically clears the block, shows a toast, and Undo restores it without calling the fire fn.

Run: `npm run test:ci` (UI) and the backend dual-runner per CLAUDE.md.

## Sequencing / dependencies

Backend (Tasks 1–4) are independent of each other and can land in parallel. Frontend store (Task 5) depends on the routes existing. Tasks 6/7 are pure leaf modules. Tasks 8/9/10 depend on 5/6/7. Task 11 is a final read-only sweep after the components settle.

## Risks / notes

- Force-refresh must NOT bypass the `summaryInFlight` guard (double-interpret + cost).
- `forceRefresh` key is consumed every tick regardless of outcome → a dead pane can't permanently pin the set.
- markOperatorGated is one-way-safe (always routes 'human'); confirm with Z4 invariant that un-gating can't silently re-enable steward auto-answer.
- Optimistic clear must reconcile on the server return (falsy → re-open + error toast), never assume success — this is the trust contract the phase is named for.

```json
{ "schemaVersion": 1, "estimatedFiles": 11, "estimatedTasks": 11,
  "nonEnumerableFanout": false,
  "filesToCreate": [
    "ui/src/hooks/useNow.ts",
    "ui/src/components/supervisor/zen/ThresholdControl.tsx",
    "docs/designs/design-zen-mode/z9-mobile-parity-audit.md"
  ],
  "filesToEdit": [
    "src/services/session-summary-loop.ts",
    "src/routes/supervisor-routes.ts",
    "src/services/supervisor-store.ts",
    "ui/src/stores/supervisorStore.ts",
    "ui/src/lib/triageSelectors.ts",
    "ui/src/components/supervisor/zen/SessionParagraphCard.tsx",
    "ui/src/components/supervisor/zen/ZenMode.tsx",
    "ui/src/lib/triageSelectors.test.ts"
  ],
  "tasks": [
    { "id": "force-refresh-loop", "files": ["src/services/session-summary-loop.ts"], "description": "Force-proof out-of-band re-summarize: forceRefresh set, requestForceRefresh/forceSummarizeSession, bypass change-gate+throttle (not in-flight)" },
    { "id": "refresh-route", "files": ["src/routes/supervisor-routes.ts"], "description": "POST /api/supervisor/refresh-summary (peer-forward + local forceSummarizeSession)" },
    { "id": "watchdog-threshold-route", "files": ["src/routes/supervisor-routes.ts"], "description": "GET+POST /api/supervisor/watchdog-threshold reusing store get/setWatchdogThreshold" },
    { "id": "operator-gate-backend", "files": ["src/services/supervisor-store.ts", "src/routes/supervisor-routes.ts"], "description": "setOperatorGated store fn + POST /api/supervisor/escalation/:id/operator-gate route w/ re-broadcast" },
    { "id": "store-actions", "files": ["ui/src/stores/supervisorStore.ts"], "description": "refreshSummaryNow, snoozeEscalation(+snoozedEscalations), markOperatorGated, watchdogThresholdByProject load/set" },
    { "id": "use-now-hook", "files": ["ui/src/hooks/useNow.ts"], "description": "Ticking clock hook driving snooze expiry + freshness desaturate" },
    { "id": "triage-snooze-escalation", "files": ["ui/src/lib/triageSelectors.ts", "ui/src/lib/triageSelectors.test.ts"], "description": "Exclude snoozed escalations from triage stack (optional arg) + unit test" },
    { "id": "card-action-polish", "files": ["ui/src/components/supervisor/zen/SessionParagraphCard.tsx"], "description": "Force-refresh button, 'only you' operator-gate toggle, optimistic clear + toast + 5s undo reconciled on server return" },
    { "id": "zenmode-wiring", "files": ["ui/src/components/supervisor/zen/ZenMode.tsx"], "description": "useNow, thread new actions/props, snoozedEscalations into selectTriageTop, mount ThresholdControl" },
    { "id": "threshold-control", "files": ["ui/src/components/supervisor/zen/ThresholdControl.tsx"], "description": "Per-project watchdog threshold input (1-100 / clear) wired to store, tap-only" },
    { "id": "mobile-parity-audit", "files": ["docs/designs/design-zen-mode/z9-mobile-parity-audit.md"], "description": "Per-zone audit: HTTP read-model+WS only, tap-uniform (no hover-reveal), responsive widths; fix any violation" }
  ] }
```