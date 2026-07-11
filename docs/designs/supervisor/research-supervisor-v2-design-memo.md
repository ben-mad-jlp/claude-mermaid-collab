# Supervisor v2 — Critical Design Review & Recommended Architecture

Opinionated memo stress-testing the "single global supervisor + per-project roadmaps, no server watcher, human-launched workers, wake-loop + pull" model. Grounded in `design-supervisor-v1`, `research-single-supervisor-roadmaps`, `research-supervisor-mechanics`, and the v1 code (`session-status-store.ts`, `tmux-send-keys`, `supervisor-store.ts`, `supervisor/SKILL.md`).

## TL;DR recommendation

Build the v2 model as proposed but with four hardening changes:

1. **Stateless-pull as the source of truth, with a thin durable notification queue ONLY for human-only escalations** (not for general "worker finished" events). Everything mechanical is re-derived each turn from `session-status.db` + transcripts. The queue exists solely so a human-only question the user hasn't answered survives a `/clear` and is never silently dropped.
2. **Opportunistic check at the START of every supervisor turn** (cheap `GET /api/session-status` for watched projects + a transcript read only for sessions that flipped to `waiting`). This is the single biggest correctness win and removes the "idle for 20 min during a long foreground convo" failure with zero new infrastructure.
3. **Replace the trailing-`?` heuristic** with a small structured classification the supervisor performs on the worker's last `end_turn` assistant message: extract the literal question (if any), then a 3-bucket decision with a hard "in doubt → human-only" default and an explicit never-list (permissions, irreversible actions, product/scope decisions, anything naming a person/credential/money).
4. **Roadmap = a NEW per-project artifact (`roadmap.db`)**, NOT reused blueprints and NOT the todo queue. It is the bridge layer: a roadmap item spawns a session + optionally seeds a per-session blueprint + emits assigned todos linked back to the item.

