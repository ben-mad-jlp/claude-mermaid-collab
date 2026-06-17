# P2 — MINIMAL leaf-executor (blueprint)

The deterministic FLOOR: an automated blueprint→implement→review loop that chains
`invokeNode()` (P1) per node, reusing the EXISTING worktree-manager + complete_todo
gate. NO waves, NO inner task graph, NO surgical reuse (those are P5/P6). Ships
behind an env gate, default OFF; the legacy tmux launch path is unchanged.

Builds ON committed P1:
- `src/agent/node-invoker.ts` — `invokeNode(NodeSpec): Promise<NodeResult>`,
  `assertSubscriptionAuth(): AuthMode` (throws unless claude.ai subscription),
  `NodeInvoker` interface, `ClaudeNodeInvoker`.
- `src/services/worker-ledger.ts` — `recordNode({project,todoId,session,...})`.

---

## 1. `runLeaf(project, leaf)` state machine — the MINIMAL floor

Signature (NEW `src/services/leaf-executor.ts`):

```ts
export interface LeafExecutorDeps {
  invoker?: NodeInvoker;          // default ClaudeNodeInvoker (mockable in tests)
  wm: WorktreeManager;            // getWorktreeManager(targetProject)
  complete: (project, todoId, acceptance: 'accepted'|'rejected') => Promise<unknown>;
                                  // = (p,t,a)=>handleWorkerComplete(makeCoordinatorDeps(),p,t,a)
  escalate: (input) => void;      // = createEscalation
  recordNode: typeof recordNode;  // ledger (best-effort)
  now?: () => number;
}
export interface LeafRunResult {
  outcome: 'accepted' | 'rejected' | 'blocked';
  attempts: number;
  nodesSpent: number;
  reason?: string;                // set on 'blocked'
}
export async function runLeaf(project: string, leaf: Todo, deps: LeafExecutorDeps): Promise<LeafRunResult>
```

States / transitions (per ATTEMPT; the whole run loops attempts):

```
START
  → assertSubscriptionAuth()            // once, before attempt loop; throw → propagate (never spawn under API key)
  → epicId = resolveEpicId(leaf, project)
  → ensureEpic(epicId, targetProject)   // materialise epic branch (so the off-tip base exists)

ATTEMPT (n = 0,1; cap = 2):
  CLAIMED                               // leaf already claimed by coordinator (in_progress)
  → ENSURE_FRESH_WORKTREE
        wt = wm.ensure(sessionKey, { baseBranch: epic.branch, fresh: true })   // off epic TIP, fresh EVERY attempt
        cwd = wt.path
  → BLUEPRINT  (node: opus, read+write+grep+glob+bash-ro)  → checkBudget → on !ok: FAIL_ATTEMPT
  → IMPLEMENT  (node: sonnet, read+edit)                   → checkBudget → on !ok: FAIL_ATTEMPT
  → REVIEW     (node: opus, read+grep+bash-ro, no edits)   → checkBudget → parse PASS/FAIL verdict
       PASS  → COMPLETE  (deps.complete(project, leaf.id, 'accepted'))  → outcome from gate → DONE
       FAIL  → FAIL_ATTEMPT

FAIL_ATTEMPT:
  n+1 < cap → loop to ATTEMPT (fresh worktree again; the failed wt is torn down by next ensure(fresh))
  n+1 == cap → PARK_BLOCKED(reason='attempt-cap-exhausted')

BUDGET_EXCEEDED (from any checkBudget, any state) → PARK_BLOCKED(reason='node-budget-exhausted') immediately

PARK_BLOCKED:
  → deps.complete(project, leaf.id, 'rejected')   // route through the SAME gate funnel so dependents/status settle
  → deps.escalate({ kind:'blocker', project, session, todoId, questionText })  // escalation card
  → return { outcome:'blocked', ... }
```

Notes:
- `sessionKey` = a stable per-leaf lane name, e.g. `leaf-exec-${leaf.id.slice(0,8)}`.
  WorktreeManager keys records on this; `fresh:true` tears down the prior dir+branch
  (see worktree-manager.ts `_ensureInner` DEFECT-1 path, lines 152–177) so every
  attempt is provably a NEW branch off the epic tip.
- On the COMPLETE path the merge-back to the epic branch is NOT done here directly;
  it is driven by the existing completion funnel (see §6) which is what
  `commitAndMergeToEpic` is wired into elsewhere. The executor's job is to drive the
  nodes + call the gate, not to re-implement merge-back.

---

## 2. The THREE HARD CEILINGS

A single mutable run-state object held in the `runLeaf` closure:

```ts
const state = { attempt: 0, nodesSpent: 0 };
const ATTEMPT_CAP = 2;
const NODE_BUDGET = 20;
```

