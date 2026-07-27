// Epic-lifecycle MCP tool surface — extracted verbatim from setup.ts.
//
// Owns the cohesive EPIC tool group: landing/verifying/forward-integrating an epic
// branch, epic-level land readiness + telemetry + branch status, the work-graph
// todo lifecycle (get/complete/reset/override-accept/settle-dup), gate creation,
// the diff-contract editors, invariant/gate-status reads, the subscription inbox
// drain, and the per-leaf ledger inspectors. Assembled from exact byte ranges of
// setup.ts — behavior is identical, a pure move.
import { getWebSocketHandler } from '../services/ws-handler-manager.js';
import * as supervisorStore from '../services/supervisor-store.js';
import { getTodo, resetTodo, overrideAcceptTodo, createGate, deriveTodoViews } from '../services/todo-store.js';
import { checkInvariants } from '../services/invariant-check.js';
import { gateStatus } from '../services/gate-status.js';
import { getEpicBranchStatus } from '../services/epic-branch-status.js';
import { verifyEpic } from '../services/verify-epic.js';
import { getLeafRun, listLeafRuns } from '../services/ledger-stats.js';
import { editLeafRequirement, editContractField } from '../services/worker-ledger.js';
import { makeCoordinatorDeps, landEpic, resolveEpicId } from '../services/coordinator-live.js';
import { checkOwnership, landedByTrailer, type LandActor } from '../services/land-authority.js';
import { handleWorkerComplete } from '../services/coordinator-daemon.js';
import { settleDupOfLandedToolDef, settleDupOfLandedHandler } from './tools/settle-dup-of-landed.js';
import { recordSupervisorDecision } from './setup.js';

