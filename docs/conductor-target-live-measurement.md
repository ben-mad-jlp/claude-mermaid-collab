# Live measurement: conductor-target pin against the deployed app

Measured the shipped conductor-target-pin feature (`src/services/conductor-pass.ts`,
`src/services/supervisor-store.ts`, `src/routes/supervisor-routes.ts:896-934`) live against the
running desktop sidecar (`mc-server`, pid 14102, port 9002) on **2026-07-18, 23:04–23:09 CDT**.
Repo state at measurement time: local worktree HEAD `2356225d`; `master` tip `0686208b`
("collab: three mission hygiene fixes …"). The live server's `deploy-status` reported
`liveVersion`/`repoVersion` both `6.18.2` and `repoHead: 0686208b`, `stale: false` — i.e. the
running binary already matched `master` before this measurement began.

## Setup

- **Project measured:** `/Users/benmaderazo/Code/claude-mermaid-collab` (the only watched
  project with an actionable mission at measurement time — see Findings).
- **Mission A (pinned target):** `2135edca-36e5-4335-b295-23b215ca3aad` — "The autonomous
  conductor drives an explicitly targeted mission instead of auto-picking the first actionable
  one." `status: building`, `active: true`. (This is in fact the mission this very leaf's epic
  belongs to.)
- **Mission B (terminal control):** `6839ce65-4ec7-4d9e-9e99-21f561e1a000` — "Ship the control UI
  for the autonomous conductor system." `status: abandoned`, `active: true` (the `active` flag is
  still set even though the mission is terminal — a useful edge case for the pin's own
  terminal-target-clear guard).
- **Deploy attempt:** `[23:05 CDT]` `POST /api/supervisor/deploy {"project":"/Users/benmaderazo/Code/claude-mermaid-collab"}`
  → `{"ok":false,"started":false,"reason":"leaves-in-flight","inflightLeaves":["71b4b916-d897-48b1-bea5-4e7975708d2d"]}`.
  The deploy route correctly refused because this very leaf (`71b4b916`) was in flight — forcing it
  would have killed the server process this leaf-executor session runs under. Not overridden with
  `force`; see Findings. Since `deploy-status` already showed `stale:false` / versions matching,
  no stale-binary risk from skipping the forced deploy.
- **Conductor toggle:** already `enabled:true` for this project before this measurement (no
  change needed); confirmed via `GET /api/supervisor/conductor?project=...` baseline
  `{"project":"...","enabled":true,"targetMissionId":null}`.

## Timeline

| Stamp | Action | Observation |
|---|---|---|
| `[23:04 CDT]` | Baseline `GET /api/supervisor/conductor` | `targetMissionId: null` |
| `[23:05 CDT]` | `POST /api/supervisor/deploy` | Refused: `leaves-in-flight` (this leaf); not forced |
| `[23:06 CDT]` | `POST /api/supervisor/conductor {targetMissionId: A}` | `ok:true`, `targetMissionId: A` |
| `[23:06 CDT]` | `GET /api/supervisor/conductor` | `targetMissionId: A` (pin set) |
| `[23:07 CDT]` | **Tick observation #1** — `GET` after ≥1 orchestrator tick (30s interval, `orchestrator-live.ts:421`) | `targetMissionId` still `A`; mission A's `updatedAt`/`lastNudgeAt` unchanged from pre-pin values (`1784432905977` / `1784432659618`) — the pin held through a real tick with no drift |
| `[23:08 CDT]` | **Tick observation #2** — `GET` after a second tick | `targetMissionId` still `A` — pin persisted across two consecutive real ticks |
| `[23:08 CDT]` | `POST /api/supervisor/conductor {targetMissionId: B}` (terminal mission) | `ok:true`, `targetMissionId: B` |
| `[23:08 CDT]` | `GET /api/supervisor/conductor` (immediately) | `targetMissionId: B` |
| `[23:08 CDT]` | **Tick observation #3** — `GET` after the next real tick | `targetMissionId: null` — the pin **auto-cleared**, matching `conductor-pass.ts:115-119`'s lazy-clear-on-terminal-target path (`row.status === 'abandoned'` → `setConductorTargetMission(project, null)`, reason `target-cleared`) |
| `[23:08 CDT]` | `POST /api/supervisor/conductor {targetMissionId: A}` (re-pin) | `ok:true`, `targetMissionId: A` |
| `[23:08 CDT]` | `POST /api/supervisor/conductor {targetMissionId: null}` (explicit human unpin) | `ok:true`, `targetMissionId: null` |
| `[23:09 CDT]` | **Tick observation #4** — `GET` after one further tick, unpinned | `targetMissionId: null`, conductor free to fall back to unpinned first-actionable selection |

