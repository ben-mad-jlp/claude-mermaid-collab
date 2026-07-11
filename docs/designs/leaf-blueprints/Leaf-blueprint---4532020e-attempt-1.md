Blueprint written. Full text below.

---

# Blueprint — Z3: Triage + wedge promotion wiring

**Leaf:** `4532020e-54a6-4b47-9a56-d3a14f64a616`
**Epic:** design-zen-mode (Phase 2 frontend)
**Depends on:** Z1 (Zen shell — `ZenMode`/`VerdictBar`/`FocusCard`/`SessionPill` exist) and Z2 (server `session-summary-loop.ts` emitting `session_summary_updated`).

## Goal

Wire the frontend so the Zen view turns the server's structural heartbeat
(`session_summary_updated`) into:

1. a **`sessionSummaries` store slice** (mirrors the WS event),
2. a **`useStatusSync` handler** for the new event (mirrors `escalation_created` / `session_todos_updated`),
3. a **`selectTriageStack` selector** that merges open escalations + decisions + synthesized wedged items + unknown-liveness soft items, sorted **severity-then-age**,
4. **wedge promotion** into the FocusCard slot (a new `WedgeFocusCard`), and
5. **amber/red session pills** for `stalled` / `wedged`.

**Hard ordering invariant (Z4 will test):** an `operatorGated` escalation AND a
`wedged` session BOTH outrank routine approvals/decisions. Encode this as an
explicit numeric severity tier, not as incidental sort order.

---

## Ground truth (what already exists)

- **WS event shape** (`src/services/session-summary-loop.ts:196/218/291`):
  ```ts
  { type: 'session_summary_updated', project, session, progressState, paneSeenAt, updatedAt }
  ```
  `progressState: 'active' | 'quiet' | 'stalled' | 'wedged' | 'unknown'`. No text summary yet (later phase).
- **`Escalation`** (`ui/src/stores/supervisorStore.ts:89-135`): already ONE slice
  (`openEscalations`) carrying `options` / `recommended` / `routedTo` / `kind` /
  `createdAt`. It does **NOT** yet declare `operatorGated`, but the server
  serializes it: `mapEscalationRow` (`src/services/supervisor-store.ts:489`)
  spreads `...rest` which includes the `operatorGated` column (`0|1`, see
  `supervisor-store.ts:114/193`). So the field arrives on the wire — the UI type
  just needs to declare it.
- **`useStatusSync`** (`ui/src/hooks/useStatusSync.ts`): the single status-refresh
  owner. Switch dispatcher at L63 handles `escalation_created`,
  `session_todos_updated`, `orchestrator_tick`. New case slots in here.
- **`ZenMode`** (`ui/src/components/supervisor/zen/ZenMode.tsx`): currently uses
  `openEscalations[0]` as the FocusCard. Zone 2 maps `SubscribedSession[]` (from
  `subscriptionStore`, keyed `serverId:project:session`) to `SessionPill`.
- **`SubscribedSession`** (`ui/src/stores/subscriptionStore.ts:4`): has
  `project`, `session`, `serverId`, `status`, `stale`.
- **`SessionPill`** (`.../zen/SessionPill.tsx`): renders a dot + label from
  `STATUS_DOT/STATUS_LABEL/STATUS_TEXT` keyed on `session.status`. No progress tint yet.
- **`FocusCard`** (`.../zen/FocusCard.tsx`): escalation-only; `onDecide/onResolve/onLand`.
- **`nudge`** store action exists (`supervisorStore.ts:781`, POST `/api/supervisor/nudge`).
  **No kill-session REST endpoint exists** (verified) — see Kill note below.

---

## Change set

### Task `store-slice` — `ui/src/stores/supervisorStore.ts` (EDIT)

1. **Export a `ProgressState` type** (mirror the server union — do NOT import from
   `src/`, the UI is a separate build):
   ```ts
   export type ProgressState = 'active' | 'quiet' | 'stalled' | 'wedged' | 'unknown';
   ```

