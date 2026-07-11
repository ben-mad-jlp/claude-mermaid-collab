# WORKER-FABRIC Control & Observability — Definitive Design

> Anchored on **graph-native-overlay** (judge winner, 44/52), with grafts from control-plane-first (per-cell precedence display), inspector-master-detail (tiering-in-context from the route caption), and trace-timeline (WS=structure / poll=intra-span-cost). Weighed against the real constraint: **local-first, single-user, on one machine, running several projects' autonomous fabric at once.**

---

## 1. VISION

The work-graph is already the live map of what the fabric is doing — so we do **not** build a second map. mermaid-collab already renders `FleetGraph` (React Flow, dagre-LR, semantic-zoom Epic→Todo→Worker nodes, `deckStore` selection, animated claim-edges). Every autonomous worker-core lane **is** a claimed todo node. We make that graph **alive**: each todo node gains a live phase chip, a provider/model badge, an accumulating `$`, and a gate-verdict color; each epic frame gains a cost rollup + budget bar; the rail header carries the one-line fleet truth.

The litmus — *"what is every worker doing, on what model, at what cost, against what spec, with what result?"* — maps one-to-one onto graph geometry:

| Litmus dimension | Where it lives |
|---|---|
| what doing | todo node's live **phase chip** (sizegate→…→review) |
| on what model | **provider/model badge** + override-ring on the node |
| at what cost | **$** on the node; rolled up the epic frame; summed at the rail |
| against what spec | the node **is** the spec (links its task-graph diagram + spec-test count) |
| with what result | the existing **danger ring** / gate-verdict color |

**Observability is node decoration. Drill is zoom + a slide-in callout. Tune is right-click (scope falls out of the geometry you clicked). Intervene is the same context-menu.** Net-new mental models: zero. We decorate the cockpit the operator already reads.

---

## 2. STRUCTURE + WIREFRAME

The Bridge `SplitDeck` already stacks instrument zones over a full-width `FleetGraph`. We **promote the graph to primary** and shrink instruments to a thin rail header.

```
┌─ RAIL HEADER (fleet strip) ─────────────────────────────────────────────────┐
│  5λ running · $6.40 today · 2▲ need you · project: mermaid-collab [build▾] [⚙]│
└─────────────────────────────────────────────────────────────────────────────┘
┌─ THE LIVING WORK-GRAPH (FleetGraph, decorated) ── primary, full bleed ────────┐
│                                                                               │
│  ┌══ EPIC: worker-fabric ═════════ 3/7 done · $2.14 · 1◉impl 2◉vfy ══════┐    │
│  ║   ┌─todo────────┐    ┌─todo──────────────┐    ┌─todo───────────┐      ║    │
│  ║   │ ✓ sizegate  │───▶│ ◉ IMPLEMENT  ⟳    │───▶│ ○ verify       │      ║    │
│  ║   │ claude·$.08 │    │ grok-build·$0.12○ │    │ claude(default)│      ║    │
│  ║   └─────────────┘    │ ░░░░▒▒ pulse  ⊙   │    └────────────────┘      ║    │
│  ║                      └───────────────────┘  ⊙=override ring          ║    │
│  ╚════════════════════════════════════ budget $2.14/$5.00 ▓▓▓░░ ════════╝    │
│                                                                               │
│  ┌══ EPIC: bugfix-inbox ══ 1/3 · $0.40 · idle ══┐   click node→LaneCallout    │
│  ║   ┌─todo──────┐  ┌─todo──────┐               ║   right-click epic→Tiering   │
│  ║   │ ⚠ review ✗│  │ ○ research│               ║   right-click node→Intervene │
│  ║   │ gate FAIL │  │ claude    │               ║                              │
│  ║   └───────────┘  └───────────┘               ║   [L0 ⦁][L1 ▭][L2 ▤] auto    │
│  ╚═══════════════════════════════════════════════╝                            │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Cluster mapping (one surface, four clusters)
- **(C) reframed cards** → the **rail header** (project `Nλ · $today · M▲`) + **epic frames** (rollup cost / phase-mix / budget bar). The standalone tmux-era `ProjectRailRow`/`WorkerRoster` is demoted; the graph **is** the roster.
- **(A) observability** → node decorations (glance) + a **LaneCallout** slide-in (drill).
- **(B) tiering** → node context-menu scoped by *what you right-clicked* (epic frame = per-epic; project bg = per-project; rail ⚙ = global) + a full TieringEditor matrix with per-cell precedence display.
- **(D) intervention** → same node context-menu (Stop / Re-claim / Set cap) + budget bars.

**Attention hierarchy (one-red discipline preserved):** red danger ring (escalation) ▸ amber budget breach ▸ running-phase pulse ▸ accumulated `$` ▸ everything else one zoom/click deeper.

### LaneCallout (click a running node → slides into SplitDeck right pane, graph stays, node spotlit)

```
┌─ LaneCallout · todo "scoped-tier config model" ───────────────────[Stop ⏹]─┐
│ PHASE PIPELINE                                                              │
│  sizegate✓  research✓  authortests✓  implement◉  verify○  review○          │
│  claude     claude     claude        grok-build⊙  —        —               │
│  $0.01      $0.04      $0.03         $0.12(live)  —        —               │
│            (click any model caption → Tiering, pre-scoped to phase+project) │
│  Run total: $0.20 (claude $0.08 / grok $0.12)   ⚠ verify model price unknown│
│ ─────────────────────────────────────────────────────────────────────────  │
│ SPEC     task-graph#worker-fabric · 4 spec-tests · untampered ✓             │
│ VERDICT  implement running · verify pending                                 │
│ ─────────────────────────────────────────────────────────────────────────  │
│ ▾ LIVE TRANSCRIPT (GrokTranscript, reused verbatim, 1s poll, this node only)│
│   ◉ implement · edit coordinator-bridge.ts                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### TieringEditor (full matrix — grafted per-cell precedence display from control-plane-first)

