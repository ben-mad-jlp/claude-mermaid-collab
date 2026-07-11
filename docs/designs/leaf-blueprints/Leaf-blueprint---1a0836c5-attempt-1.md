Blueprint written. Emitting the complete blueprint verbatim as required:

---

# Blueprint — Z8: Always-visible paragraph stack + interpreter buttons

**Leaf:** `1a0836c5-f381-4117-9b13-40dd88cad23a`
**Epic:** design-zen-mode, Phase 4 (frontend). Backend (Z2/Z7) and the Zen shell (Z1–Z5) already landed.

## Goal (LOCKED DECISIONS)

Paragraphs are **ALWAYS visible**, not tap-only. Render *every* watched session's
short interpreter paragraph at once, recency-sorted (most recent on top, typically ≤5).
Each card shows: paragraph (first-clause emphasized) + status pill + saturation-by-age +
dual status-dot/refresh-tick + **two** timestamps (`summaryUpdatedAt` vs `paneSeenAt` →
"quiet 3m" vs "⚠ summary refresh failing"). A **PaneLinesPopover** ("show the lines it
read") fetches the raw `capture-pane` on demand (NOT a stream). When `structured.status ===
'needs-input'`, render the interpreter's suggested buttons (`structured.options[]` +
`★recommended` index). Tap→answer mapping: structured **escalation** → `optionId` via
`decideEscalation`; interpreted-**from-pane** → `valueToSend` fed back to the session via
nudge. GUARDRAILS: always show the raw question under the buttons + always keep "Other…"
(a collapsed last-resort free-text). Reuse FocusCard / global Approve-Skip-Snooze cascade.

## What already exists (DO NOT rebuild — reuse)

- **Data pipeline is fully wired.** `session_summary_updated` WS → `useStatusSync.ts:88`
  → `ingestSessionSummary` → `useSupervisorStore.sessionSummaries[`${project}::${session}`]`.
  Each `SessionSummary` (`supervisorStore.ts:245-257`) already carries:
  `progressState, paneSeenAt, updatedAt, snoozedUntil?, summaryText?, firstClause?,
  summaryUpdatedAt?, refreshState?:'fresh'|'stale-failing', structured?:ZenStructured`.
- **`ZenStructured`** (`supervisorStore.ts:232-238`): `{ paragraph; status:'working'|'idle'|'stuck'|'needs-input'; question?; options?:Array<{label;valueToSend}>; recommended?:number(index) }`.
  ⚠ NOTE the shape difference from `Escalation.options` (`{id,label,detail}` + `recommended:string-id`).
  Interpreter options have **no id** and `recommended` is a **numeric index**.
- **Selectors** in `ui/src/lib/triageSelectors.ts` (`selectTriageStack`, `selectTriageTop`,
  `wedgeMinutes`) and `ui/src/lib/freshnessSelectors.ts` (`selectFreshness`, `selectVerdict`, `fmtHHMM`).
- **`FocusCard.tsx`** — escalation decision card; option buttons with `★ recommended`; the
  Land/Dismiss/Resolve fallbacks. Reuse its button styling verbatim for visual consistency.
- **`WedgeFocusCard.tsx`** — wedge/unknown card with Open/Nudge/Kill/Snooze.
- **`ZenMode.tsx`** — composes VerdictBar + CalmCanvas + FocusCard/WedgeFocusCard + two
  PillLists. This is where the new paragraph stack gets inserted.
- **Store actions:** `decideEscalation(serverId,id,optionId)` (`supervisorStore.ts:1015`,
  POST `/api/supervisor/escalation/:id/decide`), `nudge(serverId,project,session,text)`
  (`supervisorStore.ts:854`, POST `/api/supervisor/nudge`), `snoozeSession`, `resolveEscalation`.
- **`nudge`** already feeds arbitrary text into a session's tmux pane → this is the
  `valueToSend` feedback channel for interpreted-from-pane answers. No new store action needed.

## What's missing (this leaf builds)

1. A **per-session paragraph card** component (`SessionParagraphCard.tsx`).
2. A **paragraph stack** (recency-sorted ≤5) rendered in `ZenMode.tsx`.
3. **PaneLinesPopover.tsx** + a **backend on-demand capture-pane endpoint** + a store
   action / fetch helper to call it.
4. A pure selector `selectParagraphStack` (recency sort + cap) in a new `paragraphStack.ts`.
5. The needs-input button block + tap→answer mapping (escalation vs pane) + raw-question
   guardrail + collapsed "Other…" free-text last-resort, inside the card.

---

## Files to create

### 1. `ui/src/lib/paragraphStack.ts` (new pure selector — keeps logic unit-testable)

```ts
import type { SessionSummary } from '@/stores/supervisorStore';

export interface ParagraphCardModel {
  key: string;             // `${project}::${session}`
  project: string;
  session: string;
  summary: SessionSummary;
}

/** Every watched session that has an interpreter paragraph, most-recent first.
 *  Recency = max(summaryUpdatedAt, paneSeenAt, updatedAt). Capped at `cap` (≤5). */
export function selectParagraphStack(
  sessionSummaries: Record<string, SessionSummary>,
  cap = 5,
): ParagraphCardModel[] {
  return Object.entries(sessionSummaries)
    .filter(([, s]) => !!(s.structured?.paragraph || s.summaryText))
    .map(([key, s]) => ({ key, project: s.project, session: s.session, summary: s }))
    .sort((a, b) => recency(b.summary) - recency(a.summary))
    .slice(0, cap);
}

function recency(s: SessionSummary): number {
  return Math.max(s.summaryUpdatedAt ?? 0, s.paneSeenAt ?? 0, s.updatedAt ?? 0);
}

/** Saturation-by-age opacity bucket. Fresh→full; older→progressively muted.
 *  Drives a Tailwind opacity class on the card. */
export function ageOpacityClass(summaryUpdatedAt: number | undefined, now: number): string {
  const age = summaryUpdatedAt ? now - summaryUpdatedAt : Infinity;
  if (age < 60_000) return 'opacity-100';
  if (age < 5 * 60_000) return 'opacity-90';
  if (age < 15 * 60_000) return 'opacity-75';
  return 'opacity-60';
}

/** Two-timestamp readout. summaryUpdatedAt drifting far behind paneSeenAt ⇒ the
 *  interpreter is failing to refresh on a moving pane. */
export interface FreshnessReadout { label: string; failing: boolean; }
export function summaryFreshness(s: SessionSummary, now: number): FreshnessReadout {
  if (s.refreshState === 'stale-failing') return { label: '⚠ summary refresh failing', failing: true };
  const seen = s.summaryUpdatedAt ?? s.updatedAt ?? 0;
  const mins = seen ? Math.max(0, Math.floor((now - seen) / 60_000)) : 0;
  // Pane moving but summary stuck well behind → also failing.
  if (s.paneSeenAt && s.summaryUpdatedAt && s.paneSeenAt - s.summaryUpdatedAt > 3 * 60_000)
    return { label: '⚠ summary refresh failing', failing: true };
  return { label: `quiet ${mins}m`, failing: false };
}
```

### 2. `ui/src/components/supervisor/zen/PaneLinesPopover.tsx` (new)

- Collapsed trigger: a small text button "show the lines it read".
- On click: calls `onFetch(project, session)` (passed from card) returning `Promise<string>`,
  sets local state `{ loading, lines, error }`, renders a `<pre>` of the raw pane in an
  absolutely-positioned popover panel (Tailwind: `absolute z-20 mt-1 max-h-64 overflow-auto
  rounded border bg-gray-900 text-gray-100 text-3xs font-mono whitespace-pre p-2 shadow-lg`).
- Re-fetches each open (NOT a stream); "Refresh" link inside re-invokes `onFetch`.
- Props: `{ project: string; session: string; onFetch: (p,s)=>Promise<string> }`.

### 3. `ui/src/components/supervisor/zen/SessionParagraphCard.tsx` (new — the core component)

Props:
```ts
export interface SessionParagraphCardProps {
  summary: SessionSummary;
  now: number;
  serverId: string;
  /** open escalation for THIS session, if any — drives structured→optionId path */
  escalation?: Escalation | null;
  onDecideEscalation: (serverId: string, id: string, optionId: string) => void;
  onAnswerPane: (serverId: string, project: string, session: string, value: string) => void;
  onResolve: (serverId: string, id: string, status: string) => void;   // global fallback
  onSnooze: (project: string, session: string) => void;                  // global fallback
  onFetchPane: (project: string, session: string) => Promise<string>;
}
```

Render shape (reuse FocusCard's classes for the card shell + buttons):
1. Card shell `rounded-lg border bg-white dark:bg-gray-800 p-4 space-y-2` + `ageOpacityClass(...)`
   from `paragraphStack.ts` + `transition-opacity duration-500`.
2. Header row: session name (`session.split('/').pop()`) + **status pill** (map
   `structured.status`→tone, table below) + **dual indicator**: `<FreshnessPulse live={!failing}/>`
   (refresh-tick) next to the structural status dot (reuse SessionPill's `PROGRESS_DOT` idea).
3. Paragraph: `firstClause` (or first sentence of `structured.paragraph`) in
   `font-medium text-gray-900 dark:text-gray-100`, remainder in
   `text-gray-600 dark:text-gray-300 text-sm leading-snug whitespace-pre-wrap`.
4. **Two timestamps**: `summaryFreshness(summary, now).label` (e.g. "quiet 3m" or
   "⚠ summary refresh failing", amber/danger when `failing`) — title attr shows both
   `fmtHHMM(summaryUpdatedAt)` and `fmtHHMM(paneSeenAt)`.
5. `<PaneLinesPopover project session onFetch={onFetchPane}/>`.
6. **Needs-input block** — render ONLY when `structured?.status === 'needs-input'`:
   - **Raw question (guardrail, ALWAYS shown above buttons)**: `structured.question ??
     'Waiting for input'` in `text-sm text-gray-800 dark:text-gray-200`.
   - **Buttons** — branch by source:
     - **If `escalation` present** (structured escalation): render `escalation.options`,
       `★ recommended` = `escalation.recommended === opt.id`; onClick →
       `onDecideEscalation(serverId, escalation.id, opt.id)`. (Identical to FocusCard.)
     - **Else if `structured.options?.length`** (interpreted-from-pane): render
       `structured.options`, `★ recommended` = `i === structured.recommended`; onClick →
       `onAnswerPane(serverId, project, session, opt.valueToSend)`.
   - **"Other…" guardrail (ALWAYS, collapsed last-resort)**: a small toggle "Other…" that
     expands an `<input>`/`<textarea>` + Send. Send → if `escalation` → it has no free-text
     option path, so route to `onAnswerPane` (nudge the session text) as the universal
     last-resort; else `onAnswerPane(...)`. (Free text always feeds the pane via nudge —
     the session reads the human's reply directly.)
   - **Global fallback cascade (ALWAYS available under Other…)**: small Approve / Skip /
     Snooze row. Approve→ if `escalation` & recommended exists → decide recommended; else
     `onAnswerPane(...,'yes')`. Skip→ `onResolve(serverId, escalation.id,'resolved')` when
     escalation present, else `onSnooze`. Snooze→ `onSnooze(project, session)`. Mirror the
     muted gray button styling from WedgeFocusCard.

Status→pill tone table (Tailwind, mirror existing palette):
```ts
const STATUS_PILL: Record<ZenStructured['status'], {dot:string;text:string;label:string}> = {
  working:      { dot:'bg-success-500', text:'text-success-700 dark:text-success-400', label:'working' },
  idle:         { dot:'bg-gray-400',    text:'text-gray-500 dark:text-gray-400',       label:'idle' },
  stuck:        { dot:'bg-danger-500',  text:'text-danger-700 dark:text-danger-400',   label:'stuck' },
  'needs-input':{ dot:'bg-warning-500', text:'text-warning-700 dark:text-warning-400', label:'needs input' },
};
```

---

## Files to edit

### 4. `ui/src/components/supervisor/zen/ZenMode.tsx`

- Import `selectParagraphStack` and `SessionParagraphCard`.
- After the focus card block (line ~93) and BEFORE the "Projects" PillList, insert a new
  always-visible paragraph stack section:
  ```tsx
  const paragraphStack = useMemo(
    () => selectParagraphStack(sessionSummaries, 5),
    [sessionSummaries],
  );
  ...
  {paragraphStack.length > 0 && (
    <div className="space-y-2">
      <div className="text-3xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Watched sessions</div>
      <div className="space-y-2">
        {paragraphStack.map((m) => (
          <SessionParagraphCard
            key={m.key}
            summary={m.summary}
            now={now}
            serverId={serverFor(m.project, m.session)}
            escalation={openEscalations.find(e => e.project === m.project && e.session === m.session && e.status === 'open') ?? null}
            onDecideEscalation={(sid,id,opt) => void decideEscalation(sid,id,opt)}
            onAnswerPane={(sid,p,s,v) => void nudge(sid,p,s,v)}
            onResolve={(sid,id,st) => void resolveEscalation(sid,id,st)}
            onSnooze={(p,s) => snoozeSession(p,s, Date.now() + 10*60_000)}
            onFetchPane={(p,s) => useSupervisorStore.getState().capturePane(serverFor(p,s), p, s)}
          />
        ))}
      </div>
    </div>
  )}
  ```
- Wrap the stack in the same desaturation treatment as PillList when `!freshness.live`
  (add `grayscale opacity-60` conditional) for consistency with Z5.

### 5. `ui/src/stores/supervisorStore.ts`

- Add to `SupervisorState` interface (near `nudge`, line ~496): 
  `capturePane: (serverId: string, project: string, session: string) => Promise<string>;`
- Implement (near `nudge`, line ~857):
  ```ts
  capturePane: async (serverId, project, session) => {
    const res = await invoke(serverId, '/api/supervisor/capture-pane', 'POST', { project, session });
    return typeof res?.body?.lines === 'string' ? res.body.lines : (res?.body?.lines ?? '');
  },
  ```
  (Match the actual `invoke` return shape used by sibling actions — see how `loadConfig`
  reads `res.body`; mirror exactly.)

### 6. `src/routes/supervisor-routes.ts` — new on-demand capture-pane endpoint

Add alongside the nudge route (line ~470). Mirrors nudge's peer/local branch but reads
instead of writes:
```ts
if (url.pathname === '/api/supervisor/capture-pane' && req.method === 'POST') {
  try {
    const { project, session, serverId } = await req.json() as { project?: string; session?: string; serverId?: string };
    if (!project || !session) return jsonError('project and session are required', 400);
    if (serverId && getPeer(serverId)) {
      const peer = getPeer(serverId)!;
      const res = await fetch(peer.baseUrl + '/api/ide/capture-pane', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, session }),
      });
      return Response.json(await res.json());
    }
    const lines = await capturePaneText(project, session); // helper, below
    return Response.json({ lines });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
  }
}
```

### 7. `src/routes/ide-routes.ts` — local capture-pane handler (peer target + same-server)

Add a `/api/ide/capture-pane` POST handler near `tmux-send-keys` (line ~116) that resolves
the tmux name with `tmuxBaseName(launchProject ?? project, session)` (use
`getSupervisedLaunchProject` like the launch path if needed) and runs the capture. Factor a
shared helper rather than duplicating Bun.spawn:

```ts
// in a small shared module e.g. src/services/tmux-capture.ts (NEW) OR reuse session-mux:
import { mux } from './session-mux/index.ts';
import { argvCapturePane } from './session-mux/tmux-argv.ts';
import { tmuxBaseName } from './tmux-naming.js';
export async function capturePaneText(project: string, session: string, scrollback = 100): Promise<string> {
  const name = tmuxBaseName(project, session);
  const proc = Bun.spawn(mux.cmd(argvCapturePane(name, scrollback)), { stdout: 'pipe', stderr: 'ignore' });
  const [out] = await Promise.all([proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(''), proc.exited]);
  return out;
}
```
This mirrors `session-summary-loop.ts:168 capturePaneLocal` exactly (kept decoupled there;
this is the shared, route-callable version). Both supervisor-routes and ide-routes import it.

> Decision: create `src/services/tmux-capture.ts` (one new shared helper) rather than
> exporting `capturePaneLocal` from the loop module — keeps the loop's internal helper
> private and gives routes a clean, named import. Counts as 1 created file.

---

## Tests to add (vitest, mirror existing `*.test.ts` in `ui/src/lib/`)

- `ui/src/lib/paragraphStack.test.ts`: recency sort (summaryUpdatedAt vs paneSeenAt vs
  updatedAt max), ≤5 cap, filter-out sessions with no paragraph, `ageOpacityClass`
  buckets, `summaryFreshness` ("quiet Nm" vs "⚠ summary refresh failing" via refreshState
  AND via paneSeenAt-summaryUpdatedAt>3m drift).
- (Optional, if component tests exist in repo) a render test for `SessionParagraphCard`
  asserting: paragraph always visible; needs-input buttons appear only on `needs-input`;
  raw question always under buttons; "Other…" present; escalation path calls
  onDecideEscalation with `opt.id`; pane path calls onAnswerPane with `opt.valueToSend`.

## Verification

- `npm run test:ci -- paragraphStack` (and any component test added).
- Type-check: this is a Bun-managed `ui/` — do NOT `npm install`; run the repo's tsc/build
  task. Backend route compiles with `bun` typecheck path.
- Manual: open Zen mode, confirm every watched session's paragraph renders recency-sorted,
  two timestamps render, "show the lines it read" fetches raw pane, a needs-input session
  shows interpreter buttons + raw question + Other… + Approve/Skip/Snooze.

## Risks / notes

- `ZenStructured.options` have **no id** and `recommended` is a numeric index — the pane
  path must NOT be fed into `decideEscalation` (which expects an option id). Keep the two
  branches strictly separate (escalation→`decideEscalation(opt.id)`; pane→`nudge(valueToSend)`).
- The "Other…" free-text and the Approve fallback for a pane-session both route through
  `nudge` (feed text to the pane). For an escalation, Skip→`resolveEscalation`.
- Saturation/desaturation must not fight Z5's whole-page desaturate-on-WS-drop; the card's
  per-age opacity is independent and composes (both are opacity multipliers — fine).
- `serverFor` already exists in ZenMode; reuse it for the per-card serverId and pane fetch.

```json
{ "schemaVersion": 1, "estimatedFiles": 7, "estimatedTasks": 7,
  "nonEnumerableFanout": false,
  "filesToCreate": [
    "ui/src/lib/paragraphStack.ts",
    "ui/src/lib/paragraphStack.test.ts",
    "ui/src/components/supervisor/zen/PaneLinesPopover.tsx",
    "ui/src/components/supervisor/zen/SessionParagraphCard.tsx",
    "src/services/tmux-capture.ts"
  ],
  "filesToEdit": [
    "ui/src/components/supervisor/zen/ZenMode.tsx",
    "ui/src/stores/supervisorStore.ts",
    "src/routes/supervisor-routes.ts",
    "src/routes/ide-routes.ts"
  ],
  "tasks": [
    { "id": "paragraph-stack-selector", "files": ["ui/src/lib/paragraphStack.ts", "ui/src/lib/paragraphStack.test.ts"], "description": "Pure selector: recency-sorted ≤5 paragraph stack + ageOpacityClass + two-timestamp summaryFreshness, with unit tests" },
    { "id": "pane-lines-popover", "files": ["ui/src/components/supervisor/zen/PaneLinesPopover.tsx"], "description": "Collapsed 'show the lines it read' popover that fetches raw capture-pane on demand (not a stream)" },
    { "id": "session-paragraph-card", "files": ["ui/src/components/supervisor/zen/SessionParagraphCard.tsx"], "description": "Per-session card: always-visible paragraph + status pill + saturation + dual dot/tick + two timestamps + needs-input buttons (escalation→optionId vs pane→valueToSend) + raw-question + Other… + Approve/Skip/Snooze fallback" },
    { "id": "zenmode-stack-wiring", "files": ["ui/src/components/supervisor/zen/ZenMode.tsx"], "description": "Render the always-visible paragraph stack section, wire decide/nudge/resolve/snooze/capturePane handlers and freshness desaturation" },
    { "id": "store-capture-pane-action", "files": ["ui/src/stores/supervisorStore.ts"], "description": "Add capturePane(serverId,project,session) store action hitting /api/supervisor/capture-pane" },
    { "id": "supervisor-capture-route", "files": ["src/routes/supervisor-routes.ts"], "description": "POST /api/supervisor/capture-pane with peer-forward + local branch (mirrors nudge)" },
    { "id": "ide-capture-route-and-helper", "files": ["src/routes/ide-routes.ts", "src/services/tmux-capture.ts"], "description": "Shared capturePaneText helper + POST /api/ide/capture-pane peer-target handler" }
  ] }
```