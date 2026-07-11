# Z9 — Trust + action polish + mobile-parity

Phase 5 (final) of **design-zen-mode**. Five capability slices land on top of the
Z1–Z8 zen shell. All are additive; no Z1–Z8 behavior is removed. The unifying
constraint is the **mobile-parity invariant**: every interaction must be a *tap*
that mutates server state via an HTTP route and re-reads via the existing WS
`session_summary_updated` / `escalation_created` ingest path — never a hover, never
a local-only stream. The Phase-2 mobile app then ports as a thin HTTP+WS client.

Read first (the live surfaces this leaf extends):
- `src/services/session-summary-loop.ts` — structural+interpreter loop; cache,
  `interpretViaNode`, `resolveModel`, `summaryFields`, broadcast shape.
- `src/routes/supervisor-routes.ts` — `nudge` (471) + `capture-pane` (508) routes
  are the peer-forward template; `escalations/resolve` (311) the mutation template.
- `src/services/supervisor-store.ts` — `getWatchdogThreshold`/`setWatchdogThreshold`
  (363/371), `setEscalationRoute` (828) / `setEscalationSuggestion` (774) mutation
  template, `mapEscalationRow` (489).
- `ui/src/stores/supervisorStore.ts` — `sessionSummaries`, `snoozeSession` (585),
  `capturePane` (863), `decideEscalation`/`resolveEscalation` confirm-on-ok pattern,
  `updateOpenItem`/`moveOpenToResolved` helpers, `invoke()` wrapper.
- `ui/src/lib/triageSelectors.ts` — `selectTriageStack` (snooze + severity already).
- `ui/src/components/supervisor/zen/ZenMode.tsx`, `SessionParagraphCard.tsx`,
  `FocusCard.tsx`, `PaneLinesPopover.tsx`, `ThresholdControl.tsx` (already built,
  NOT yet wired).
- `ui/src/stores/notificationStore.ts` — `addToast`/`removeToast` (toast + undo infra).

---

## Slice A — `refreshSummaryNow` (force-proof out-of-band re-summarize)

The interpreter loop is change-gated (`shouldSummarize`: skips when
`hash === prev.summaryPaneHash`). A human staring at a stale paragraph needs a
*force* path that re-hashes and re-summarizes regardless of the gate.

**Server — `src/services/session-summary-loop.ts`** (new exported fn near
`getSessionSummary`):
```ts
export async function refreshSummaryNow(
  project: string, session: string, deps: SummaryTickDeps = {},
): Promise<{ ok: boolean; reason?: string }> {
  const key = `${project}::${session}`;
  const prev = cache.get(key);
  if (!prev) return { ok: false, reason: 'unknown-session' };
  if (prev.summaryInFlight) return { ok: false, reason: 'in-flight' };
  const capture = deps.capture ?? capturePaneLocal;
  const isWaiting = deps.isWaiting ?? ((p: string) => detectPermissionPrompt(p).isPermission);
  const interpret = deps.interpret ?? interpretViaNode;
  const resolveModel = deps.summaryModel ?? defaultResolveModel; // extract the inline
  const broadcast = deps.broadcast ?? ((m: unknown) => getWebSocketHandler()?.broadcast(m as WSMessage));
  const now = deps.now ?? Date.now;
  const pane = await capture(prev.tmux);
  if (pane === '') return { ok: false, reason: 'capture-failed' };
  const hash = createHash('sha1').update(pane).digest('hex');
  const { model, effort } = resolveModel(project);
  prev.summaryInFlight = true; prev.lastSummaryAt = now(); cache.set(key, prev);
  const pendingQuestion = isWaiting(pane) ? extractPendingQuestion(pane) : null;
  let structured: InterpreterStructured | null = null;
  try { structured = await interpret({ project, session, pane, pendingQuestion, model, effort }); }
  catch { structured = null; }
  const cur = cache.get(key); if (!cur) return { ok: false, reason: 'pruned' };
  cur.summaryInFlight = false;
  if (structured) {
    cur.structured = structured; cur.summaryText = structured.paragraph;
    cur.firstClause = firstClauseOf(structured.paragraph);
    cur.summaryPaneHash = hash; cur.summaryUpdatedAt = now(); cur.refreshState = 'fresh';
  } else { cur.refreshState = 'stale-failing'; }
  cache.set(key, cur);
  broadcast({ type: 'session_summary_updated', project, session,
    progressState: cur.progressState, paneSeenAt: cur.paneSeenAt, updatedAt: cur.updatedAt,
    ...summaryFields(cur) });
  return { ok: true };
}
```
Refactor: extract the inline `resolveModel` closure inside `runSessionSummaryTick`
into a module-level `defaultResolveModel(project)` so both the tick and
`refreshSummaryNow` share it (no duplicated NODE_PROFILE/override logic).