## Before/after GET payloads

Baseline (before any pin):
```json
{"project":"/Users/benmaderazo/Code/claude-mermaid-collab","enabled":true,"targetMissionId":null}
```

While pinned to mission A:
```json
{"project":"/Users/benmaderazo/Code/claude-mermaid-collab","enabled":true,"targetMissionId":"2135edca-36e5-4335-b295-23b215ca3aad"}
```

While pinned to terminal mission B (immediately after POST, before the next tick):
```json
{"project":"/Users/benmaderazo/Code/claude-mermaid-collab","enabled":true,"targetMissionId":"6839ce65-4ec7-4d9e-9e99-21f561e1a000"}
```

After the next real tick (auto-cleared, no human action taken):
```json
{"project":"/Users/benmaderazo/Code/claude-mermaid-collab","enabled":true,"targetMissionId":null}
```

After explicit unpin of mission A (final state, matches pre-measurement baseline):
```json
{"project":"/Users/benmaderazo/Code/claude-mermaid-collab","enabled":true,"targetMissionId":null}
```

## Findings

1. **No live two-actionable-mission race was observable.** Enumerating every watched project
   (`claude-mermaid-collab`, `build123d-ocp-mcp`, `yolox-markup`, `figure-h8`) via
   `GET /api/supervisor/missions`, exactly **one** mission system-wide was actionable at
   measurement time (`status` not in `{unapproved, abandoned, converged}` and
   `awaitingApprovalSince == null`): mission A itself. Every other mission was either
   `converged` or `abandoned`. This means the specific scenario the blueprint asks for
   ("mission B shows zero conductor-attributable activity while A gets ticks") can't be
   demonstrated as a genuine A-vs-B race right now — there is no second live competitor for the
   pin to exclude. Per the leaf's non-goals, scaffolding a second actionable mission (real
   criteria + epics + leaves) was deliberately **not** done: seeding fake competing work into
   the live production mission store to manufacture a race carries real cost (an actionable
   mission can itself trigger real conductor node spawns) and risk that outweighed the value of
   this measurement. Instead, the terminal-mission auto-clear path (mission B, `abandoned`) was
   used as the closest safe, real code path to exercise live — see Timeline row `[23:08 CDT]`.
2. **The pin round-trip and both real conductor-pass branches behaved exactly as
   `conductor-pass.ts` specifies:** the pin persisted unchanged across two consecutive live
   30-second orchestrator ticks while targeting an actionable mission (no drift, no fallback),
   and a pin pointed at a terminal mission was lazily cleared on the very next tick with no
   human action, consistent with the `target-cleared` branch (lines 115-119). No discrepancy
   between code and live behavior was observed.
3. **Deploy is correctly guarded against self-destruction.** `POST /api/supervisor/deploy`
   refused with `reason: "leaves-in-flight"` because this measurement leaf was itself one of the
   in-flight leaves — forcing the deploy would have killed the very server process running this
   leaf-executor session. This is working as designed (a real safety floor, not a defect), but is
   worth flagging: a measurement/deploy leaf run this way can never actually observe a *forced*
   hot-swap of its own project without a `force:true` override, which was intentionally not used
   here given the self-destruction risk.

## No-skip contract (harness hardening)

`scripts/live-conductor-pin-evidence.ts` never SKIPs an assertion. Step (f)'s
lazy-self-clear check drives its own terminal mission via `PATCH /api/supervisor/missions
{ abandonedAt }` (`src/routes/supervisor-routes.ts:266-280`) instead of relying on one already
existing — a missing transport is a `check()` failure, not a note. The evidence blob's
`assertionsSkipped` field is always `0` on a `PASS` verdict; any non-zero value fails the run.