```
┌─ TIERING ────────────────────────── scope:[Global][Project✓][Epic:wf]──────┐
│ phase        provider       model           RESOLVES TO        WHY          │
│ sizegate     ◦ inherit      —               claude/haiku       default      │
│ research     [claude  ▾]    [sonnet  ▾]     claude/sonnet      ▸ project    │
│ authortests  ◦ inherit      —               claude/opus        ↑ global     │
│ implement    [grok-b ▾]     [grok-build ▾]  grok-build         ▸ project    │
│ verify       ◦ inherit      —               claude/sonnet      ↑ global     │
│ review       [opus  ⚠]      [opus    ▾]     claude(default)    ⚠ no key →fb │
│ ─────────────────────────────────────────────────────────────────────────  │
│ RESOLVED-ROUTE PREVIEW  project=mermaid-collab epic=wf level=drive:         │
│  sg claude/haiku · rs claude/sonnet · at claude/opus · im grok · vf claude  │
│ ─────────────────────────────────────────────────────────────────────────  │
│ KEYS  claude ●ok   grok-build ●ok   codex ○not-wired      [manage keys]     │
│ BUDGET (this project) daily cap [$5.00]  → over-cap: 1 escalation, stop claim│
└─────────────────────────────────────────────────────────────────────────────┘
 WHY legend:  ▸scope (set here, bold)   ↑inherited (dim)   default (faint)   ⚠ key-dead fallback
```

The **WHY column** is the graft that makes precedence legible: every cell shows *what resolves* (top) and *which scope won* (bottom), with the keyless-fallback warning inline. Resolution runs **server-side once** so the UI never re-derives the algorithm.

---

## 3. THE TIERING PRECEDENCE MODEL (the hard part)