**Route — `src/routes/supervisor-routes.ts`** (after `capture-pane`, mirror its
peer/local branch; peer-forward to a new `/api/ide/refresh-summary` is out of
scope — local-only forward returns `{ ok:false, reason:'peer-unsupported' }` for a
peer serverId, matching keep-prior semantics):
```ts
if (url.pathname === '/api/supervisor/refresh-summary' && req.method === 'POST') {
  const { project, session } = await req.json();
  if (!project || !session) return jsonError('project and session are required', 400);
  const result = await refreshSummaryNow(project, session);
  return Response.json(result);
}
```
Add `refreshSummaryNow` to the `session-summary-loop.ts` import block in routes.

**Store — `ui/src/stores/supervisorStore.ts`** (new action; declare in the
interface near `capturePane`):
```ts
refreshSummaryNow: async (serverId, project, session) => {
  const res = await invoke(serverId, '/api/supervisor/refresh-summary', 'POST', { project, session });
  return !!(res?.ok && res.body?.ok);
},
```
No local `set` — the server's enriched WS broadcast flows through the existing
`ingestSessionSummary` path (HTTP-trigger → WS-read parity).

**UI** — `SessionParagraphCard.tsx`: add a small "↻ refresh" tap button in the
header row next to the freshness pulse, calling a new
`onRefresh(project, session)` prop. Wire in `ZenMode.tsx` to
`refreshSummaryNow(serverFor(p,s), p, s)`. `PaneLinesPopover`'s existing "Refresh"
stays as the raw-pane re-fetch (unchanged).

---

## Slice B — `snoozeItem(id, ms)` (client-side timer + re-surface)

`snoozeSession` already snoozes sessions out of the triage stack via
`snoozedUntil` on the summary. Generalize to ESCALATIONS (which have no summary
entry) with a local-only `snoozedItems: Record<string, number>` map keyed by
escalation id. No server change (pure client suppression, same rationale as
`snoozedUntil`).

**Store — `ui/src/stores/supervisorStore.ts`**:
- Add state `snoozedItems: Record<string, number>` (NOT persisted; live signal).
- Add action `snoozeItem: (id: string, ms: number) => void` →
  `set(s => ({ snoozedItems: { ...s.snoozedItems, [id]: Date.now() + ms } }))`.
- Add `unsnoozeItem: (id: string) => void` (drops the key) for an explicit
  "un-snooze" and for GC of expired keys.

**Selector — `ui/src/lib/triageSelectors.ts`**: extend `selectTriageStack` /
`selectTriageTop` signatures with an optional `snoozedItems: Record<string,number> = {}`
param; in the escalation loop, `if (snoozedItems[e.id] && now < snoozedItems[e.id]) continue;`.
Keep the existing session `snoozedUntil` exclusion. (selectParagraphStack is
unaffected — paragraphs render regardless of snooze; snooze only governs the
triage TOP focus card.)

**Re-surface on expiry — `ZenMode.tsx`**: `now` is currently a one-shot
`Date.now()` recomputed only on store re-render. Add a 1 Hz ticker so a snooze
expiry re-promotes the item even with no WS traffic:
```ts
const [tick, setTick] = useState(0);
useEffect(() => { const h = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(h); }, []);
const now = useMemo(() => Date.now(), [tick]);
```
Pass `snoozedItems` into `selectTriageTop`. Snooze buttons on `FocusCard`
(escalation) call `snoozeItem(e.id, 10*60_000)`; session snooze stays
`snoozeSession`.

---

## Slice C — Operator-gated "only you" mark + deterministic outranking

Outranking already exists (`SEV_GATED_OR_WEDGED` in triageSelectors reads
`operatorGated`). This slice adds the *human action* to SET the mark, persisted
server-side so it survives reload and drives `routeOf` → `'human'`.