1. **attempt cap = 2** — the `ATTEMPT` for-loop runs `state.attempt` in `[0, 2)`.
   On REVIEW-FAIL with `state.attempt === ATTEMPT_CAP - 1`, go straight to
   PARK_BLOCKED (no 3rd attempt). Lives in the loop guard.

2. **master node budget = 20** — `state.nodesSpent` is incremented on EVERY
   `invokeNode` call, across the WHOLE leaf (all attempts, all node kinds). A single
   helper wraps every node invocation:

   ```ts
   async function runNode(kind, spec): Promise<NodeResult> {
     state.nodesSpent += 1;                 // increment BEFORE the spawn (counts the attempt to spend)
     const res = await deps.invoker.invoke(spec);
     deps.recordNode({ ...telemetry, nodesSpent: 1, leafId: leaf.id, epicId, nodeKind: kind });
     return res;
   }
   function checkBudget(): boolean { return state.nodesSpent <= NODE_BUDGET; }
   ```

   `checkBudget()` fires immediately AFTER each `runNode` return (every state).
   Hit (`nodesSpent > 20`) → park BLOCKED immediately, regardless of which node/attempt
   was in flight. With 3 nodes/attempt and a 2-attempt cap the floor spends ≤6 nodes;
   the 20 budget is the absolute backstop against a runaway (e.g. a node that itself
   loops). Increment-before-spawn means a node that hangs still counts.