2. **Add `operatorGated` to `Escalation`** (after `routedTo`, ~L114):
   ```ts
   /** Server-stamped operator-gate flag (irreversible/outward action). Arrives as
    *  0|1 from mapEscalationRow's column spread; truthy = a hard human floor that
    *  MUST outrank routine approvals in the Zen triage stack (Z3/Z4). */
   operatorGated?: boolean | number;
   ```

3. **Add a `SessionSummary` interface** (near the other read-model interfaces):
   ```ts
   /** Z3: mirror of the server session-summary heartbeat (session-summary-loop.ts).
    *  Keyed `${project}::${session}`. LIVE signal — NOT persisted to localStorage
    *  (a hydrated stale value would falsely read as wedged on first paint, same
    *  rationale as `liveness`). `snoozedUntil` is a LOCAL-only suppression set by
    *  the Zen wedge card's Snooze button — never sent by the server. */
   export interface SessionSummary {
     project: string;
     session: string;
     progressState: ProgressState;
     paneSeenAt: number;
     updatedAt: number;
     snoozedUntil?: number;
   }
   ```

4. **Add to `SupervisorState`** (interface + initial value + actions):
   ```ts
   sessionSummaries: Record<string, SessionSummary>;   // key `${project}::${session}`
   /** Fold a `session_summary_updated` WS event into the map (upsert by key).
    *  Preserves any local `snoozedUntil` already set for that key. */
   ingestSessionSummary: (s: {
     project: string; session: string; progressState: ProgressState;
     paneSeenAt: number; updatedAt: number;
   }) => void;
   /** Locally snooze a session out of the triage stack until `untilMs`. */
   snoozeSession: (project: string, session: string, untilMs: number) => void;
   ```
   Initial value: `sessionSummaries: {},` (NOT hydrated from localStorage).
   Implementations:
   ```ts
   ingestSessionSummary: (s) =>
     set((state) => {
       const key = `${s.project}::${s.session}`;
       const prev = state.sessionSummaries[key];
       return {
         sessionSummaries: {
           ...state.sessionSummaries,
           [key]: { ...s, snoozedUntil: prev?.snoozedUntil },
         },
       };
     }),
   snoozeSession: (project, session, untilMs) =>
     set((state) => {
       const key = `${project}::${session}`;
       const prev = state.sessionSummaries[key];
       if (!prev) return {};
       return { sessionSummaries: { ...state.sessionSummaries, [key]: { ...prev, snoozedUntil: untilMs } } };
     }),
   ```

### Task `ws-handler` — `ui/src/hooks/useStatusSync.ts` (EDIT)

Add a case to the dispatcher switch (after `session_todos_updated`, before
`orchestrator_tick`). Mirror the existing narrow-and-guard style; no REST reload —
the WS payload is complete:
```ts
case 'session_summary_updated': {
  const m = msg as {
    project?: unknown; session?: unknown; progressState?: unknown;
    paneSeenAt?: unknown; updatedAt?: unknown;
  };
  if (typeof m.project !== 'string' || typeof m.session !== 'string') break;
  if (typeof m.progressState !== 'string') break;
  useSupervisorStore.getState().ingestSessionSummary({
    project: m.project,
    session: m.session,
    progressState: m.progressState as ProgressState,
    paneSeenAt: typeof m.paneSeenAt === 'number' ? m.paneSeenAt : Date.now(),
    updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
  });
  break;
}
```
Import `type ProgressState` alongside the existing `type Escalation` import from
`@/stores/supervisorStore`. Update the file's doc comment (the "(A) WS ingest"
bullets) to list `session_summary_updated → ingestSessionSummary`.

### Task `triage-selectors` — `ui/src/lib/triageSelectors.ts` (CREATE)