**Server store — `src/services/supervisor-store.ts`** (new fn, mirror
`setEscalationRoute` at 828):
```ts
export function setEscalationOperatorGated(id: string, gated: boolean): void {
  const d = openDb();
  d.prepare('UPDATE escalation SET operatorGated = ?, routedTo = CASE WHEN ? THEN ? ELSE routedTo END WHERE id = ?')
    .run(gated ? 1 : 0, gated ? 1 : 0, 'human', id);
}
```
(Gating forces the human floor; un-gating leaves the prior route — re-derivation
is the daemon's job.)

**Route — `src/routes/supervisor-routes.ts`** (after `escalations/resolve`):
```ts
if (url.pathname === '/api/supervisor/escalations/gate' && req.method === 'POST') {
  const { id, gated } = await req.json();
  if (!id || typeof gated !== 'boolean') return jsonError('id and gated are required', 400);
  setEscalationOperatorGated(id, gated);
  const e = getEscalation(id);
  if (e) getWebSocketHandler()?.broadcast({ type: 'escalation_created', project: e.project, session: e.session, kind: e.kind, id, routedTo: e.routedTo, escalation: e });
  return Response.json({ ok: true, operatorGated: gated });
}
```
Add `setEscalationOperatorGated` to the supervisor-store import block (line 1–20).
The re-broadcast flows through `ingestEscalationCreated` (upsert by id) so the
mark lands on every client and the triage stack re-ranks.

**Store — `ui/src/stores/supervisorStore.ts`** (optimistic + confirm-on-ok):
```ts
markOperatorGated: async (serverId, id, gated) => {
  set(s => updateOpenItem(s, id, { operatorGated: gated }));        // optimistic
  const res = await invoke(serverId, '/api/supervisor/escalations/gate', 'POST', { id, gated });
  if (!res?.ok) set(s => updateOpenItem(s, id, { operatorGated: !gated })); // revert
  return !!res?.ok;
},
```
Ensure `Escalation` carries `operatorGated?: boolean | number` (already declared,
line 118).

**UI** — `FocusCard.tsx` + `SessionParagraphCard.tsx`: a small toggle chip
"👤 only you" (filled when `e.operatorGated`) calling
`onToggleGate(serverScope, e.id, !e.operatorGated)`. Wire both in `ZenMode.tsx` to
`markOperatorGated`.

---

## Slice D — Optimistic clear + "sent → X" toast + 5 s undo (reconciled)

For the calm-canvas action buttons (decide / resolve / answer), apply the change
LOCALLY first, show a `sent → <label>` toast with an **Undo** affordance, and only
fire the server call after a 5 s window — reconciled against the existing
confirm-on-ok store actions. Built as a reusable client helper so every zen
action button gets identical UX (mobile-parity: tap → toast → tap-undo, no hover).

**New helper — `ui/src/lib/optimisticAction.ts`**:
```ts
export interface OptimisticArgs {
  label: string;            // toast text → `sent → ${label}`
  apply: () => void;        // optimistic local mutation (e.g. remove card)
  revert: () => void;       // inverse, run on undo
  commit: () => Promise<boolean>; // the confirm-on-ok server call
  delayMs?: number;         // default 5000
  addToast: (t: { type: 'success'; title: string; message?: string; duration: number }) => string;
  removeToast: (id: string) => void;
  onResult?: (ok: boolean) => void;
}
// apply() now; toast w/ duration=delayMs; schedule commit() at delayMs.
// Undo (caller invokes the returned undo()) → cancel timer, revert(), removeToast.
export function runOptimistic(a: OptimisticArgs): { undo: () => void } { /* setTimeout-based */ }
```
The toast itself is rendered via `notificationStore`; the Undo button is wired by
the caller passing an `undo()` into a toast action. NOTE: `notificationStore.Toast`
has no action slot today — extend `Toast` with an optional
`action?: { label: string; onClick: () => void }` and render it wherever toasts
paint (`BridgeDashboard.tsx` toast host or the shared toast renderer). Confirm the
toast host component (grep `useNotificationStore` render site) renders `action`.

**ZenMode wiring**: wrap the focus-card decide/resolve and paragraph-card
answer/skip handlers in `runOptimistic`, with `apply` = optimistic
`updateOpenItem`/local removal, `commit` = the existing `decideEscalation` /
`resolveEscalation` / `nudge` (which already confirm-on-ok server-side — the 5 s
window just defers the network call so an Undo never hits the server). On a failed
`commit`, surface an error toast and `revert`.

---

## Slice E — Threshold tuning via `set_watchdog_threshold` (wire the built UI)

`ThresholdControl.tsx` exists but is orphaned. Add REST GET/POST mirroring the MCP
`set_watchdog_threshold` tool (which calls `supervisorStore.setWatchdogThreshold`),
store actions, and render the control per-project in Zen.

**Route — `src/routes/supervisor-routes.ts`**:
```ts
if (url.pathname === '/api/supervisor/watchdog-threshold' && req.method === 'GET') {
  const project = url.searchParams.get('project');
  if (!project) return jsonError('project is required', 400);
  return Response.json({ project, thresholdPercent: getWatchdogThreshold(project),
    defaultPercent: DEFAULT_WATCHDOG_CONFIG.thresholdPercent });
}
if (url.pathname === '/api/supervisor/watchdog-threshold' && req.method === 'POST') {
  const { project, thresholdPercent } = await req.json();
  if (!project) return jsonError('project is required', 400);
  if (thresholdPercent !== null && (typeof thresholdPercent !== 'number' || thresholdPercent < 1 || thresholdPercent > 100))
    return jsonError('thresholdPercent must be 1-100 or null', 400);
  setWatchdogThreshold(project, thresholdPercent);
  return Response.json({ ok: true, project, thresholdPercent });
}
```
Import `getWatchdogThreshold`, `setWatchdogThreshold` from supervisor-store and
`DEFAULT_WATCHDOG_CONFIG` from `../services/context-watchdog.ts`.

**Store — `ui/src/stores/supervisorStore.ts`**:
- `watchdogThresholds: Record<string, number | null>` (not persisted).
- `loadWatchdogThreshold(serverId, project)` → GET, keep-prior-on-failure, set key.
- `setWatchdogThreshold(serverId, project, value)` → POST; on ok set key to value.

**UI — `ZenMode.tsx`**: render a row of `ThresholdControl` (one per project in
`projectTotals`), passing `threshold={watchdogThresholds[project] ?? null}`,
`onLoad={() => loadWatchdogThreshold('local', project)}`,
`onChange={(v) => setWatchdogThreshold('local', project, v)}`. The component
already debounces commit on blur/Enter and is tap-only.

---

## Slice F — Mobile-parity verification pass

Audit + lock-in (mostly a TEST, plus any small fixes the audit surfaces):
- Grep the zen tree for `onMouseEnter|onMouseOver|onMouseLeave|:hover`-gated
  *content reveal* (Tailwind `hover:` for color is fine; `hover:`/`group-hover`
  that REVEALS data is not). `PaneLinesPopover` already toggles on `onClick` ✓.
- Confirm every action reads from the store (HTTP+WS), no component-local polling
  `setInterval(fetch…)` except the pure 1 Hz `now` ticker added in Slice B.
- Add `ui/src/components/supervisor/zen/__tests__/mobile-parity.test.tsx`: render
  `ZenMode` against a seeded store and assert (a) no element carries an
  `onMouseEnter`/`onMouseOver` handler, (b) the focus card, paragraph cards,
  threshold controls and pills all paint from store state with no network call at
  mount, (c) action buttons are reachable by tap (role=button / onClick present).

---

## Tests

- `ui/src/lib/triageSelectors.test.ts` — extend: snoozed escalation excluded;
  un-snooze (expiry) re-includes; operator-gated escalation outranks a routine one
  AND ties with a wedge by age (reaffirm SEV_GATED_OR_WEDGED).
- `ui/src/lib/optimisticAction.test.ts` (new) — apply-then-commit after delay;
  undo cancels commit + reverts + removes toast; failed commit reverts.
- `src/services/__tests__/session-summary-loop.test.ts` — extend: `refreshSummaryNow`
  bypasses the change-gate (same hash still re-summarizes), broadcasts enriched
  event, returns `in-flight` when `summaryInFlight`, `unknown-session` when absent,
  `capture-failed` on empty pane. Use the `deps` seam (no real tmux/LLM).
- `src/routes/__tests__` (if a supervisor-routes test file exists, extend; else
  cover via the store/service tests) — `escalations/gate` sets operatorGated +
  re-broadcasts; `watchdog-threshold` GET/POST round-trip.

Run UI: `npm run test:ci -- triageSelectors optimisticAction mobile-parity`.
Run backend (bun): `bun test src/services/__tests__/session-summary-loop.test.ts`.
(Dual runner — bun:test files via `bun test`, vitest UI via `test:ci`; backed by
shared SQLite so keep `fileParallelism` off per repo convention.)

## Risks / notes
- `refreshSummaryNow` peer-forward is intentionally local-only this phase
  (returns `peer-unsupported` for remote serverIds) to avoid adding an
  `/api/ide/refresh-summary` surface; the desktop sidecar is the common case.
- `notificationStore.Toast` lacks an action slot — extending it touches the toast
  RENDER site (find via `useNotificationStore` usage). If the renderer is
  third-party/shared, fall back to an in-card inline "Undo" pill rather than a
  toast action (keeps the slice self-contained).
- Operator-gated un-gate deliberately does NOT re-route; the daemon re-derives.

```json
{ "schemaVersion": 1, "estimatedFiles": 11, "estimatedTasks": 6,
  "nonEnumerableFanout": false,
  "filesToCreate": [
    "ui/src/lib/optimisticAction.ts",
    "ui/src/lib/optimisticAction.test.ts",
    "ui/src/components/supervisor/zen/__tests__/mobile-parity.test.tsx"
  ],
  "filesToEdit": [
    "src/services/session-summary-loop.ts",
    "src/routes/supervisor-routes.ts",
    "src/services/supervisor-store.ts",
    "ui/src/stores/supervisorStore.ts",
    "ui/src/stores/notificationStore.ts",
    "ui/src/lib/triageSelectors.ts",
    "ui/src/lib/triageSelectors.test.ts",
    "ui/src/components/supervisor/zen/ZenMode.tsx",
    "ui/src/components/supervisor/zen/SessionParagraphCard.tsx",
    "ui/src/components/supervisor/zen/FocusCard.tsx",
    "src/services/__tests__/session-summary-loop.test.ts"
  ],
  "tasks": [
    { "id": "refresh-summary-now", "files": ["src/services/session-summary-loop.ts", "src/routes/supervisor-routes.ts", "ui/src/stores/supervisorStore.ts", "ui/src/components/supervisor/zen/SessionParagraphCard.tsx", "ui/src/components/supervisor/zen/ZenMode.tsx", "src/services/__tests__/session-summary-loop.test.ts"], "description": "Slice A: out-of-band re-hash/re-summarize export + route + store action + refresh tap button" },
    { "id": "snooze-item", "files": ["ui/src/stores/supervisorStore.ts", "ui/src/lib/triageSelectors.ts", "ui/src/lib/triageSelectors.test.ts", "ui/src/components/supervisor/zen/ZenMode.tsx"], "description": "Slice B: client-side snoozedItems map + selector exclusion + 1Hz re-surface ticker" },
    { "id": "operator-gated-mark", "files": ["src/services/supervisor-store.ts", "src/routes/supervisor-routes.ts", "ui/src/stores/supervisorStore.ts", "ui/src/components/supervisor/zen/FocusCard.tsx", "ui/src/components/supervisor/zen/SessionParagraphCard.tsx", "ui/src/lib/triageSelectors.test.ts"], "description": "Slice C: setEscalationOperatorGated + gate route + optimistic markOperatorGated + 'only you' toggle + outrank test" },
    { "id": "optimistic-clear-undo", "files": ["ui/src/lib/optimisticAction.ts", "ui/src/lib/optimisticAction.test.ts", "ui/src/stores/notificationStore.ts", "ui/src/components/supervisor/zen/ZenMode.tsx"], "description": "Slice D: runOptimistic helper + toast action slot + 5s undo wired into zen action handlers" },
    { "id": "threshold-tuning", "files": ["src/routes/supervisor-routes.ts", "ui/src/stores/supervisorStore.ts", "ui/src/components/supervisor/zen/ZenMode.tsx"], "description": "Slice E: watchdog-threshold GET/POST route + store load/set + wire existing ThresholdControl into Zen" },
    { "id": "mobile-parity-pass", "files": ["ui/src/components/supervisor/zen/__tests__/mobile-parity.test.tsx", "ui/src/components/supervisor/zen/ZenMode.tsx"], "description": "Slice F: audit all zones are tap + HTTP/WS only (no hover-reveal/local poll) + assertion test" }
  ] }
```