3. **fresh worktree EVERY attempt** — `wm.ensure(sessionKey, { baseBranch: epic.branch, fresh: true })`
   is called at the TOP of every ATTEMPT iteration. `fresh:true` guarantees the prior
   attempt's dir+branch are torn down and a brand-new branch is cut off the epic tip
   (no surgical reuse of prior-attempt edits — that's P6).

---

## 3. Per-node NodeSpec construction

Common: `cwd = wt.path`, `leafId = leaf.id`, `epicId`, `permissionMode='bypassPermissions'`
(headless default), `timeoutMs` left to the P1 default (600s) or a per-kind override.

| node      | model    | allowedTools                              | writes? |
|-----------|----------|-------------------------------------------|---------|
| blueprint | `opus`   | `Read Write Grep Glob Bash`               | yes (writes per-leaf blueprint into the leaf worktree) |
| implement | `sonnet` | `Read Edit`                               | yes (code edits only) |
| review    | `opus`   | `Read Grep Bash`                          | NO (read-only audit; no Edit/Write) |

`allowedTools` is the space/comma list P1 passes straight to `--allowedTools`
(node-invoker `buildNodeArgv`). Bash in blueprint/review is read-only by convention
in the prompt (the CLI has no RO-bash flag; the prompt instructs "inspection only").
The blueprint node writes its artifact to a fixed path inside the worktree, e.g.
`.collab/leaf-blueprints/<leafId>.md`, so IMPLEMENT and REVIEW can read it.

---

## 4. Node prompt templates (cloned-in-spirit; reference NOTHING in skills/)

The daemon clones the LOGIC of vibe-blueprint / vibe-go / review as inline string
templates. Each is built from the leaf's `title`, `description`, `files`, and the
prior node's output path.

- **BLUEPRINT** (≈ vibe-blueprint): "You are the blueprint node for ONE leaf todo.
  Title: {title}. Description: {description}. Touch files: {files}. Read the relevant
  code (Read/Grep/Glob/Bash-inspection only). Produce a precise, self-contained
  implementation blueprint and WRITE it to `.collab/leaf-blueprints/{leafId}.md`.
  No implementation code in this step."

- **IMPLEMENT** (≈ vibe-go worker): "You are the implement node. Read the blueprint at
  `.collab/leaf-blueprints/{leafId}.md` and the referenced files, then make the code
  edits to satisfy it (Read/Edit only). Implement fully; do not stub. Do not run the
  gate or report completion — the executor does that."

- **REVIEW** (≈ vibe-review / requesting-code-review): "You are the review node,
  READ-ONLY (Read/Grep/Bash-inspection; no edits). Compare the working tree against
  the blueprint at `.collab/leaf-blueprints/{leafId}.md`. Decide if the work is
  complete and correct. End your reply with EXACTLY one line: `VERDICT: PASS` or
  `VERDICT: FAIL — <reason>`." The executor parses `NodeResult.text` for
  `/^VERDICT:\s*PASS/m` → PASS, else FAIL (no verdict line ⇒ FAIL, fail-closed).

---

## 5. The `launchWorker` branch + `LEAF_EXECUTOR` env gate

Insertion point: `coordinator-live.ts` `launchWorker` (signature
`launchWorker: async (project: string, todo: Todo): Promise<boolean>`, line **1314**).
The branch goes AFTER the lane identity is persisted (after the
`updateTodo({sessionName,executedBySession})` block, ~line 1400) and BEFORE the
provider-resolution / `launchAgent.launch(...)` tmux machinery (~line 1498), so the
leaf-executor lane still shows up in the fleet with a real `sessionName`.

```ts
// LEAF_EXECUTOR (P2): headless deterministic executor, default OFF.
if (leafExecutorEnabled() && isHeadlessLeaf(todo)) {
  try {
    const res = await runLeaf(project, todo, makeLeafExecutorDeps(targetProject));
    recordSupervisorAudit({ kind:'spawn', project, session: poolName,
      detail: JSON.stringify({ todoId: todo.id, executor:'leaf', outcome: res.outcome,
        attempts: res.attempts, nodesSpent: res.nodesSpent }) });
    return res.outcome === 'accepted';
  } catch (e) {
    // Auth-halt or hard error → release + escalate; do NOT silently fall to tmux.
    try { await releaseClaim(project, todo.id); } catch {}
    createEscalation({ project, session: poolName, kind:'blocker', todoId: todo.id,
      questionText: `Leaf-executor failed for "${todo.title ?? todo.id}": ${e instanceof Error ? e.message : String(e)}` });
    return false;
  }
}
// ...unchanged legacy tmux path continues below (resolveProfile → launchAgent.launch)...
```

Env gate (mirror `registry.ts` `claudeOnly()` / `workerIsolationEnabled()` idiom),
read in `coordinator-live.ts`:

```ts
export function leafExecutorEnabled(): boolean {
  const v = (process.env.LEAF_EXECUTOR ?? 'off').trim().toLowerCase();
  return v === '1' || v === 'on' || v === 'true';
}
```

Default (unset) ⇒ OFF ⇒ the branch is never taken ⇒ legacy tmux path is the
unchanged fallback. `isHeadlessLeaf(todo)` = a leaf (no children) work todo that is
not human-owned (`assigneeKind !== 'human'`) — keeps gates/epics out of the executor.

---

## 6. Completion through the EXISTING gate; BLOCKED escalation

- **PASS** → `deps.complete(project, leaf.id, 'accepted')` where `complete` =
  `(p,t,a) => handleWorkerComplete(makeCoordinatorDeps(), p, t, a)`
  (coordinator-daemon.ts line **168**). That funnel runs `resolveCompletion`
  (declared-gate fail-closed `runGate` + `verifyWorkCommitted` re-verify) then
  `completeTodo` — the SAME server-authoritative path the MCP `complete_todo` verb
  uses (setup.ts line **4719**). The executor NEVER writes `done`/`accepted` itself;
  it only proposes, exactly like a worker self-report. The effective outcome
  (`accepted`/`rejected`/`pending`) comes back from `handleWorkerComplete` and is the
  authoritative `runLeaf` outcome (so a gate-red PASS still resolves correctly).

- **BLOCKED** (attempt-cap or node-budget exhausted) → route a final
  `deps.complete(project, leaf.id, 'rejected')` so dependents/status settle through
  the same gate, then raise the card via the EXISTING escalation API
  `createEscalation({ project, session, kind:'blocker', todoId, questionText })`
  (supervisor-store.ts line **693**; dedups on (project,session,questionText,open)).
  `questionText` names the cap/budget reason + attempts + nodesSpent.

---

## 7. Auth / ledger

- `assertSubscriptionAuth()` — called ONCE at `runLeaf` start, before the first node
  (before the attempt loop). It throws if auth ≠ claude.ai subscription; the
  launchWorker branch catches → release + escalate (no tmux fallback). P1's
  `invokeNode` independently re-checks the memoized auth mode and HALTs per node, so
  this is a fail-fast not the only guard.
- `recordNode(...)` — called inside the `runNode` wrapper AFTER each node, best-effort
  (never throws / never blocks the run). Fields: `project`, `todoId=leaf.id`,
  `session=sessionKey`, `epicId`, `leafId=leaf.id`, `nodeKind` (blueprint/implement/
  review), `model`, `nodesSpent:1`, `authMode/exitCode/durationMs/rateLimited` from
  `NodeResult`, token/cost from `NodeResult.usage`.
- `nodesSpent` (the master counter) lives in the `runLeaf` closure `state` object and
  is surfaced in `LeafRunResult` + the supervisor-audit detail. Per-run, not persisted
  across process restarts (the floor is single-process; a restart re-claims the leaf
  fresh — consistent with `fresh:true` every attempt).

---

## 8. File-by-file change list + test plan

**NEW** `src/services/leaf-executor.ts`
- `runLeaf(project, leaf, deps): Promise<LeafRunResult>` (the state machine).
- `LeafExecutorDeps`, `LeafRunResult` interfaces.
- `runNode` wrapper (budget increment + ledger), `checkBudget`, verdict parser,
  the three NodeSpec builders, the inline prompt templates.
- `makeLeafExecutorDeps(targetProject)` factory wiring real deps
  (ClaudeNodeInvoker, getWorktreeManager, handleWorkerComplete, createEscalation,
  recordNode).

**EDIT** `src/services/coordinator-live.ts`
- add `leafExecutorEnabled()` (env gate) + `isHeadlessLeaf()` helper.
- add the ONE `LEAF_EXECUTOR` branch in `launchWorker` (insertion point §5). Legacy
  path below it untouched.

**Test plan** (`src/services/__tests__/leaf-executor.test.ts`, Bun; NO live daemon):
Mock `invoker` (a `NodeInvoker` returning scripted `NodeResult`s), a fake `wm` (record
`ensure` calls + the `fresh` flag + baseBranch), and spy `complete` / `escalate` /
`recordNode`. Assert:
1. **Happy path** — review returns `VERDICT: PASS` → `complete(_,_, 'accepted')` called
   once; outcome 'accepted'; exactly 3 nodes spent; 1 attempt.
2. **Retry then pass** — attempt 1 review FAIL, attempt 2 review PASS → 2 attempts,
   6 nodes, `ensure({fresh:true})` called twice, accepted.
3. **Attempt cap** — both attempts review FAIL → outcome 'blocked', reason
   'attempt-cap-exhausted', `complete(_,_, 'rejected')` + `escalate(kind:'blocker')`
   called, exactly 2 attempts (no 3rd).
4. **Node budget** — invoker that loops/returns ok but a leaf config forcing >20
   nodes → blocked at nodesSpent>20 reason 'node-budget-exhausted', mid-attempt
   (budget check fires before the next attempt completes).
5. **Fresh-worktree invariant** — every attempt calls `wm.ensure` with
   `{ baseBranch: epicBranch, fresh: true }`.
6. **Verdict parsing** — review text with no `VERDICT:` line ⇒ treated as FAIL
   (fail-closed).
7. **Auth halt** — stub `assertSubscriptionAuth` to throw ⇒ `runLeaf` rejects / the
   launchWorker branch escalates (test the branch wrapper separately with the gate on).
8. **Per-node specs** — assert blueprint=opus+Write-allowed, implement=sonnet+Edit,
   review=opus+no-Edit/Write, all `cwd === wt.path`.

---

## RISKS / MISMATCHES (flag before implement)

- **Completion is driven via `handleWorkerComplete`, NOT the MCP verb.** The spec says
  "the existing complete_todo funnel." The MCP `complete_todo` case (setup.ts 4716) is
  just a thin wrapper over `handleWorkerComplete(makeCoordinatorDeps(), …)`. The
  executor should call `handleWorkerComplete` DIRECTLY (in-process) rather than issue a
  self-MCP call — same gate, no loopback. This is the clean seam; confirmed callable.
- **Merge-back is not performed by the executor.** `completeTodo` (the store fn) and
  `commitAndMergeToEpic` are separate; the merge-back to the epic branch happens in the
  `makeCoordinatorDeps().completeTodo` wrapper's surrounding logic, NOT inside
  `handleWorkerComplete`'s `deps.completeTodo`. RISK: a headless leaf's edits live in
  the FRESH leaf worktree (`sessionKey` lane), and the existing merge-back path
  (`commitAndMergeToEpic(sessionId=poolName,…)`) keys off the WORKER lane session name.
  The executor must use a `sessionKey` that the completion/merge path can resolve to
  the right worktree — OR the floor must explicitly call
  `wm.commitAndMergeToEpic(sessionKey, epicId, {message, todoId:leaf.id})` before/at
  COMPLETE so the gate's `verifyWorkCommitted` sees committed work on the epic branch.
  **This is the one thing to nail in implement:** wire the leaf worktree's commit+merge
  so `resolveCompletion`'s work-committed re-verify passes (else every PASS downgrades
  to 'pending'). Recommendation: have the executor call `commitAndMergeToEpic` on PASS,
  THEN `handleWorkerComplete('accepted')` — mirroring what the tmux worker lane's
  completion does.
- **REVIEW verdict is text-parsed**, not a structured gate. The fail-closed
  `/^VERDICT:\s*PASS/m` parse is the floor's only quality signal before the real
  `runGate`; acceptable for P2 since `resolveCompletion` is the authoritative backstop.
- **`recordNode` token/cost** depends on P1's JSON-result parsing; on `parseError`
  usage is undefined → ledger rows carry 0 cost (knownPrice=false). Telemetry only,
  non-blocking.
- No other blockers found. P1 surface (`invokeNode`, `assertSubscriptionAuth`,
  `recordNode`) and worktree-manager (`ensure(fresh)`, `ensureEpic`,
  `commitAndMergeToEpic`) are sufficient for a clean implement.