Pure, testable (Z4 imports these). No React, no store reads — takes plain inputs +
`now`.
```ts
import type { Escalation, SessionSummary } from '@/stores/supervisorStore';

export type TriageItem =
  | { kind: 'escalation'; severity: number; since: number; escalation: Escalation }
  | { kind: 'wedge';      severity: number; since: number; summary: SessionSummary }
  | { kind: 'unknown';    severity: number; since: number; summary: SessionSummary };

// Severity tiers — HIGHER = more urgent. The load-bearing invariant (Z4):
// operatorGated escalations AND wedged sessions share the TOP tier, strictly
// above routine approvals/decisions.
export const SEV_GATED_OR_WEDGED = 3; // operatorGated escalation | wedged session
export const SEV_ROUTINE        = 2; // any other open escalation (approval/decision/etc.)
export const SEV_UNKNOWN_SOFT   = 1; // unknown-liveness session

export function escalationSeverity(e: Escalation): number {
  return e.operatorGated ? SEV_GATED_OR_WEDGED : SEV_ROUTINE;
}

/** Build the merged triage stack. Sorted by severity DESC, then age ASC
 *  (oldest `since` first within a tier). Snoozed sessions are excluded. */
export function selectTriageStack(
  openEscalations: Escalation[],
  sessionSummaries: Record<string, SessionSummary>,
  now: number,
): TriageItem[] {
  const items: TriageItem[] = [];

  for (const e of openEscalations) {
    if (e.status !== 'open') continue;
    items.push({ kind: 'escalation', severity: escalationSeverity(e), since: e.createdAt, escalation: e });
  }

  for (const s of Object.values(sessionSummaries)) {
    if (s.snoozedUntil && now < s.snoozedUntil) continue; // snoozed → out
    if (s.progressState === 'wedged') {
      items.push({ kind: 'wedge', severity: SEV_GATED_OR_WEDGED, since: s.paneSeenAt, summary: s });
    } else if (s.progressState === 'unknown') {
      items.push({ kind: 'unknown', severity: SEV_UNKNOWN_SOFT, since: s.paneSeenAt, summary: s });
    }
    // active/quiet/stalled do NOT enter the stack — stalled only tints the pill amber.
  }

  return items.sort((a, b) => (b.severity - a.severity) || (a.since - b.since));
}

export function selectTriageTop(
  openEscalations: Escalation[],
  sessionSummaries: Record<string, SessionSummary>,
  now: number,
): TriageItem | null {
  return selectTriageStack(openEscalations, sessionSummaries, now)[0] ?? null;
}

/** Minutes of no-progress for a wedged/unknown session, for the card label. */
export function wedgeMinutes(summary: SessionSummary, now: number): number {
  return Math.max(0, Math.floor((now - summary.paneSeenAt) / 60_000));
}
```
**Note for Z4:** the canonical ordering test file (`triageSelectors.test.ts`)
belongs to Z4 — do NOT create it here to avoid a merge collision.

### Task `wedge-focus-card` — `ui/src/components/supervisor/zen/WedgeFocusCard.tsx` (CREATE)

Sibling of `FocusCard`; same outer card treatment. `data-testid="focus-card"` is
already taken by FocusCard — use `data-testid="wedge-focus-card"`. Renders
`Session {name} — no progress {Nm}` with four actions:
```tsx
import React from 'react';
import type { SessionSummary } from '@/stores/supervisorStore';
import { wedgeMinutes } from '@/lib/triageSelectors';

export interface WedgeFocusCardProps {
  summary: SessionSummary;
  now: number;
  onOpen: (project: string, session: string) => void;
  onNudge: (project: string, session: string) => void;
  onKill: (project: string, session: string) => void;
  onSnooze: (project: string, session: string) => void;
}

export const WedgeFocusCard: React.FC<WedgeFocusCardProps> = ({
  summary, now, onOpen, onNudge, onKill, onSnooze,
}) => {
  const name = summary.session.split('/').pop() || summary.session;
  const mins = wedgeMinutes(summary, now);
  return (
    <div
      data-testid="wedge-focus-card"
      className="rounded-lg border border-danger-300 dark:border-danger-700 bg-white dark:bg-gray-800 p-4 space-y-3"
    >
      <div className="text-3xs font-semibold tracking-wide text-danger-600 dark:text-danger-400 uppercase">
        ⚠ No progress
      </div>
      <div className="text-sm leading-snug text-gray-800 dark:text-gray-200">
        Session <span className="font-medium">{name}</span> — no progress {mins}m
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={() => onOpen(summary.project, summary.session)}
          className="px-3 py-1.5 text-sm font-medium rounded bg-accent-600 text-white hover:bg-accent-700">Open</button>
        <button type="button" onClick={() => onNudge(summary.project, summary.session)}
          className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">Nudge</button>
        <button type="button" onClick={() => onKill(summary.project, summary.session)}
          className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">Kill</button>
        <button type="button" onClick={() => onSnooze(summary.project, summary.session)}
          className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">Snooze</button>
      </div>
    </div>
  );
};

export default WedgeFocusCard;
```