The "no server-side watcher" decision is **correct** for this model and should be kept — the nudge decision genuinely needs cognition (read the target's last message), so a dumb loop adds little. The wake loop covers the user-away case; the per-turn opportunistic check covers the user-present case. Together they cover the gap a watcher would have filled.

---

## 1. Roadmap primitive — data model

**Verdict: new per-project `roadmap.db`.** Blueprints/task-graphs are per-session and too low-altitude+wrong-scope; the todo queue is per-project but is execution-grain, not planning-grain. The roadmap is the missing per-project *planning* layer that sits ABOVE both and *links down* to them.

The bridge (per-project roadmap → per-session execution) is explicit: a roadmap item, when blessed, (a) creates/selects a collab session record, (b) optionally seeds that session's blueprint/task-graph (reusing vibe-blueprint/vibe-go machinery unchanged), and (c) emits assigned todos in the existing `todos.db` carrying a back-link to the roadmap item. The roadmap row stores the forward links (sessionName, todo ids, blueprintId) so the supervisor can render "item → its session → its status → its open-todo count" in one read.

Schema sketch (mirror todo-store/session-status-store exactly: bun:sqlite, WAL, per-project dbCache Map, `_closeProject` for tests):

```sql
-- <project>/.collab/roadmap.db
CREATE TABLE roadmap_item (
  id            TEXT PRIMARY KEY,          -- uuid
  project       TEXT NOT NULL,             -- redundant w/ file path, kept for symmetry
  title         TEXT NOT NULL,
  description   TEXT,                       -- the "epic" body / acceptance notes
  status        TEXT NOT NULL,             -- planned | ready | in_progress | blocked | done | dropped
  ord           INTEGER NOT NULL,          -- ordering within the project roadmap
  parentId      TEXT,                       -- optional grouping (phase → items)
  dependsOn     TEXT,                       -- JSON array of roadmap_item ids
  sessionName   TEXT,                       -- collab session this item spawned (null until blessed)
  blueprintId   TEXT,                       -- optional seeded per-session blueprint doc id
  createdAt     INTEGER NOT NULL,
  updatedAt     INTEGER NOT NULL
);

-- Link table so one item can own many assigned todos (1:N), and so completing
-- todos can roll item status forward.
CREATE TABLE roadmap_item_todo (
  itemId  TEXT NOT NULL,
  todoId  TEXT NOT NULL,                    -- FK into todos.db (cross-db, app-enforced)
  PRIMARY KEY (itemId, todoId)
);

CREATE INDEX idx_item_status ON roadmap_item(status);
CREATE INDEX idx_item_session ON roadmap_item(sessionName);
```

Notes / risks:
- **One roadmap per project** is enforced by "one db file per project" — no `roadmap_id` needed. Good. If multi-roadmap-per-project is ever wanted, add a `roadmap` table; don't pre-build it.
- **Cross-db FK** (roadmap_item_todo → todos.db) is app-enforced, not SQL-enforced. Acceptable (same pattern todos already use for `link.blueprintId`). Reconcile on read (drop dangling todo ids).
- **Status rollup**: don't auto-flip item→done purely from todos; require the supervisor (with cognition) to confirm, because "all todos done" ≠ "epic actually delivered." Auto-flip to `in_progress` on first `in_progress` todo is safe; `done` should be supervisor/user-confirmed.
- Altitude guard: roadmap items are MAJOR work (days), todos are tasks (minutes-hours). Keep ~3-12 items per project or it collapses into a second todo list.

---

## 2. Notification queue vs stateless pull — VERDICT

**Stateless pull for everything mechanical; a tiny durable queue ONLY for unresolved human-only escalations.**

Argument for stateless pull: the supervisor must read `session-status.db` + the target transcript anyway to make any decision (nudge-worthiness needs the last assistant message; this is exactly why no dumb watcher works). Once you're reading those, "did worker X finish?" is fully derivable: `status==waiting && lastTurn==end_turn && openTodos>0` → nudge; `==waiting && openTodos==0` → group done. A queue of "worker finished" events would just be a denormalized cache of state you're already re-deriving — pure redundancy that can drift, double-fire, or go stale across `/clear`. Re-derivation is idempotent and self-healing. So **no event queue for mechanical events.**

But there is exactly ONE class of fact that is NOT re-derivable safely: a **human-only question that the user has not yet answered.** If the worker has since been nudged/moved on, or the supervisor `/clear`ed, the verbatim question text and the "still owed an answer" obligation can be lost — re-derivation from a now-`active` transcript won't recover it, and silently dropping a human-facing question is the worst failure this system can have. So:

- **`escalations` table** (durable, per-supervisor, global): `{ id, project, session, kind: 'human_only'|'attended_request', questionText, transcriptOffset, status: 'open'|'answered'|'abandoned', createdAt, resolvedAt }`. Store the VERBATIM question + a pointer to where in the transcript it came from.
- Supervisor drains on each turn: list `status='open'` escalations, surface to top chat. When user answers → supervisor relays verbatim via send-keys → mark `answered`. When user says "I'll handle it" → set attended-lock (§3) + mark the escalation `attended`.
- **Dedup**: key candidate escalations by `(session, hash(questionText))`; don't re-enqueue an identical open question. Re-derivation produces the *candidate*; the table dedupes and persists the *obligation*.

So the queue is small, durable, human-facing only, and everything else is stateless pull. This is the strongest of both worlds: no drift on mechanical state, no dropped human questions.

---

## 3. Attended-lock

- **Storage**: a column/table in the global supervisor store (it's a supervisor-scoped, cross-project fact). `{ project, session, lockedAt, reason, expiresAt }`. Global because the supervisor is global and a worker is `(project, session)`.
- **Lifecycle**: set when user says "I'll go answer it directly." While locked, the supervisor NEVER send-keys that worker (no nudges, no relays). The escalation that triggered it is marked `attended`.
- **"Flips back to active" detection**: the lock clears when the supervisor observes a fresh `active` status transition AFTER `lockedAt` (the human typed into the worker → active-hook fires → `session-status.db.updatedAt > lockedAt && status==active`). Then on the *next* `waiting` the worker is eligible for normal handling again.
- **Failure modes & mitigations**:
  - *User never returns* → lock leaks, worker sits idle forever. Mitigation: `expiresAt` (default ~30-60 min). On expiry, don't auto-nudge; instead RE-ESCALATE ("you said you'd answer X in <session> 45 min ago; still want to? [I take it back / give me more time]"). Never silently grab a worker the user claimed.
  - *User answers directly but worker goes waiting again on a NEW question* → because the lock only clears on active-after-lock, a quick active→waiting flip could clear it prematurely while the user is still mid-thought. Mitigation: require the worker to have produced at least one new `end_turn` after the active transition before treating the lock as fully released (i.e., the human's answer actually drove a turn).
  - *Server restart* → lock must be durable (it's in the global store, on disk). Good.
  - *Lock set but worker process died* → on lock expiry re-escalation, also check the binding/status staleness and report "session no longer running" instead of nudging a corpse.

---

## 4. Wake-loop-only (no watcher) — failure modes & the per-turn check

The named failure is real: worker finishes 30s into a 40-min foreground planning convo → idle until next wake (≤20 min) or your next turn. Three reasons this is **acceptable** in this model: (a) during a deep foreground convo the user is engaged and turns happen often enough; (b) a worker idle for a few minutes loses little; (c) a server watcher wouldn't help much anyway because the nudge needs the supervisor's cognition to read the last message and classify — a watcher could only *flag*, not *act*.

**Recommendation — adopt the opportunistic per-turn check, and it largely closes the gap:**
- At the START of every supervisor turn (any user message, not just wakes), run a cheap reconciliation: one `GET /api/session-status?project=X` per watched project (these are local SQLite reads behind a route — sub-millisecond, batchable). Diff against the supervisor's last-seen snapshot (kept in working memory / a small `last_seen` table). For any session that newly flipped to `waiting`, read just that one transcript tail and apply the state machine.
- This means: during active collaboration, idle workers ARE caught within one user turn — no watcher, no daemon. The wake loop then only has to cover the genuinely-away case (user idle), where a 10-20 min latency is fine.
- Cost: status reads are trivially cheap; the only real cost is transcript reads, and you only read transcripts for sessions whose status CHANGED to waiting since last snapshot. So per-turn cost ≈ O(workers that just finished), not O(all workers).
- **Keep the wake loop** at ~10-15 min as the away-case heartbeat. Lower the default from 20 → 12 min since the per-turn check now handles the active case (the wake only matters when the user is gone, and 20 min idle-while-away is wasteful).

Residual failure modes to document:
- **Supervisor's own turn never comes AND wake misfires** (harness didn't reschedule, or user closed the supervisor window): everything stalls silently. Mitigation: the wake reschedule must be the LAST action each turn (already in SKILL); on session start, immediately do a reconciliation so a restarted supervisor self-heals.
- **Stale status** (worker crashed, last status `active` 2h ago): treat `updatedAt` older than ~120s with no transcript growth as `unknown`; never nudge; report. Already in v1, keep it.

---

## 4b. Question classification reliability

The trailing-`?` heuristic is too crude (misses "Let me know which you prefer."; false-positives on rhetorical "Should I just...? I'll go ahead."). Replace with a **two-step structured read** the supervisor performs on the worker's last `end_turn` assistant message:

**Step A — Is the turn actually awaiting input?** Signals (combine, don't rely on one):
- The turn ended `end_turn` (not `tool_use` — a tool-use stop means it's mid-work, never nudge/relay).
- The last message contains an explicit ask: interrogative, or imperative-to-human ("let me know", "confirm", "which option", "do you want"), OR it presents enumerated options.
- Absence of a trailing "I'll proceed / going ahead" self-resolution (if the worker already decided, it's not waiting on you — it's just stopped; that's a NUDGE candidate, not a question).

**Step B — 3-bucket classification of the ask**, with a hard default:
- **continue**: no real question, or the worker merely stopped between todos → nudge.
- **supervisor-answerable**: purely mechanical/derivable-from-context (which file, ordering of its own todos, "should I run the tests" → yes). Supervisor may answer via send-keys.
- **human-only** (DEFAULT when uncertain): anything matching the **never-list** → escalate verbatim, never answer:
  - permission/approval prompts of any kind,
  - irreversible or external-effecting actions (push, deploy, delete, migration, money, sending messages),
  - product/scope/priority decisions,
  - anything referencing a person, credential, secret, or account,
  - any question the supervisor cannot answer with HIGH confidence from the transcript alone.

**Risk of answering something it shouldn't** is the central safety risk. Mitigations: (1) the never-list is checked FIRST and short-circuits to human-only; (2) require explicit high-confidence for `supervisor-answerable` — "in doubt → human-only" is mandatory, restated in SKILL; (3) the supervisor's relayed answers are always VERBATIM passthrough of the user's text for human-only items (it never paraphrases decisions); (4) log every auto-answer to the escalations table as `kind='auto_answered'` so there's an audit trail and the user can catch a bad call. Consider: for the first N releases, make `supervisor-answerable` ALSO surface a one-line "I auto-answered X with Y — undo?" note in top chat (trust-but-verify).

---

## 5. Concurrency / scaling — N workers across M projects

Per reconciliation the supervisor needs: M cheap status reads (one per watched project, each returns all that project's sessions) + a transcript tail read for each worker that *changed to waiting*. 

- **Status**: cheap and batched-by-project already (`getStatuses(project)` returns all rows). M is small (a user watches a handful of projects). Non-issue.
- **Transcripts**: the cost driver. A transcript read is a `.jsonl` tail read + parse of the last assistant message. With the per-turn diff (§4), you only read transcripts for *newly-waiting* workers, typically 0-2 per turn, not all N. So steady-state cost is tiny.
- **Where it stops scaling**: the bound isn't I/O, it's the supervisor's COGNITIVE serial bottleneck — it classifies one worker's question at a time within a turn, and it's also the user's foreground collaborator. Practical ceiling ~**8-12 active workers**; beyond that, classification latency per turn grows and the user's foreground experience degrades (turns get slow). 50 workers is out of scope for this model — that would require the server-side watcher this design explicitly rejected.
- **Batching recommendation**: (a) cap watched-and-active workers (soft warn at ~10); (b) on a wake tick, only deep-read transcripts for `waiting` sessions, skip `active`/stale; (c) read the minimal transcript tail (last few messages), not the whole `.jsonl`; (d) maintain the `last_seen` snapshot so unchanged sessions cost nothing.

---

## 6. Bootstrapping a worker (planned → attached)

The gap: supervisor creates session record + assigned todos, but NOTHING happens until the human opens a Claude window and runs `/collab` to bind it. The supervisor must distinguish "human did it (binding appeared)" from "human forgot."

- **Detection of attachment**: a worker is `attached` once a binding file `/tmp/.mermaid-collab-binding-<claudeSessionId>.json` exists for `(project, session)` AND/OR a `session-status.db` row appears (the active-hook fires on first prompt). Either signal flips `planned/unattached → attached`. The roadmap item's `sessionName` is the join key.
- **Reminding about planned-but-unattached**: YES. On each reconciliation, list roadmap items with `status` ready/in_progress that have a `sessionName` but NO binding and NO status row → surface in top chat: "3 sessions are planned with todos but not yet opened: A, B, C. Open a Claude window in <project> and run /collab as each." Give a copy-pasteable hint (the cwd + session name). Don't nag every turn — remind once per session-becoming-stale, then only on explicit ask or wake.
- **Failure mode**: human opens Claude in the WRONG cwd or binds to the wrong session name → a stray binding, and the planned session stays unattached. Mitigation: when proposing the session the supervisor should hand the user the exact `cd <project> && claude` + `/collab <session>` recipe; and detect "a new binding appeared for an unexpected session in a watched project" and ask if that's the one they meant.
- **UX nicety**: the supervisor could pre-create the tmux window via the existing `/api/ide/create-terminal` (which does `tmux new-session -d` but does NOT launch claude) so the user just attaches and types — but that's optional polish, not core.

---

## 7. v1 code — KEEP / REPURPOSE / REPLACE / DROP

| v1 artifact | Verdict | Rationale |
|---|---|---|
| `session-status-store.ts` (per-project status db) | **KEEP** | Exactly right granularity & pattern. The per-turn/wake reconciliation reads it. No change needed. |
| `POST /api/ide/tmux-send-keys` (ide-routes.ts) | **KEEP** | This is now the PRIMARY (and only) drive mechanism — all workers are human-launched tmux Claudes. The in-server agent path is OUT, so send-keys is load-bearing, not a fallback. |
| `POST /api/session-notify` + `GET /api/session-status` | **KEEP** | Status ingestion + readout; the reconciliation core. |
| `websocket/handler.ts` status replay scaffold | **DROP (or leave inert)** | v2 is pull-based (stateless pull + per-turn check). The inert WS replay is not needed for the supervisor; don't invest in wiring it. Leave for UI use if any, but it's not on the supervisor path. |
| `supervisor-store.ts` (per-(sup,target) 4-tuple membership) | **REPLACE** | Contradicts single-global-supervisor. New global store: watched projects + supervisor config + attended-locks + escalations queue. Move from per-project `supervisor.db` keyed on tuples to a global `~/.mermaid-collab/supervisor.db`. |
| `supervisor-routes.ts` (`/api/supervisor/targets`) | **REPLACE** | Re-skin to `/api/supervisor/projects` (watched set CRUD), `/api/supervisor/roadmap` (per-project roadmap CRUD + spawn/assign), `/api/supervisor/escalations` (list/resolve), `/api/supervisor/locks`. |
| `SupervisorPanel.tsx` + `supervisorStore.ts` | **REWORK** | Re-target from "list assigned targets" to "watched projects → roadmap items → spawned session → status/open-todos", plus an escalations inbox and lock indicators. |
| `skills/supervisor/SKILL.md` | **REWORK** | Drop targets/assignment-list model and the "all supervised are external tmux" framing stays but reframed around roadmaps. KEEP: state-machine table, never-answer-permissions, last-nudge guard, ScheduleWakeup. ADD: per-turn opportunistic reconciliation, structured 3-bucket classification + never-list, escalation-queue drain, attended-lock handling, planned-but-unattached reminders, roadmap CRUD collaboration. Lower wake default to ~12 min. |
| In-server agent model / `agent_send` | **DROP from supervisor scope** | Explicitly OUT per the v2 model. The research doc's "prefer agent-model children" recommendation is SUPERSEDED — v2 commits to human-launched workers + send-keys. (Agent subsystem stays for vibe-go; just not a supervisor mechanism.) |
| Server-side background watcher (proposed in research §5) | **DROP / never build** | v2 explicitly rejects it; wake-loop + per-turn check replace it. |

**New to build**: global `supervisor.db` (watched projects, config, attended-locks, escalations); per-project `roadmap.db` + store + MCP tools + routes; "propose & create session for roadmap item" approval flow (pair-mode gate via `request_user_input`); SKILL rewrite.

---

## 8. Two open questions — recommended defaults

**(a) User-curated watch list vs auto-watch all sessions in a watched project?**
Recommend a **hybrid, defaulting to scoped auto-watch**: the user curates the set of WATCHED PROJECTS (coarse, low-effort), and within a watched project the supervisor auto-watches sessions IT SPAWNED from roadmap items (it knows their `sessionName`). It does NOT auto-supervise arbitrary human-started sessions in that project (those may be the user's own scratch work — supervising them invites unwanted nudges). So: project-level opt-in (curated), session-level = "roadmap-spawned ⇒ supervised; ad-hoc ⇒ ignored unless explicitly added." This avoids both per-session curation tedium AND the nudge-storm risk of grabbing every session.

**(b) Does the supervisor ever DRIVE a worker beyond nudge/relay (course-correct)?**
Recommend **NO for v2 — strict nudge/relay only.** Course-correcting ("you're going off-track, do Y instead") requires the supervisor to (1) judge correctness of in-flight work and (2) inject directive content, both high-risk for a system whose safety rests on "never make decisions, never inject content the user didn't author." A wrong course-correction silently derails a worker the user can't see. Keep the v1 invariant: the supervisor only NUDGES (continue your own todos), RELAYS (verbatim user text), and ESCALATES. If off-track work is a real problem, the right channel is a roadmap/todo edit (the user revises the plan, the worker re-reads its todos) — not the supervisor steering mid-flight. Revisit only after the classification track record is proven and behind an explicit "autonomy level" config.

---

## Top 3 risks

1. **Supervisor answers a human-only question it shouldn't** (auto-answers a permission/decision/irreversible action). This is the existential safety risk. Mitigated by never-list-first classification, mandatory "in doubt → human-only", verbatim-only relays, and an auto-answer audit log — but classification is probabilistic, so a confident-wrong call WILL eventually happen. Keep the never-list aggressive and prefer escalation; treat any auto-answer of a decision as a bug.
2. **Silent stalls / dropped human questions.** The whole model has no daemon: if the supervisor turn doesn't come and the wake misfires (harness drops the reschedule, user closes the window), workers sit idle and an unanswered human-only question can be lost. Mitigated by the durable escalations table (questions survive restart), reconcile-on-session-start (self-heal), reschedule-last, and lock expiry re-escalation — but a closed supervisor window genuinely halts everything, and that must be made visible to the user.
3. **Attended-lock leaks / premature release.** "I'll answer it directly" with no return strands a worker; a fast active→waiting flip can release the lock mid-thought and let the supervisor grab a worker the user is still in. Mitigated by `expiresAt` + re-escalation (no silent grab) and "require a fresh end_turn after active before releasing." Cognitively subtle; the most likely source of confusing "why did it nudge my session while I was typing in it" bugs.