export const EPIC_TOOL_DEFS = [
      { name: 'land_epic', description: "LAND an epic onto master (FBPE P4 — human-gated, irreversible). Given an open 'epic-ready-to-land' escalation, the server RE-DERIVES land-readiness from ground truth at click time (children done+accepted; tsc clean in the epic worktree; epic branch dry-merges into master) — never trusts the card summary. On a green proof it performs ONE --no-ff epic→master merge behind a per-project land mutex, removes the epic branch+worktree, and resolves the card. A conflict leaves master UNTOUCHED and re-surfaces a human-rebase escalation. Clean-tree guard: refuses if the main checkout has uncommitted/untracked changes — pass allowDirty:true to override (dirty paths are still printed, an Allow-Dirty trailer is added to the land commit, and a friction note is recorded). Landing is a ROLE, not an autonomy level: a conductor lands its own mission's epics only; bucket roots and foreign missions are refused with the owner named. The actor is recorded in the response and audit trail.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project (where the work-graph + escalation live).' }, escalationId: { type: 'string', description: "The open 'epic-ready-to-land' escalation id to land." }, allowDirty: { type: 'boolean', description: "Bypass the clean-tree guard: land even though the main checkout has uncommitted/untracked changes. The dirty paths are still printed, an `Allow-Dirty: <paths>` trailer is added to the land commit, and an orchestration friction note is recorded. Per-call only — NOT a persistent flag." }, actor: { type: 'string', enum: ['human', 'conductor', 'daemon'], description: "Who is taking this irreversible action. Defaults to 'human'. 'conductor' additionally requires `session` and is gated on OWNERSHIP: the epic must be a descendant of that session's ACTIVE mission, and must not be a bucket root." }, session: { type: 'string', description: "Conductor session id. Required when actor='conductor'." } }, required: ['project', 'escalationId'] } },
      { name: 'inbox', description: 'Drain THIS session\'s pending subscription notifications (the PULL half of nudge-to-pull). Returns + marks-seen every unseen update [{ scope, targetId, event, summary, payload, ts, tsLocal }] plus a top-level `servedAt` (epochMs/iso/local) stamping when you pulled. `tsLocal` is the human-readable wall-clock of each event; `ts` is its epoch ms. The FULL drain means a missed nudge self-heals on the next one. Call this when woken by a nudge (or any time) to see what changed on your subscribed todos/epics/projects, then act.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' } }, required: ['project', 'session'] } },
      { name: 'get_todo', description: "Read a single project work-graph todo by id (title, description/spec, status, dependsOn, sessionName). `status`/`derivedStatus` are the live-DERIVED state and `storedStatus` is the raw persisted value (an approved todo derives 'ready' while storedStatus stays 'planned'); also returns isClaimable + claimReason. Used by a worker to read its claimed todo.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' } }, required: ['project','todoId'] } },
      { name: 'complete_todo', description: 'Worker completion report: mark a project todo accepted or rejected (marks done + unblocks dependents).', inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' }, acceptance: { type: 'string', enum: ['accepted','rejected'] }, claimToken: { type: 'string', description: 'The claim token of the run reporting completion; omit only for human/steward completions.' } }, required: ['project','todoId','acceptance'] } },
      { name: 'gate_status', description: "Read-only per-project acceptance-gate status. Returns the CONFIGURED gate command (the project's .collab/project.json `gateCommand`, the tsc/test invocation the completion gate runs) — or null + `gateConfigured:false` when the project uses the default worker change-set-scoped tsc+tests — plus the last N gate results per todo (from the durable supervisor audit trail): each carries { todoId, title, passed, acceptance, acceptanceStatus, ts, reason }. Lets the steward answer 'why is this todo blocked / how is the gate set up?' without spelunking the DB or manifest.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project whose gate config + recent results to report.' }, limit: { type: 'number', description: 'Max recent gate results to return (default 20, capped 200).' } }, required: ['project'] } },
      { name: 'invariant_check', description: "Read-only work-graph health check. Returns only the VIOLATIONS of the documented invariants (not the whole graph): orphan (non-epic todo with no epic (kind='epic') ancestor), stranded-epic (an epic with no land leaf (kind='land') beneath it), epic-planned-ready-child (epic still 'planned' with a 'ready' child), broken-depends-on (dependsOn points at a missing/dropped todo), blocked-on-nothing ('blocked' but every dep is done). A clean graph returns []. Each violation carries { kind, todoId, title, reason }.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project whose work-graph to check.' } }, required: ['project'] } },
      { name: 'epic_branch_status', description: "Read-only git landing status per epic (kind='epic'). For each epic, reports its collab/epic/<id8> accumulation branch: exists?, ahead (unlanded commits vs master), behind (master commits the branch lacks), mergeable (trial merge has no conflicts), and landLeafDone (its land leaf (kind='land') is done). Flags `stranded` epics — the epic branch EXISTS and is ahead>0 of the base (git-derived, independent of the land-leaf stamp), i.e. 'unlanded commits on master'. A `corrupt` sub-flag additionally marks a FALSELY-STAMPED land: the land leaf is done yet the branch is still ahead>0 (work claimed landed that git says is not). Pure git reads (rev-list/merge-tree), no mutation. Returns { project, baseRef, epics[], strandedCount, corrupt, corruptCount }.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project whose epics to check.' }, baseRef: { type: 'string', description: "Base branch to compare against (default 'master')." } }, required: ['project'] } },
      { name: 'epic_land_readiness', description: "Read-only land-presence check for one epic (kind='epic'). For the epic's FULL descendant set, every descendant that is accepted/done and is a CODE leaf must have a commit whose `Collab-Todo: <id>` trailer is reachable from collab/epic/<id8>. Containers (>=1 non-dropped child), [GATE] decision nodes, the land leaf (kind='land') and nested epics are exempt and reported as exemptions. A code leaf with a commit on a stray ref is 'stranded'; one with no commit anywhere is 'missing' (accepted nothing) — both BLOCK the land. Also counts DUPLICATE trailer commits per leaf (informational only; duplicate dispatch is safe recovery, never auto-fixed). Proves work LANDED, says nothing about whether it is CORRECT. Pure git reads; reports, never fixes. Returns { epicId, epicBranch, checked, findings[], exemptions[], duplicateCommits[], blocking }.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project.' }, epicId: { type: 'string', description: 'The epic todo id (full uuid or leading-8 prefix).' } }, required: ['project', 'epicId'] } },
      { name: 'land_telemetry_report', description: "Read-only windowed rollup over recorded land cycles (epic_land_record) for `project`. Per cycle reports landPath ('epic-tip' vs 'merge-sha-fallback', derived from whether the epic tip sha was captured), a live re-derived non-terminal serving-leaf count/ids (work still open under that epic's descendants at REPORT time — not a historical capture), and postLandStatusClean/postLandResidue (a report-time `git status --porcelain` snapshot of the main checkout, not a historical post-land capture). Also counts `main-checkout-residue` escalations raised in the same window. Defaults sinceMs to 24h before untilMs (untilMs default now). Pure reads — never mutates any store.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project.' }, sinceMs: { type: 'number', description: 'Window lower bound (epoch ms). Default untilMs - 24h.' }, untilMs: { type: 'number', description: 'Window upper bound (epoch ms). Default now.' } }, required: ['project'] } },
      { name: 'verify_epic', description: "Read-only differential suite verdict for one epic (kind='epic'). Runs the project's own suite command(s) (resolved from .collab/project.json gateCommand/frontendGateCommand — never hard-coded) SEQUENTIALLY against a detached scratch worktree of the epic branch and a detached scratch worktree of base. Per suite returns { suite, branchFailing[], baseFailing[], newFailures[], subsetHolds } where newFailures = branch failing NAMES minus base failing NAMES (names, never counts); subsetHolds ⇔ no net-new failures. Top-level passed = every suite ran AND every subsetHolds; a suite that could not RUN (worktree/spawn failure) is a non-passing INCIDENT distinct from a suite that ran and failed. Reports only — never merges, lands, or mutates the work-graph. Returns { project, epicId, base, passed, suites[] }.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project.' }, epicId: { type: 'string', description: 'The epic todo id (full uuid or leading-8 prefix).' }, base: { type: 'string', description: "Base ref to compare against (default 'master')." } }, required: ['project', 'epicId'] } },
      { name: 'forward_integrate_epic', description: "Bring an epic's collab/epic/<id8> accumulation branch UP TO DATE with trunk by MERGING trunk into it (--no-ff, NEVER rebase). Returns before/after branch sha, ahead/behind after the merge, and whether it conflicted. On conflict the merge is ABORTED and the branch is left exactly as it was — the conflicted paths are returned for a human to resolve. Integrates only; never lands.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project.' }, epicId: { type: 'string', description: 'The epic todo id (full uuid or leading-8 prefix).' }, baseRef: { type: 'string', description: "Trunk to merge in (default 'master')." } }, required: ['project', 'epicId'] } },
      { name: 'reset_todo', description: "Unstick a parked/over-retried todo and re-promote it. Use when the CAUSE of repeated rejections was fixed EXTERNALLY (a now-merged dependency, a foreign whole-tree gate error since repaired, a corrected gate command) — a todo at/over the retry budget would otherwise re-park to 'blocked' the instant it's reclaimed. Resets retryCount=0, clears acceptanceStatus + any stale claim + completion stamps, sets status (default 'ready'), and OPTIONALLY reroutes targetProject (fix a cross-project todo created without it). The supported replacement for hand-editing todos.db. Reset authority: a human, the conductor node, or this explicit MCP call.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' }, status: { type: 'string', enum: ['backlog','planned','todo','ready','in_progress','blocked','done','dropped'], description: "Status to set after reset (default 'ready'). Use 'blocked' to PARK a repeatedly-failing todo (a HOLD — not claimable, so the daemon stops re-dispatching it)." }, targetProject: { type: ['string','null'], description: 'Optional: set the implementation repo (worker cwd + gate location). Pass null to clear; omit to leave unchanged.' }, escalationId: { type: 'string', description: 'Open escalation this reset resolves (marks it resolved).' } }, required: ['project','todoId'] } },
      { name: 'override_accept_todo', description: 'Force a todo whose work is verified-done DONE+accepted, BYPASSING the mechanical gate. Use ONLY when the gate FALSE-rejected verified-green work (e.g. a whole-tree tsc tripping on a sibling lane error, or a gate command wrong for the change-set) — confirm the deliverable exists first. Unblocks dependents and rolls up parent epics exactly as a normal acceptance.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' }, completedBy: { type: 'string', description: "Completer handle for provenance (default 'operator')." }, escalationId: { type: 'string', description: 'Open escalation this override resolves (marks it resolved).' } }, required: ['project','todoId'] } },
      settleDupOfLandedToolDef,
      { name: 'edit_contract_field', description: "Append a file path to a leaf's editable v2 diff-contract (leaf_blueprint.specJson): either the top-level filesToEdit array or one task's files array. Use to legalize an incidental file the diff already touches without touching worker_ledger.outputText (append-only telemetry). Bumps specRev.", inputSchema: { type: 'object', properties: { leafId: { type: 'string' }, mutation: { type: 'object', properties: { target: { type: 'string', enum: ['filesToEdit', 'task'] }, file: { type: 'string' }, taskId: { type: 'string', description: "Required when target='task' — the task id whose files array to append to." } }, required: ['target', 'file'] } }, required: ['leafId', 'mutation'] } },
      { name: 'edit_leaf_requirement', description: "Replace one entry in a leaf's editable v2 diff-contract requirements[] at the given index (e.g. flip a mis-cited requirement to a different kind/target). `replacement` is a full DiffRequirement: kind:'symbol-present'|'named-test'|'threshold' plus that kind's fields. Bumps specRev.", inputSchema: { type: 'object', properties: { leafId: { type: 'string' }, index: { type: 'number' }, replacement: { type: 'object', description: "A DiffRequirement — { kind: 'symbol-present' | 'named-test' | 'threshold', ... kind-specific fields }.", properties: { kind: { type: 'string', enum: ['symbol-present', 'named-test', 'threshold'] } }, required: ['kind'] } }, required: ['leafId', 'index', 'replacement'] } },
      { name: 'create_gate', description: "READINESS GATE: attach a HUMAN gate to a work-todo so it can't be claimed until a human clears the gate. Creates a '[GATE]' human todo (assigneeKind:'human', ready) and appends it to the work-todo's dependsOn, parking the work-todo 'blocked'. The coordinator never claims the gate (human) nor the blocked work-todo; completing the gate auto-promotes the work-todo to 'ready' on the same tick — no reset_todo, no new status. Use to hold a design-gated/needs-review todo until a human signs off.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, workTodoId: { type: 'string', description: 'The agent work-todo to gate.' }, title: { type: 'string', description: "Gate title (auto-prefixed '[GATE]' if absent)." }, description: { type: 'string', description: 'What the human must confirm/decide.' }, gateKind: { type: 'string', description: "Optional label folded into the title, e.g. 'spec-review' → '[GATE:spec-review]'." }, parentId: { type: 'string', description: 'Optional human-gate epic to parent the gate under (e.g. the [EPIC] human-gates id).' }, decisionRef: { type: 'string', description: 'Optional decision-record id: approving that record (approve_decision_record) auto-completes this gate — for design/decision gates that clear when the design lands.' } }, required: ['project', 'workTodoId', 'title'] } },
      { name: 'leaf_inspect', description: "Per-leaf HEADLESS run view from the worker-ledger — how you watch/diagnose a leaf-executor run (it leaves NO tmux, so fleet_status/orchestrator_status are blind to it). Returns the node timeline (kind, model, input/output tokens, durationMs, exitCode, parseError [the kill/timeout reason a failed node carries — explains a blocked leaf], verdict, output EXCERPT) + the ATOMIC terminal record (effectiveOutcome incl. 'pending', reviewVerdict, pathTaken floor/waves, reason, pendingReason, gateReasons, attempts, nodesSpent) + budget/cost rollup + resumeDecisions (per-claim resume mode/reason/anomaly, ASC by decidedAt). leafId === the todoId (pass either). Node output is excerpted (~600 chars) by default since node outputs run 10-30k tokens; pass fullOutput=true for complete text. Read-only.", inputSchema: { type: 'object', properties: { leafId: { type: 'string', description: 'Leaf/todo id or prefix is NOT accepted — pass the full id (same value as todoId).' }, todoId: { type: 'string', description: 'Alias for leafId (the leaf-executor sets both to the todo id).' }, fullOutput: { type: 'boolean', description: "Return each node's FULL output text instead of a ~600-char excerpt." } } } },
      { name: 'leaf_failures', description: "Triage list of recent leaf-executor runs that did NOT end cleanly — finalOutcome in {rejected, blocked, pending} — newest-first, each with the terminal reason/pendingReason, path (floor/waves), nodesSpent and cost. The entry point for 'what headless runs broke and why'. Filter by project and/or epicId. Pass includeAll=true to list EVERY recent run regardless of outcome. Read-only.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Filter to this tracking project.' }, epicId: { type: 'string', description: 'Filter to one epic.' }, limit: { type: 'number', description: 'Max runs (default 50).' }, includeAll: { type: 'boolean', description: 'Include accepted/clean runs too.' } } } },
];

export async function handleEpicTool(name: string, args: any): Promise<string | null> {
  switch (name) {
          case 'land_epic': {
            const { project, escalationId, allowDirty, actor: actorKind, session } = args as { project: string; escalationId: string; allowDirty?: boolean; actor?: string; session?: string };
            if (!project || !escalationId) throw new Error('Missing required: project, escalationId');

            // Build the actor (default human, so every existing caller is byte-for-byte unchanged)
            let actor: LandActor = { kind: 'human' };
            if (actorKind === 'conductor') {
              if (!session) throw new Error("Missing required: session (required when actor='conductor')");
              actor = { kind: 'conductor', session };
            } else if (actorKind === 'daemon') {
              actor = { kind: 'daemon', level: 'auto' };
            }

            // Ownership gate — conductor only.
            if (actor.kind === 'conductor') {
              const esc = supervisorStore.getEscalation(escalationId);
              if (!esc || esc.kind !== 'epic-ready-to-land' || !esc.todoId) {
                return JSON.stringify({ ok: false, landed: false, reason: 'not-a-land-escalation' }, null, 2);
              }
              const child = getTodo(project, esc.todoId);
              if (!child) return JSON.stringify({ ok: false, landed: false, reason: 'todo-not-found' }, null, 2);
              const epicId = resolveEpicId(child, project);
              const own = checkOwnership(project, epicId, actor);
              if (!own.ok) {
                recordSupervisorDecision('reconcile', project, session!, JSON.stringify({ escalationId, epicId, land: 'refused', reason: own.blocker?.code, ownership: own.ownership }));
                return JSON.stringify({
                  ok: false, landed: false, epicId,
                  reason: own.blocker?.code ?? 'unauthorized',
                  ownership: own.ownership,
                  message: own.blocker?.message,
                  instruction: 'ESCALATE TO THE HUMAN. A conductor may only land epics under its own ACTIVE mission. Never land another mission\'s epic, and never land a bucket root.',
                }, null, 2);
              }
            }

            const result = await landEpic(project, escalationId, { allowDirty });
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });

            // Attach the actor and trailer to the result
            const trailer = landedByTrailer(actor);
            const payload = result.reason === 'dirty-tree'
              ? { ...result, instruction: 'Main checkout is dirty. File a todo for the daemon, or EnterWorktree to hand-code, or commit / discard the changes — then re-land. To override for this call, pass allowDirty:true.', landedBy: trailer, actor: actor.kind }
              : { ...result, landedBy: trailer, actor: actor.kind };

            // Record audit on successful land
            if (result.landed === true && result.epicId) {
              recordSupervisorDecision('reconcile', project, actor.kind === 'conductor' ? session! : actor.kind, JSON.stringify({ escalationId, epicId: result.epicId, land: 'landed', trailer }));
            }

            return JSON.stringify(payload, null, 2);
          }
          case 'inbox': {
            const { project, session } = args as { project?: string; session?: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const subs = await import('../services/session-subscriptions');
            const items = subs.drainInbox(project, session);
            // Wall-clock stamps (matches get_datetime's style): servedAt = when this drain
            // ran; per-item tsLocal = human-readable form of each event's epoch `ts`. So a
            // subscriber reading the response knows WHEN it pulled and WHEN each update fired
            // without converting epochs by hand.
            const fmt = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' });
            const now = Date.now();
            return JSON.stringify({
              count: items.length,
              servedAt: { epochMs: now, iso: new Date(now).toISOString(), local: fmt(now) },
              items: items.map((it) => ({ ...it, tsLocal: fmt(it.ts) })),
            }, null, 2);
          }
          case 'get_todo': {
            const { project, todoId } = args as { project: string; todoId: string };
            if (!project || !todoId) throw new Error('Missing required: project, todoId');
            const todo = getTodo(project, todoId);
            if (!todo) throw new Error(`todo not found: ${todoId}`);
            return JSON.stringify(deriveTodoViews(project, [todo])[0], null, 2);
          }
          case 'invariant_check': {
            const { project } = args as { project: string };
            if (!project) throw new Error('Missing required: project');
            const violations = await checkInvariants(project);
            return JSON.stringify({ violations, count: violations.length }, null, 2);
          }
          case 'gate_status': {
            const { project, limit } = args as { project: string; limit?: number };
            if (!project) throw new Error('Missing required: project');
            const status = gateStatus(project, typeof limit === 'number' ? limit : 20);
            return JSON.stringify(status, null, 2);
          }
          case 'leaf_inspect': {
            const { leafId, todoId, fullOutput } = args as { leafId?: string; todoId?: string; fullOutput?: boolean };
            const id = leafId ?? todoId;
            if (!id) throw new Error('Missing required: leafId (or todoId)');
            const run = getLeafRun(id);
            if (!run) return JSON.stringify({ ran: false, leafId: id }, null, 2);
            // Excerpt node output by default (node outputs run 10-30k tokens → context
            // bloat); fullOutput=true returns the complete text for deliberate drill-in.
            const EXCERPT = 600;
            const nodes = run.nodes.map((n) => ({
              ...n,
              outputText: n.outputText == null
                ? null
                : fullOutput || n.outputText.length <= EXCERPT
                  ? n.outputText
                  : `${n.outputText.slice(0, EXCERPT)}\n…[+${n.outputText.length - EXCERPT} chars — pass fullOutput=true]`,
            }));
            return JSON.stringify({ ran: true, ...run, nodes }, null, 2);
          }
          case 'leaf_failures': {
            const { project, epicId, limit, includeAll } = args as { project?: string; epicId?: string; limit?: number; includeAll?: boolean };
            const all = listLeafRuns({ project, epicId, limit: limit ?? 50 });
            const runs = includeAll ? all : all.filter((r) => r.finalOutcome != null && r.finalOutcome !== 'accepted');
            return JSON.stringify({ count: runs.length, runs }, null, 2);
          }
          case 'epic_branch_status': {
            const { project, baseRef } = args as { project: string; baseRef?: string };
            if (!project) throw new Error('Missing required: project');
            const report = await getEpicBranchStatus(project, baseRef || 'master');
            return JSON.stringify(report, null, 2);
          }
          case 'epic_land_readiness': {
            const { project, epicId: epicIdArg } = args as { project: string; epicId: string };
            if (!project) throw new Error('Missing required: project');
            if (!epicIdArg) throw new Error('Missing required: epicId');
            const { getEpicLandReadiness } = await import('../services/epic-land-readiness.js');
            // Resolve short-id prefix via getTodo (the standard short-id convention).
            const resolved = getTodo(project, epicIdArg);
            const epicId = resolved?.id ?? epicIdArg;
            const report = await getEpicLandReadiness(project, epicId);
            return JSON.stringify(report, null, 2);
          }
          case 'land_telemetry_report': {
            const { project, sinceMs, untilMs } = args as { project: string; sinceMs?: number; untilMs?: number };
            if (!project) throw new Error('Missing required: project');
            const { reportLandCycles } = await import('../services/land-telemetry-report.js');
            const resolvedUntilMs = untilMs ?? Date.now();
            const resolvedSinceMs = sinceMs ?? resolvedUntilMs - 24 * 60 * 60 * 1000;
            const report = await reportLandCycles(project, { sinceMs: resolvedSinceMs, untilMs: resolvedUntilMs });
            return JSON.stringify(report, null, 2);
          }
          case 'verify_epic': {
            const { project, epicId: epicIdArg, base } = args as { project: string; epicId: string; base?: string };
            if (!project) throw new Error('Missing required: project');
            if (!epicIdArg) throw new Error('Missing required: epicId');
            const resolved = getTodo(project, epicIdArg);
            const epicId = resolved?.id ?? epicIdArg;
            const result = await verifyEpic(project, epicId, { base });
            return JSON.stringify(result, null, 2);
          }
          case 'forward_integrate_epic': {
            const { project, epicId, baseRef } = args as { project: string; epicId: string; baseRef?: string };
            if (!project) throw new Error('Missing required: project');
            if (!epicId) throw new Error('Missing required: epicId');
            const { forwardIntegrateEpicTool } = await import('../services/forward-integrate-epic.js');
            const result = await forwardIntegrateEpicTool(project, epicId, { baseRef });
            return JSON.stringify(result, null, 2);
          }
          case 'complete_todo': {
            const { project, todoId, acceptance, claimToken } = args as { project: string; todoId: string; acceptance: 'accepted' | 'rejected'; claimToken?: string };
            if (!project || !todoId || !acceptance) throw new Error('Missing required: project, todoId, acceptance');
            const result = await handleWorkerComplete(makeCoordinatorDeps(), project, todoId, acceptance, claimToken);
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });
            return JSON.stringify(result, null, 2);
          }
          case 'reset_todo': {
            const { project, todoId, status, targetProject, escalationId } = args as { project: string; todoId: string; status?: import('../services/todo-store.js').TodoStatus; targetProject?: string | null; escalationId?: string };
            if (!project || !todoId) throw new Error('Missing required: project, todoId');
            // Explicit operator/MCP reset — the manual undo. resetTodo also auto-resolves
            // the todo's stale escalations; resolve the linked one explicitly when supplied.
            const result = await resetTodo(project, todoId, status ?? 'ready', targetProject);
            if (escalationId) supervisorStore.resolveEscalation(escalationId, 'resolved');
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });
            return JSON.stringify(deriveTodoViews(project, [result])[0], null, 2);
          }
          case 'create_gate': {
            const { project, workTodoId, title, description, gateKind, parentId, decisionRef } = args as { project: string; workTodoId: string; title: string; description?: string | null; gateKind?: string; parentId?: string | null; decisionRef?: string | null };
            if (!project || !workTodoId || !title) throw new Error('Missing required: project, workTodoId, title');
            const result = await createGate(project, { workTodoId, title, description, gateKind, parentId, decisionRef });
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });
            return JSON.stringify(result, null, 2);
          }
          case 'override_accept_todo': {
            const { project, todoId, completedBy, escalationId } = args as { project: string; todoId: string; completedBy?: string; escalationId?: string };
            if (!project || !todoId) throw new Error('Missing required: project, todoId');
            // Explicit operator/MCP force-accept.
            const result = await overrideAcceptTodo(project, todoId, completedBy ?? 'operator');
            if (escalationId) supervisorStore.resolveEscalation(escalationId, 'resolved');
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });
            return JSON.stringify({ ...result, completed: deriveTodoViews(project, [result.completed])[0] }, null, 2);
          }
          case 'settle_dup_of_landed': return await settleDupOfLandedHandler(args as any);
          case 'edit_contract_field': {
            const { leafId, mutation } = args as { leafId: string; mutation: { target: 'filesToEdit' | 'task'; file: string; taskId?: string } };
            if (!leafId || !mutation?.target || !mutation?.file) throw new Error('Missing required: leafId, mutation.target, mutation.file');
            const contractMutation = mutation.target === 'task'
              ? { target: 'task' as const, taskId: mutation.taskId!, file: mutation.file }
              : { target: 'filesToEdit' as const, file: mutation.file };
            const ok = editContractField(leafId, contractMutation);
            return JSON.stringify({ ok, leafId }, null, 2);
          }
          case 'edit_leaf_requirement': {
            const { leafId, index, replacement } = args as { leafId: string; index: number; replacement: import('../services/diff-contract.js').DiffRequirement };
            if (!leafId || typeof index !== 'number' || !replacement?.kind) throw new Error('Missing required: leafId, index, replacement');
            const ok = editLeafRequirement(leafId, index, replacement);
            return JSON.stringify({ ok, leafId }, null, 2);
          }
          default:
            return null;
  }
}