### Task `session-pill-colors` — `ui/src/components/supervisor/zen/SessionPill.tsx` (EDIT)

Add an optional `progressState?: ProgressState` prop. When it is `'stalled'` →
amber dot/text + label "stalled"; `'wedged'` → red (danger) dot/text + label "no
progress". Otherwise fall back to the existing `status`-keyed maps (unchanged).
```tsx
import type { ProgressState } from '@/stores/supervisorStore';
// ...
export interface SessionPillProps {
  session: SubscribedSession;
  progressState?: ProgressState;
}
const PROGRESS_DOT: Partial<Record<ProgressState, string>> = {
  stalled: 'bg-warning-500 dark:bg-warning-400',
  wedged:  'bg-danger-500 dark:bg-danger-400',
};
const PROGRESS_TEXT: Partial<Record<ProgressState, string>> = {
  stalled: 'text-warning-700 dark:text-warning-400',
  wedged:  'text-danger-700 dark:text-danger-400',
};
const PROGRESS_LABEL: Partial<Record<ProgressState, string>> = {
  stalled: 'stalled',
  wedged:  'no progress',
};
```
In the body, prefer the progress overrides when present:
```tsx
const dotClass  = (progressState && PROGRESS_DOT[progressState])   ?? STATUS_DOT[session.status];
const textClass = (progressState && PROGRESS_TEXT[progressState])  ?? STATUS_TEXT[session.status];
const label     = (progressState && PROGRESS_LABEL[progressState]) ?? STATUS_LABEL[session.status];
```
Only `stalled`/`wedged` are mapped; `active`/`quiet`/`unknown` progress states
fall through to the status maps (no visual change), so the pill never regresses.

### Task `zen-wiring` — `ui/src/components/supervisor/zen/ZenMode.tsx` (EDIT)

1. Read the new slice + the actions:
   ```ts
   const sessionSummaries = useSupervisorStore((s) => s.sessionSummaries);
   const snoozeSession     = useSupervisorStore((s) => s.snoozeSession);
   const nudge             = useSupervisorStore((s) => s.nudge);
   ```
2. Compute the triage top (replace the `openEscalations[0]` focus):
   ```ts
   const now = Date.now();
   const triageTop = useMemo(
     () => selectTriageTop(openEscalations, sessionSummaries, now),
     [openEscalations, sessionSummaries, now],
   );
   ```
   (`now` recomputes each render; re-renders are driven by WS ingests, which is
   adequate cadence for the minutes label.)
3. Render the focus slot off the `triageTop` discriminant:
   ```tsx
   {triageTop?.kind === 'escalation' && (
     <FocusCard escalation={triageTop.escalation}
       serverScope={triageTop.escalation.serverId ?? 'local'}
       onDecide={(sid,id,o)=>void decideEscalation(sid,id,o)}
       onResolve={(sid,id,st)=>void resolveEscalation(sid,id,st)}
       onLand={(sid,p,id)=>void landEpic(sid,p,id)} />
   )}
   {(triageTop?.kind === 'wedge' || triageTop?.kind === 'unknown') && (
     <WedgeFocusCard summary={triageTop.summary} now={now}
       onOpen={handleOpenSession}
       onNudge={(p,s)=>void nudge(serverFor(p,s), p, s, 'Are you stuck? Reply with status or next step.')}
       onKill={handleKillSession}
       onSnooze={(p,s)=>snoozeSession(p, s, Date.now() + 10*60_000)} />
   )}
   ```
   - **Server scope (`serverFor`)** for nudge: the summary has no `serverId`;
     recover it from the Zone-2 `sessions` list —
     `sessions.find(x => x.project===p && x.session===s)?.serverId ?? 'local'`.
   - **`handleOpenSession`:** wire to the existing session-jump path — set the
     active session via `useSessionStore`/`pendingJump`
     (`ui/src/stores/pendingJump.ts`) the same way the Bridge opens a session; if
     no jump helper is in scope, leave a thin callback that selects the session in
     `subscriptionStore`/`uiStore`.
   - **`handleKillSession`:** **No kill REST endpoint exists today.** For Z3 wire
     it as a best-effort placeholder (`console.warn('kill not yet wired')`) and
     leave a `// TODO(zen): backend kill route` — do NOT invent an endpoint. The
     button stays for layout parity; killing is a follow-up leaf. Note this in the PR.