### 3.1 Resolution order — one ordered walk, first available match wins
Extend `resolveTierRoute(phase, base)` → `resolveTierRoute(phase, base, ctx: {project, epicId, level})`. Walk, **first match wins; fall through on miss OR on unavailable provider** (preserves today's keyless-safe behavior — an override whose provider has no key is skipped, never honored, never hard-fails):

```
1. per-epic     override (tier_override scope=epic,    scopeId=epicId)   ← slot, ship LATER (1st post-v1)
2. per-project  override (tier_override scope=project, scopeId=project)  ← SHIP v1
3. per-level    override (tier_override scope=level,   scopeId=level)    ← slot, ship later
4. GLOBAL       override (config.json WORKER_PROVIDER_<PHASE>/_MODEL_)   ← SHIP v1 (exists today)
5. DEFAULT tier (providerForPhase: judgment→claude, implement→grok-build)← SHIP v1 (exists today)
6. base provider (the run's pin)                                        ← final keyless fallback
```

**Why epic > project > level > global:** a plain specificity ladder, with one deliberate placement — **level sits below project/epic but above global**. Autonomy level is a *cross-cutting policy default* ("on `drive`, judgment may use the cheaper judge"); a concrete per-project/per-epic model is *explicit local intent* and must win over a policy dial. Global is the floor; default tier is the keyless-safe baseline.

**v1 ships {project, global, default, base}.** Epic and level are **inert slots in the same walk** — honoring the existing `coordinator-bridge.ts:52` DEFERRED comment. Because this direction is graph-native, **per-epic UI is nearly free** (right-click an epic frame), so per-epic is the designated **first post-v1 extension**.

**Byte-identical guarantee:** with no scoped keys set, the 6-step walk collapses to today's 2-key lookup. Non-negotiable for safe rollout.

### 3.2 Exactly how `resolveTierRoute` changes
```ts
// coordinator-bridge.ts
type RouteCtx = { project?: string; epicId?: string; level?: string };
interface PhaseRoute { provider; model?; source: 'default'|'override'; winningScope?: 'epic'|'project'|'level'|'global'|'default'|'base'; }

function resolveTierRoute(phase: SubloopRole, base: ProviderId, ctx: RouteCtx = {}): PhaseRoute {
  const candidates = [
    ctx.epicId   && tierOverride('epic',    ctx.epicId,  phase),   // 1
    ctx.project  && tierOverride('project', ctx.project, phase),   // 2
    ctx.level    && tierOverride('level',   ctx.level,   phase),   // 3
    globalOverride(phase),                                         // 4 (config.json, today)
  ];
  for (const c of candidates) {
    if (c?.provider && providerAvailable(c.provider))
      return { ...c, source: 'override', winningScope: c.scope };
  }
  const def = providerForPhase(phase);                            // 5 default tier
  if (providerAvailable(def.provider)) return { ...def, source: 'default', winningScope: 'default' };
  return { provider: base, source: 'default', winningScope: 'base' }; // 6
}
```
- `tierOverride(scope, scopeId, phase)` reads the new SQLite table; `globalOverride` reads config.json (unchanged path).
- Returns `winningScope` so the UI's WHY column / override-ring never re-implement precedence.
- `ctx` is threaded from `makeCoordinatorWorkerDeps` (already closes over `project`/`todoId` → resolve `epicId` from the todo once, read the project's autonomy level). v1 only populates `{project}` overrides + global; rows 1/3 simply find no table rows.

### 3.3 Where config persists (the pick, justified)
- **Global tier keys + API keys → stay in `config.json`** via existing `GET/POST /api/settings/secrets` (`WORKER_PROVIDER_<PHASE>`, `WORKER_MODEL_<PHASE>`, `*_API_KEY`). Keys are secrets, global by nature; zero new infra.
- **Per-project / per-epic / per-level → a small dedicated SQLite table beside the ledger** (`~/.mermaid-collab/`, same pattern as `worker-ledger.db`):
  ```sql
  CREATE TABLE tier_override (
    scope    TEXT,   -- 'project' | 'epic' | 'level'
    scopeId  TEXT,   -- project path | epicId | level name
    phase    TEXT,   -- sizegate|research|authortests|implement|verify|review
    provider TEXT,
    model    TEXT,
    PRIMARY KEY (scope, scopeId, phase)
  );
  ```
  **Justification:** scoping config.json forces key-mangling (`WORKER_PROVIDER_IMPLEMENT__proj=x__epic=y`) — unqueryable, collision-prone, and the GUI cannot *list* overrides to render the matrix. A structured table is queryable, indexed (cheap in the hot `resolveTierRoute` path), and lives with the worker-fabric data it governs. config.json stays the global/secrets bag it already is.
- **Budget cap → config.json scalar** `WORKER_BUDGET_DAILY_<project>` (it's a scalar; the secrets bag is fine).

---

## 4. SIGNATURE INTERACTIONS

1. **Watch a phase advance on the graph.** A claim-edge animates into a todo; its phase chip steps sizegate→…→implement live (driven by the new `worker_phase` WS), the `$` ticks up, the edge color tracks the running phase. No click — the fleet's whole motion is legible at L1 zoom.
2. **Zoom IS drill.** Scroll L0→L2 on a node: dot (phase color) → pill (phase + model badge + `$`) → card (+ spec-test count + verdict). Click → LaneCallout for transcript depth (the only node that polls).
3. **Tiering-in-context (graft).** Click the model caption *under a phase chip* in the LaneCallout → TieringEditor opens **pre-scoped to that exact phase + the lane's project**, cursor on its provider dropdown. Config reached from the artifact, not a settings tree. Right-click an epic frame does the same at epic scope.
4. **Precedence reveal on scope-switch (graft).** Toggle the scope tabs Global→Project→Epic; every WHY cell re-resolves live (one `route-preview` call) so the grid animates which rules win at each altitude — precedence seen, not documented.
5. **Stop a runaway from its node.** Right-click a node burning `$` → **Stop** → `POST /api/worker-lane/abort` aborts the in-process `AbortController`; node greys, edge stops, final `$` freezes. The kill is exactly where the eye already is.
6. **Budget breach turns the frame amber + raises one escalation.** When `summarize({epicId|project}).totalUsd` crosses the cap, the frame bar goes amber, the orchestrator stops claiming under it, one "budget reached" escalation appears (red ring). The single alerting story.

---

## 5. VISUAL / INFORMATION DESIGN

- **Phase chip:** 6 micro-states `sizegate sg · research rs · authortests at · implement im · verify vf · review rv` (+ host-complete cp). State glyphs `✓ done · ◉ running(pulse) · ○ pending · ✗ failed`. Only the running chip animates — motion = active work.
- **Provider color:** `claude` / `grok-build` / `codex` each a fixed hue; the badge label is the model. The chip color carries provider at L0 where text is dropped.
- **Override-ring (⊙):** a thin ring around a phase chip whose `source==='override'`; hover names scope+key. A *keyless-skipped* override shows `⚠ override ignored: no XAI key → claude(default)` (graft from inspector-master-detail) so silent fallback is never silent.
- **Cost:** per-phase `$` under each chip; epic-frame header shows `byPhase` rollup; rail shows `$today`. `knownPrice:false` models render `$? ⚠` so $0 ≠ free.
- **Budget bar:** thin `▓▓▓░░ $2.14/$5.00` on the epic frame + rail; amber at breach.
- **Reuse `GrokTranscript.tsx` verbatim** — provider-neutral, 1s poll, only for the open LaneCallout.

---

## 6. TECHNICAL PLAN

### 6.1 Live-update architecture (graft from trace-timeline): **WS = structure, existing poll = intra-span cost**
The central confirmed gap: the adapter writes `recordPhase` to SQLite + appends to the transcript but **never broadcasts a phase event over WS**. Decorating every node by per-session polling would be N polls.

- **WS `worker_phase`** = the **structural** spine (phase open/close + route + authoritative cost on `phase-end`). One additive `broadcast()` at the seam that already calls `recordPhase`.
- **Existing 1s `/api/worker-transcript` poll** = intra-span live cost/tool-text, fired **only for the one open LaneCallout**.
- **Ledger-authoritative reconciliation:** on `phase-end`, snap the node's `$` to the WS `costUsd`; on lane completion / page refresh, reconcile against `GET /api/worker-ledger?todoId=&summary=true` (`byPhase`). Live = optimistic; finished = ledger-authoritative. A dropped WS message self-heals on refresh.
- **No client-clock growing-span animation, no time-axis** (dropped from trace-timeline as single-user over-build).

### 6.2 Components (`ui/`)
| Component | Status | Notes |
|---|---|---|
| `FleetGraph`, `EpicNode`, `TodoNode`, `useFleetGraph`, `layout.ts`, `useLod` | **reuse** | add decoration props to node `data`; do NOT rebuild |
| `deckStore` (spotlight/selection) | **reuse** | node click → LaneCallout |
| `GrokTranscript.tsx` | **reuse verbatim** | inside LaneCallout |
| `JudgmentLLMEditor.tsx` / `SecretsEditor.tsx` | **reuse pattern** | clone read/write for TieringEditor; keys |
| `OrchestratorLevelBadge.tsx` | **reuse** | level glyph on rail/frame |
| `LaneCallout.tsx` | **new** (`bridge/`) | pipeline strip + transcript + run-cost + spec/verdict + Stop |
| `PhasePipelineStrip.tsx` | **new** | 6-chip strip; shared by LaneCallout + node decoration |
| `TieringEditor.tsx` | **new** (`settings/`) | matrix + WHY column + preview + key-health + budget |
| `TieringMenu.tsx` / `InterveneMenu.tsx` | **new** | node/epic context-menus |
| `ProjectRailRow.tsx`, `WorkerRoster.tsx` | **demote** | legacy-CLI fallback only |

### 6.3 Stores (`ui/src/stores/`)
- **`workerFabricStore.ts`** (new) — folds `worker_phase` keyed by **todoId**: `{phase, route:{provider,model,source,winningScope}, runCostUsd, verdict, alive}`. Hydrated by `GET /api/worker-lanes` on mount/reconnect, updated by WS. Single source for all node decoration + rail.
- **`tieringStore.ts`** (new, small) — last resolved grid from `route-preview` + editable overrides; optimistic on cell edit then refetch preview.
- Reuse `supervisorStore` (escalations → red rings), `daemonPulseStore`, `projectStore`.

### 6.4 WebSocket (`src/websocket/handler.ts`)
Add ONE message, emitted from the existing `recordPhase` seam in `src/agent/adapters/grok-own.ts:~344` **and** the anthropic core adapter (shared impl), via `getWebSocketHandler().broadcast(...)`:
```ts
{ type:'worker_phase'; project; session; todoId; epicId?;
  lifecycle:'start'|'end'; role:SubloopRole;
  provider; model; source:'default'|'override'; winningScope?;
  usage?:{inputTokens,outputTokens}; costUsd?; steps?;
  verdict?:'pass'|'fail'; gateReasons?:string[]; ts }
```
`BridgeDashboard.tsx` adds it to its inline WS switch → dispatch into `workerFabricStore`.

### 6.5 Endpoints
**Reuse unchanged:** `GET /api/worker-transcript`, `GET /api/worker-ledger`(+`summary`), `GET /api/supervisor/todos`, escalations, `GET|POST /api/settings/secrets` (global keys + API keys), `GET|POST /api/orchestrator/level`, `POST /api/worker-inject`, task-graph diagram endpoint.

**New (minimal — 5 surfaces):**
1. **WS `worker_phase`** (above) — the keystone.
2. **`GET /api/worker-lanes?project=`** — live lanes (current phase + run-cost) from `getGrokHarnessForInspection`/anthropic core registries + per-lane `summarize({todoId})`. Hydrates the graph before WS deltas arrive; re-fetched on WS reconnect.
3. **`POST /api/worker-lane/abort {session}`** — harness `AbortController.abort()` (grok-own `GrokLane.controller`). The Stop button.
4. **`GET|POST /api/tiering`** — read/write `tier_override` rows (POST one scope/phase override; empty provider = clear → falls through). GET lists overrides per scope for the matrix.
5. **`GET /api/worker/route-preview?project=&epicId=&level=`** — runs extended `resolveTierRoute` per phase server-side → `{provider,model,source,winningScope,available}[]`. Backs the WHY column + preview row. (Bundle with `GET /api/worker/key-health`, a thin wrapper over `providerAvailable`/`anthropicAvailable`/`grokAvailable`.)

### 6.6 Server changes (`src/`)
- `coordinator-bridge.ts` — `resolveTierRoute(phase, base, ctx)` per §3.2; thread `ctx` from `makeCoordinatorWorkerDeps`.
- New `src/services/tier-override-store.ts` — SQLite `tier_override` table beside `worker-ledger.db`.
- `worker-ledger.ts` — add **`epicId` column** to `LedgerEntry`/`recordPhase`; `epicId` filter in `queryLedger`/`summarize` (per-epic cost rollup on frames + per-epic tiering attribution). Adapter resolves the todo's epic once at lane start.
- `grok-own.ts` + anthropic core adapter — emit `worker_phase` at the `recordPhase` seam.
- (Budget) `WORKER_BUDGET_DAILY_<project>` in config.json + an orchestrator pre-claim check in `orchestrator-live.ts` (`summarize({since:midnight})` ≥ cap → don't claim, raise one escalation via the existing `escalate` dep).

### 6.7 Delete / demote
- Demote `/api/fleet` (tmux/`ps` `FleetEntry.state`) + `fleetToStatus`/`deriveLiveness`/`WorkerRoster.tsx` to **legacy-CLI fallback only** (when a session has no `worker_phase` history and `/api/worker-transcript` returns `provider:null`). In-process liveness oracle = `worker_phase` last-seen + `harness.isAlive` — for in-process lanes `/api/fleet` falsely reports `no_tmux`/`unknown` on a healthy worker.
- Demote `ProjectRailRow` cards: content (cost/phase-mix/escalations) now lives on epic frames + rail header.

### 6.8 Phased build order
1. **Spine:** WS `worker_phase` emit (both adapters) + `workerFabricStore` + `GET /api/worker-lanes`. Closes the central observability gap; data flows.
2. **Glance (A/C):** node decorations (phase chip, model badge, `$`, override-ring) on existing `TodoNode`/`EpicNode` via `useLod` density gating; rail header. Highest leverage, smallest change.
3. **Epic cost:** `epicId` ledger column + epic-frame rollup + budget bar (passive).
4. **Drill (A):** `LaneCallout` (pipeline strip + reused transcript + run-cost + spec/verdict).
5. **Tune (B):** `tier_override` table + `resolveTierRoute(ctx)` (ship {project, global, default}) + `GET|POST /api/tiering` + `route-preview` + `key-health` + `TieringEditor` (WHY column) + `TieringMenu` + tiering-in-context from the LaneCallout caption.
6. **Intervene (D):** `POST /api/worker-lane/abort` + Stop; then budget cap + pre-claim check + escalation.
7. **Slot-in (post-v1):** per-epic rung first (UI nearly free via epic-frame right-click), then per-level — same ordered walk, no rework.

---

## 7. WHAT ELSE THE IN-PROCESS PATH NEEDS (cluster D, ranked)
1. **Kill a lane** — highest value/lowest cost; `worker-lane/abort` over the existing `AbortController`. **Ship v1.**
2. **Cost budget/cap** — `WORKER_BUDGET_DAILY_<project>` + orchestrator pre-claim check → one escalation on breach. The safety rail that makes "leave it running" trustworthy. **Ship v1.**
3. **Key health** — surfaced in the TieringEditor + override-ring fallback warning; fixes the silent "my Opus override is being ignored" failure. **Ship v1** (free with route-preview).
4. **Pause a lane** — lower value than kill+re-claim; **defer** unless trivial via the `injectFollowup` queue.
5. **Retry a phase** — **defer/cut**; the fix-loop already retries verify internally; manual single-phase retry has real resume-state complexity. Substitute: kill + reset_todo + re-claim.

---

## 8. WHY OVER ALTERNATIVES + TOP RISKS

**Why graph-native-overlay:** smallest net-new server surface because it decorates the `FleetGraph`/`deckStore`/`useLod` substrate that already exists rather than building a parallel roster (fleet-ops-console's N-card grid) or a separate inspector route (inspector-master-detail) or a time-axis forensics viewer (trace-timeline). This directly satisfies the "don't over-build for SaaS scale" constraint. Per-epic scope falls out of right-click geometry for free, making it the natural first extension. We graft the two genuinely-better ideas from siblings — control-plane-first's per-cell WHY column (clearest precedence display of the five) and inspector-master-detail's tiering-in-context caption — onto the graph spine, and adopt trace-timeline's WS=structure/poll=cost split as the live-update contract.

**Top risks + mitigations:**
1. **React Flow churn under `worker_phase` step-rate** → fold only `lifecycle:start|end` + cost deltas into node `data` (steps go to the on-demand transcript only); reuse `React.memo` on node data; drop badges at L0 (color only) via `useLod`. *(Judge's #1 flagged risk.)*
2. **Live cost drift vs ledger** → ledger-authoritative reconciliation on `phase-end` and on refresh; `knownPrice:false` rendered as `$? ⚠`.
3. **Silent keyless-override fallback** → the `winningScope` + `⚠ override ignored: no <X> key` caption surfaces it on both the chip and the matrix.
4. **Two adapters must both emit `worker_phase`** → emit at the shared `recordPhase` seam; a missing emit degrades gracefully (node falls back to `worker-lanes` hydration + ledger).
5. **Graph becoming the *only* surface** when no graph is rendered (e.g. a project with zero epics) → rail header + LaneCallout remain reachable; legacy `/api/fleet` fallback covers CLI lanes.