4. Pass `progressState` into each `SessionPill` from the summary map:
   ```tsx
   {sessions.map((s) => (
     <SessionPill key={`${s.serverId}:${s.project}:${s.session}`} session={s}
       progressState={sessionSummaries[`${s.project}::${s.session}`]?.progressState} />
   ))}
   ```
   This makes stalled pills amber and wedged pills red.
5. Imports: `selectTriageTop` from `@/lib/triageSelectors`, `WedgeFocusCard` from
   `./WedgeFocusCard`.

---

## Acceptance / sanity

- `npm run test:ci` (UI) green; `tsc` clean.
- A `session_summary_updated` WS event upserts `sessionSummaries[key]` (verify in
  the store; Z4 owns the selector ordering tests).
- With one `operatorGated` escalation and one routine approval, `selectTriageTop`
  returns the gated one. With a `wedged` session and a routine approval, the
  wedge outranks the approval. (Z4 formalizes these.)
- Snoozing a wedged session removes it from the stack until the snooze expires.
- Stalled session → amber pill; wedged → red pill + promoted into the focus slot.

## Risks / notes

- **Kill has no backend** — explicitly out of scope; render placeholder + TODO.
- `operatorGated` arrives as `0|1`; the selector uses truthiness, so both
  `boolean` and `number` work — declare the type `boolean | number`.
- `sessionSummaries` is deliberately NOT persisted (live signal); do not add it to
  the `hydrate(...)` set or a localStorage key.
- Keep `VerdictBar` as-is (Z1 scope: escalation/WS-only) — not part of Z3.
- Do not import server `ProgressState` from `src/`; redeclare the union in the UI.

```json
{ "schemaVersion": 1, "estimatedFiles": 6, "estimatedTasks": 6,
  "nonEnumerableFanout": false,
  "filesToCreate": ["ui/src/lib/triageSelectors.ts", "ui/src/components/supervisor/zen/WedgeFocusCard.tsx"],
  "filesToEdit": ["ui/src/stores/supervisorStore.ts", "ui/src/hooks/useStatusSync.ts", "ui/src/components/supervisor/zen/SessionPill.tsx", "ui/src/components/supervisor/zen/ZenMode.tsx"],
  "tasks": [
    { "id": "store-slice", "files": ["ui/src/stores/supervisorStore.ts"], "description": "Add ProgressState + SessionSummary, sessionSummaries slice + ingestSessionSummary/snoozeSession, operatorGated on Escalation" },
    { "id": "ws-handler", "files": ["ui/src/hooks/useStatusSync.ts"], "description": "Dispatch session_summary_updated -> ingestSessionSummary (mirror existing cases)" },
    { "id": "triage-selectors", "files": ["ui/src/lib/triageSelectors.ts"], "description": "selectTriageStack/selectTriageTop with severity tiers (gated|wedged > routine > unknown), age tiebreak, snooze filter, wedgeMinutes" },
    { "id": "wedge-focus-card", "files": ["ui/src/components/supervisor/zen/WedgeFocusCard.tsx"], "description": "WedgeFocusCard: 'Session X - no progress Nm' with Open/Nudge/Kill/Snooze" },
    { "id": "session-pill-colors", "files": ["ui/src/components/supervisor/zen/SessionPill.tsx"], "description": "Optional progressState prop -> amber(stalled)/red(wedged) dot+text+label override" },
    { "id": "zen-wiring", "files": ["ui/src/components/supervisor/zen/ZenMode.tsx"], "description": "Compute triageTop, render FocusCard|WedgeFocusCard, pass progressState to pills, wire nudge/snooze/open (kill=placeholder)" }
  ] }
```