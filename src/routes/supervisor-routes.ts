import {
  addWatchedProject,
  removeWatchedProject,
  listWatchedProjects,
  addSupervised,
  removeSupervised,
  listSupervised,
  listOpenEscalations,
  listEscalations,
  resolveEscalation,
  getEscalation,
  recordEscalationDecision,
  getSupervisorIdentity,
  SUPERVISOR_HEARTBEAT_INTERVAL_MS,
  SUPERVISOR_STALE_AFTER_MS,
  getPeer,
  getSupervisorConfig,
  setSupervisorConfig,
  listSupervisorAudit,
  getWatchdogThreshold,
  setWatchdogThreshold,
  setEscalationRoute,
} from '../services/supervisor-store.ts';
import { DEFAULT_WATCHDOG_CONFIG } from '../services/context-watchdog.ts';
import { createItem, listItems, updateItem, deleteItem } from '../services/roadmap-store.ts';
import { projectRegistry } from '../services/project-registry.ts';
import { listTodos, updateTodo, getTodo, removeTodo } from '../services/todo-store.ts';
import { isInboxEpic } from '../services/claimability.ts';
import { listDecisionRecords, createDecisionRecord, type DecisionStatus, type RequirementSpec } from '../services/decision-record-store.ts';
import { listObjects, listTypes } from '../services/system-object-store.ts';
import { bom } from '../services/system-object-bom.ts';
import { satisfy } from '../services/system-object-edges.ts';
import { specCoverage, decideRequirement, type RequirementDecision } from '../services/spec-coverage.ts';
import { landEpic, getWorktreeManager } from '../services/coordinator-live.ts';
import { requestSelfDeploy, selfDeployEligibility, getLastSelfLandAt } from '../services/deploy-service.ts';
import { systemStatus } from '../services/system-status.ts';
import { execFileSync } from 'node:child_process';
import { SUPERVISOR_PROJECT, SUPERVISOR_SESSION, STEWARD_PROJECT, STEWARD_SESSION } from '../config.ts';
import { sendTmuxKeys } from '../services/tmux-send.ts';
import { getWebSocketHandler } from '../services/ws-handler-manager.ts';
import { capturePaneText } from '../services/tmux-capture.ts';

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function handleSupervisorRoutes(req: Request, url: URL): Promise<Response | null> {
  // PROJECTS
  if (url.pathname === '/api/supervisor/projects' && req.method === 'GET') {
    return Response.json({ projects: listWatchedProjects() });
  }

  // UNLANDED EPICS — deterministic git-tree drift readout (design-epic-landing P1):
  // collab/epic/* branches with commits NOT on master = accepted work stranded
  // off-master. Derived purely from `git rev-list master..<branch>` (not from land
  // cards), so an orphaned epic with no card still surfaces. Read-only; never lands.
  if (url.pathname === '/api/supervisor/unlanded-epics' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project query param is required', 400);
    try {
      const unlandedEpics = await getWorktreeManager(project).listUnlandedEpics();
      return Response.json({ unlandedEpics });
    } catch (err) {
      // Non-git / transient project → empty, never error the Bridge.
      return Response.json({ unlandedEpics: [] });
    }
  }

  // ESCALATION HISTORY — read-only OPEN+RESOLVED escalation trail (escalation_list
  // is open-only). The frontend's per-epic history view (epicHistory) fetches this
  // ON OPEN with an epicId, getting the epic's escalations (with triage outcome) AND
  // its decision records folded in (getEscalationHistory does both). Mirrors the MCP
  // escalation_history tool. REST-poll/on-demand only — NO new WS event, no polling.
  if (url.pathname === '/api/supervisor/escalation-history' && req.method === 'GET') {
    try {
      const { getEscalationHistory } = await import('../services/escalation-history.ts');
      const sp = url.searchParams;
      const num = (k: string): number | undefined => {
        const v = sp.get(k);
        if (v == null) return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };
      const f: Parameters<typeof getEscalationHistory>[0] = {};
      const str = (k: string) => sp.get(k) ?? undefined;
      if (str('epicId')) f.epicId = str('epicId');
      if (str('project')) f.project = str('project');
      if (str('todoId')) f.todoId = str('todoId');
      if (str('session')) f.session = str('session');
      if (str('status')) f.status = str('status');
      if (str('kind')) f.kind = str('kind');
      if (str('routedTo')) f.routedTo = str('routedTo');
      if (num('since') !== undefined) f.since = num('since');
      if (num('until') !== undefined) f.until = num('until');
      if (num('limit') !== undefined) f.limit = num('limit');
      if (sp.get('summary') === 'true') f.summary = true;
      return Response.json(getEscalationHistory(f));
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  if (url.pathname === '/api/supervisor/projects' && req.method === 'POST') {
    try {
      const { project } = (await req.json()) as { project?: string };
      if (!project) return jsonError('project is required', 400);
      addWatchedProject(project);
      // Unified project list: watching a project also registers it in the global
      // project registry so it shows up on the Watching surface too. Best-effort —
      // a watched path that doesn't exist on disk still watches (register throws).
      await projectRegistry.register(project).catch(() => {});
      return Response.json({ projects: listWatchedProjects() });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  if (url.pathname === '/api/supervisor/projects' && req.method === 'DELETE') {
    try {
      const { project } = (await req.json()) as { project?: string };
      if (!project) return jsonError('project is required', 400);
      removeWatchedProject(project);
      // Unified project list: unwatching removes it from the global registry too.
      await projectRegistry.unregister(project).catch(() => {});
      return Response.json({ projects: listWatchedProjects() });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // SUPERVISED
  if (url.pathname === '/api/supervisor/supervised' && req.method === 'GET') {
    return Response.json({ supervised: listSupervised() });
  }

  if (url.pathname === '/api/supervisor/supervised' && req.method === 'POST') {
    try {
      const { project, session, source } = (await req.json()) as {
        project?: string;
        session?: string;
        source?: string;
      };
      if (!project || !session) return jsonError('project and session are required', 400);
      addSupervised(project, session, (source ?? 'manual') as 'roadmap' | 'manual' | 'spawn');
      // Ensure the supervisor actually monitors this session's project.
      // supervisor_reconcile iterates watched projects to fetch session
      // statuses; without this, supervising a session in an unwatched project
      // leaves it invisible to reconcile (it'd be treated as not-supervised).
      addWatchedProject(project);
      return Response.json({ supervised: listSupervised() });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  if (url.pathname === '/api/supervisor/supervised' && req.method === 'DELETE') {
    try {
      const { project, session } = (await req.json()) as { project?: string; session?: string };
      if (!project || !session) return jsonError('project and session are required', 400);
      removeSupervised(project, session);
      return Response.json({ supervised: listSupervised() });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // ROADMAP
  if (url.pathname === '/api/supervisor/roadmap' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project is required', 400);
    return Response.json({ items: listItems(project) });
  }

  // PROJECT TODOS (PCS Phase 5) — the unified work-graph for an entire project,
  // across all its sessions. This is the data source for the project Plan
  // (re-points the Plan off the legacy roadmap_item table onto unified todos).
  if (url.pathname === '/api/supervisor/todos' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project is required', 400);
    const includeCompletedParam = url.searchParams.get('includeCompleted');
    const includeCompleted = includeCompletedParam === null ? true : includeCompletedParam !== 'false';
    try {
      // No session filter → all todos for the project.
      return Response.json({ todos: listTodos(project, { includeCompleted }) });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // PROMOTE / EDIT A PROJECT TODO (PCS Phase 5) — the Planner promotes plan items
  // to `ready` (the sole planned→ready promoter; the Coordinator never self-promotes).
  // Project-scoped by id; no session needed.
  if (url.pathname === '/api/supervisor/todos' && req.method === 'PATCH') {
    try {
      const { project, id, status } = (await req.json()) as {
        project?: string;
        id?: string;
        status?: import('../services/todo-store.ts').TodoStatus;
      };
      if (!project || !id) return jsonError('project and id are required', 400);
      // De-conflate S3: the Planner approves by writing the DECISION axis
      // (approvedAt/approvedBy), not the derived `ready` status. status==='ready'
      // means "approve to run"; updateTodo's write-side seam also translates a raw
      // status:'ready' the same way, but the Planner writes approvedAt directly with
      // its audit handle, and the seam fires kick('approved') on the null→non-null.
      let patch: import('../services/todo-store.ts').UpdateTodoPatch = {};
      if (status === 'ready') {
        // Inbox = planning-only: refuse to approve a triage child of [EPIC] Inbox.
        // Approving it is itself the mistake — it would look ready but the daemon's
        // claim gate ('inbox-planning') will never run it. Re-home to a real epic
        // first. Only the approve/promote-to-ready action is blocked; other status
        // transitions are unaffected.
        const target = getTodo(project, id);
        const parent = target?.parentId ? getTodo(project, target.parentId) : undefined;
        if (parent && isInboxEpic(parent)) {
          return jsonError(
            'Cannot approve a todo parented under [EPIC] Inbox — re-home it to a real epic before approving.',
            400,
          );
        }
        patch = { approvedAt: new Date().toISOString(), approvedBy: 'planner' };
      } else if (status) patch = { status };
      const todo = await updateTodo(project, id, patch);
      return Response.json({ todo });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // DELETE A PROJECT TODO (work-graph) — project-scoped by id. Backs the Kanban
  // "Clear completed" housekeeping action. Earlier this path wrongly hit
  // /api/supervisor/roadmap → deleteItem (the roadmap_item table), so the DELETE
  // matched 0 rows and clear-completed silently no-opped on every work-graph todo
  // (most visibly the Inbox epic). removeTodo deletes from the todos table.
  if (url.pathname === '/api/supervisor/todos' && req.method === 'DELETE') {
    try {
      const { project, id } = (await req.json()) as { project?: string; id?: string };
      if (!project || !id) return jsonError('project and id are required', 400);
      await removeTodo(project, id);
      return Response.json({ ok: true });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // RESET A STUCK TODO — clear the claim/lease/retry/acceptance state and put it
  // back to `ready` so the Orchestrator's Build pass can claim it again. The UI
  // "unstick" button on the todo detail view; wraps todo-store resetTodo.
  if (url.pathname === '/api/supervisor/todos/reset' && req.method === 'POST') {
    try {
      const { project, id } = (await req.json()) as { project?: string; id?: string };
      if (!project || !id) return jsonError('project and id are required', 400);
      const { resetTodo } = await import('../services/todo-store.ts');
      const todo = await resetTodo(project, id, 'ready');
      getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });
      return Response.json({ todo });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // AUDIT TRACE (observability) — unified orchestration trace from the supervisor audit log.
  if (url.pathname === '/api/supervisor/audit' && req.method === 'GET') {
    const project = url.searchParams.get('project') ?? undefined;
    const kind = url.searchParams.get('kind') ?? undefined;
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? Number(limitRaw) : undefined;
    return Response.json({ entries: listSupervisorAudit({ project, kind, limit }) });
  }

  if (url.pathname === '/api/supervisor/roadmap' && req.method === 'POST') {
    try {
      const { project, title, description, parentId, dependsOn } = (await req.json()) as {
        project?: string;
        title?: string;
        description?: string;
        parentId?: string;
        dependsOn?: string[];
      };
      if (!project || !title) return jsonError('project and title are required', 400);
      const item = await createItem(project, { title, description, parentId, dependsOn });
      return Response.json({ item });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  if (url.pathname === '/api/supervisor/roadmap' && req.method === 'PATCH') {
    try {
      const { project, id, ...patch } = (await req.json()) as {
        project?: string;
        id?: string;
        [key: string]: unknown;
      };
      if (!project || !id) return jsonError('project and id are required', 400);
      const item = await updateItem(project, id, patch);
      return Response.json({ item });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  if (url.pathname === '/api/supervisor/roadmap' && req.method === 'DELETE') {
    try {
      const { project, id } = (await req.json()) as { project?: string; id?: string };
      if (!project || !id) return jsonError('project and id are required', 400);
      await deleteItem(project, id);
      return Response.json({ ok: true });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // ESCALATIONS
  // Mobile-parity audit (Z9): every READ is a plain HTTP GET read-model; every MUTATION
  // returns JSON AND, where it changes shared zone state, emits a WS event the client
  // folds. mark/resolve → escalation_created (full row); refresh-summary →
  // session_summary_updated (loop helper). No route depends on MCP, hover-to-reveal, or
  // a desktop-only capability. The contract is fully HTTP+WS → Phase-2 mobile app is a
  // straight thin-client port.
  if (url.pathname === '/api/supervisor/escalations/resolve' && req.method === 'POST') {
    try {
      const { id, status } = (await req.json()) as { id?: string; status?: string };
      if (!id || !status) return jsonError('id and status are required', 400);
      const esc = getEscalation(id);
      resolveEscalation(id, status, 'human'); // user clicked Resolve (fd934fb7)
      getWebSocketHandler()?.broadcast({
        type: 'escalation_created',
        project: esc?.project ?? '', session: esc?.session ?? '', kind: esc?.kind ?? '',
        id, routedTo: esc?.routedTo ?? 'human', escalation: getEscalation(id),
      });
      return Response.json({ ok: true });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // POST /api/supervisor/escalations/mark — the Z9 operator "only you" pin. Forces the
  // escalation onto the human floor (deterministic outranking) via setEscalationRoute,
  // then re-broadcasts the full row (escalation_created upsert convention) so every
  // client re-sorts. Pass operatorGated:false to clear the pin (route back to steward).
  if (url.pathname === '/api/supervisor/escalations/mark' && req.method === 'POST') {
    try {
      const { id, operatorGated } = (await req.json()) as { id?: string; operatorGated?: boolean };
      if (!id) return jsonError('id is required', 400);
      const esc = getEscalation(id);
      if (!esc) return jsonError(`escalation not found: ${id}`, 404);
      const pin = operatorGated !== false; // default mark=on
      setEscalationRoute(id, pin ? 'human' : 'steward', pin ? 'operator-marked: only you' : null);
      const updated = getEscalation(id);
      getWebSocketHandler()?.broadcast({
        type: 'escalation_created',
        project: esc.project, session: esc.session, kind: esc.kind, id,
        routedTo: updated?.routedTo ?? 'human', escalation: updated,
      });
      return Response.json({ escalation: updated });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // POST /api/supervisor/escalations/land — the land click (FBPE P4). Re-derives
  // land-readiness server-side, performs ONE --no-ff epic→master merge behind the
  // per-project land mutex, removes the epic branch/worktree, and resolves the card.
  // A conflict leaves master untouched and re-surfaces a human-rebase escalation.
  if (url.pathname === '/api/supervisor/escalations/land' && req.method === 'POST') {
    try {
      const { project, escalationId } = (await req.json()) as { project?: string; escalationId?: string };
      if (!project || !escalationId) return jsonError('project and escalationId are required', 400);
      const result = await landEpic(project, escalationId);
      getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });
      return Response.json(result);
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // GET /api/supervisor/deploy-status?project= — the deploy-drift read-model the
  // UI banner renders. Combines version-string drift (system-status DeployDrift)
  // with the PRECISE staleness signal it misses: a self-land that happened AFTER
  // the live sidecar started (master advanced even if the version string didn't).
  // `canDeploy` reflects the same hard gates the POST enforces, so the UI only
  // offers the button where a deploy would actually run.
  if (url.pathname === '/api/supervisor/deploy-status' && req.method === 'GET') {
    try {
      const project = url.searchParams.get('project');
      if (!project) return jsonError('project is required', 400);
      const status = await systemStatus(project);
      const liveStartedMs = status.deploy.liveStartedAt ? Date.parse(status.deploy.liveStartedAt) : null;
      const lastSelfLandAt = getLastSelfLandAt();
      const selfLandPending = lastSelfLandAt != null && (liveStartedMs == null || lastSelfLandAt > liveStartedMs);
      const gate = selfDeployEligibility(project);
      // Staleness for the banner is NOT system-status `drift`: that counts ALL
      // uncommitted paths including UNTRACKED scratch (leaf-blueprints, daemon-*.ts),
      // which would keep the banner lit forever even right after a clean deploy.
      // The banner means "the deployed binary doesn't reflect the committed source":
      // a version bump, a self-land post-dating the build, or MODIFIED TRACKED files
      // (real uncommitted code) — untracked junk is excluded.
      const versionDrift =
        status.deploy.liveVersion != null &&
        status.deploy.repoVersion != null &&
        status.deploy.liveVersion !== status.deploy.repoVersion;
      let modifiedTrackedCount = 0;
      try {
        const out = execFileSync('git', ['-C', project, 'status', '--porcelain', '--untracked-files=no'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        modifiedTrackedCount = out.split('\n').filter((l) => l.trim().length > 0).length;
      } catch {
        modifiedTrackedCount = 0;
      }
      const stale = versionDrift || selfLandPending || modifiedTrackedCount > 0;
      return Response.json({
        ...status.deploy,
        selfLandPending,
        lastSelfLandAt,
        versionDrift,
        modifiedTrackedCount,
        stale,
        canDeploy: gate.eligible,
        deployBlockedReason: gate.eligible ? null : gate.reason,
      });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // POST /api/supervisor/deploy — human-gated self-deploy (land-deploy-hook-design).
  // Strictly SEPARATE from land: this rebuilds + restarts the running sidecar. The
  // server hard-gates self-project (project === MERMAID_PROJECT) inside
  // requestSelfDeploy, so a crafted request can't deploy another repo. The deploy
  // is spawned detached and will kill+relaunch this very process — so we respond
  // immediately; the detached child owns the actual deploy regardless.
  if (url.pathname === '/api/supervisor/deploy' && req.method === 'POST') {
    try {
      const { project, force } = (await req.json()) as { project?: string; force?: boolean };
      if (!project) return jsonError('project is required', 400);
      const result = requestSelfDeploy(project, { force: !!force });
      return Response.json(result, { status: result.ok ? 200 : 409 });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  if (url.pathname === '/api/supervisor/escalations' && req.method === 'GET') {
    const status = url.searchParams.get('status');
    if (status) {
      return Response.json({ escalations: listEscalations(status) });
    }
    return Response.json({ escalations: listOpenEscalations() });
  }

  // POST /api/supervisor/escalation/:id/decide — record a human's answer to a
  // (structured) escalation and resolve it. Paired with the await_human_decision
  // MCP tool, which polls the decision store until this lands (ED2 poll-await relay).
  {
    const decideMatch = url.pathname.match(/^\/api\/supervisor\/escalation\/([^/]+)\/decide$/);
    if (decideMatch && req.method === 'POST') {
      try {
        const id = decodeURIComponent(decideMatch[1]);
        const { optionId, note } = (await req.json()) as { optionId?: string; note?: string };
        const esc = getEscalation(id);
        if (!esc) return jsonError(`escalation not found: ${id}`, 404);
        // When the escalation carries structured options, the optionId must name
        // one of them; a note-only answer (no options / no optionId) is allowed.
        if (esc.options && esc.options.length > 0) {
          if (!optionId) return jsonError('optionId is required for a structured escalation', 400);
          if (!esc.options.some((o) => o.id === optionId)) {
            return jsonError(`optionId "${optionId}" is not one of the escalation's options`, 400);
          }
        }
        const decision = recordEscalationDecision({ escalationId: id, optionId: optionId ?? null, note: note ?? null, decidedBy: 'human' });
        resolveEscalation(id, 'decided', 'human');
        getWebSocketHandler()?.broadcast({ type: 'escalation_decided', project: esc.project, session: esc.session, id, optionId: decision.optionId });
        return Response.json({ ok: true, decision });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
      }
    }
  }

  if (url.pathname === '/api/supervisor/config' && req.method === 'GET') {
    const stored = getSupervisorConfig();
    if (stored) {
      return Response.json({ supervisorProject: stored.supervisorProject, supervisorSession: stored.supervisorSession });
    }
    return Response.json({ supervisorProject: SUPERVISOR_PROJECT, supervisorSession: SUPERVISOR_SESSION });
  }

  if (url.pathname === '/api/supervisor/config' && req.method === 'POST') {
    try {
      const { supervisorProject, supervisorSession } = (await req.json()) as {
        supervisorProject?: string;
        supervisorSession?: string;
      };
      if (!supervisorProject || !supervisorSession) return jsonError('supervisorProject and supervisorSession are required', 400);
      const config = setSupervisorConfig(supervisorProject, supervisorSession);
      return Response.json({ supervisorProject: config.supervisorProject, supervisorSession: config.supervisorSession });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  if (url.pathname === '/api/supervisor/steward-config' && req.method === 'GET') {
    // Steward defaults mirror the supervisor: a fixed global workspace, not the
    // current active project (the steward is a fleet-wide role like the supervisor).
    return Response.json({ stewardProject: STEWARD_PROJECT, stewardSession: STEWARD_SESSION });
  }

  // GET /api/supervisor/watchdog-threshold?project= — the context-watchdog trigger
  // threshold (%), or null when it falls back to the default (DEFAULT_WATCHDOG_CONFIG=80).
  if (url.pathname === '/api/supervisor/watchdog-threshold' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project is required', 400);
    return Response.json({
      project,
      thresholdPercent: getWatchdogThreshold(project),
      default: DEFAULT_WATCHDOG_CONFIG.thresholdPercent,
    });
  }

  // POST /api/supervisor/watchdog-threshold — REST parity for the set_watchdog_threshold
  // MCP tool. thresholdPercent:null clears (revert to default). Validation MIRRORS the MCP
  // tool (setup.ts:5148) so REST and MCP stay in lockstep.
  if (url.pathname === '/api/supervisor/watchdog-threshold' && req.method === 'POST') {
    try {
      const { project, thresholdPercent } = (await req.json()) as {
        project?: string; thresholdPercent?: number | null;
      };
      if (!project) return jsonError('project is required', 400);
      if (thresholdPercent !== null && thresholdPercent !== undefined &&
          (typeof thresholdPercent !== 'number' || !Number.isFinite(thresholdPercent) ||
           thresholdPercent < 1 || thresholdPercent > 100)) {
        return jsonError('thresholdPercent must be a number 1-100, or null to clear', 400);
      }
      setWatchdogThreshold(project, thresholdPercent ?? null);
      return Response.json({
        project,
        thresholdPercent: getWatchdogThreshold(project),
        default: DEFAULT_WATCHDOG_CONFIG.thresholdPercent,
      });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  if (url.pathname === '/api/supervisor/nudge' && req.method === 'POST') {
    try {
      const { project, session, serverId, text } = (await req.json()) as {
        project?: string;
        session?: string;
        serverId?: string;
        text?: string;
      };
      if (!project || !session || !text) return jsonError('project, session, and text are required', 400);
      let result: any;
      let sent: boolean;
      if (serverId && getPeer(serverId)) {
        const peer = getPeer(serverId)!;
        // Tokenless direct nudge (P1 §2): peers carry no token. A token-enforcing
        // peer 401s here and the nudge degrades to desktop-brokered routing.
        const res = await fetch(peer.baseUrl + '/api/ide/tmux-send-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project, session, text }),
        });
        result = await res.json();
        sent = !!(result?.sent ?? result?.tmux ?? result?.success);
      } else {
        result = await sendTmuxKeys(project, session, text);
        sent = !!result?.sent;
      }
      getWebSocketHandler()?.broadcast({ type: 'supervisor_nudge', project, session, serverId: serverId ?? '', text, sent });
      return Response.json(result);
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // POST /api/supervisor/capture-pane — on-demand raw tmux pane read ("show the
  // lines it read"). Mirrors the nudge route's peer/local branch but READS instead
  // of writes (NOT a stream): peer → forward to peer's /api/ide/capture-pane;
  // local → capturePaneText helper. No WS broadcast (pure read).
  if (url.pathname === '/api/supervisor/capture-pane' && req.method === 'POST') {
    try {
      const { project, session, serverId } = (await req.json()) as {
        project?: string;
        session?: string;
        serverId?: string;
      };
      if (!project || !session) return jsonError('project and session are required', 400);
      if (serverId && getPeer(serverId)) {
        const peer = getPeer(serverId)!;
        const res = await fetch(peer.baseUrl + '/api/ide/capture-pane', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project, session }),
        });
        return Response.json(await res.json());
      }
      const lines = await capturePaneText(project, session);
      return Response.json({ lines });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // POST /api/supervisor/refresh-summary — force a fresh out-of-band session summary
  // (Z9 force-proof): re-hash + re-summarize even when the pane hash is unchanged. A
  // remote session forwards to the peer that owns its tmux + summary cache (like
  // capture-pane). Best-effort: if the summary-loop service isn't deployed yet, report
  // ok:false rather than 500. The loop helper broadcasts session_summary_updated itself.
  if (url.pathname === '/api/supervisor/refresh-summary' && req.method === 'POST') {
    try {
      const { project, session, serverId } = (await req.json()) as {
        project?: string; session?: string; serverId?: string;
      };
      if (!project || !session) return jsonError('project and session are required', 400);
      if (serverId && getPeer(serverId)) {
        const peer = getPeer(serverId)!;
        const res = await fetch(peer.baseUrl + '/api/supervisor/refresh-summary', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project, session }),
        });
        return Response.json(await res.json());
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod: any = await import('../services/session-summary-loop.ts');
        const summary = await mod.refreshSummaryNow(project, session, { force: true });
        return Response.json({ ok: true, summary });
      } catch {
        // Loop service not yet deployed → degrade, never error the Bridge.
        return Response.json({ ok: false, reason: 'summary loop unavailable', summary: null });
      }
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  if (url.pathname === '/api/supervisor/identity' && req.method === 'GET') {
    const identity = getSupervisorIdentity();
    if (!identity) {
      // No supervisor registered: report not-running rather than bare null so
      // the client can render a definitive "no supervisor" state.
      return Response.json({
        identity: null,
        running: false,
        stale: true,
        ageMs: null,
        heartbeatIntervalMs: SUPERVISOR_HEARTBEAT_INTERVAL_MS,
        staleAfterMs: SUPERVISOR_STALE_AFTER_MS,
      });
    }
    // Compute liveness from how long ago the heartbeat last advanced updatedAt.
    const ageMs = Date.now() - identity.updatedAt;
    const stale = ageMs > SUPERVISOR_STALE_AFTER_MS;
    return Response.json({
      // Spread identity fields at top level for backward compatibility with
      // existing callers that read { project, session, updatedAt, serverId }.
      ...identity,
      identity,
      running: !stale,
      stale,
      ageMs,
      heartbeatIntervalMs: SUPERVISOR_HEARTBEAT_INTERVAL_MS,
      staleAfterMs: SUPERVISOR_STALE_AFTER_MS,
    });
  }

  // GET /api/supervisor/steward-identity — Retired in Phase 1 (decision f0ec0b06)
  // — the Orchestrator daemon replaces the Supervisor/Steward sessions; kept as a
  // dormant no-op for back-compat so any stale callers get a well-typed response.
  if (url.pathname === '/api/supervisor/steward-identity' && req.method === 'GET') {
    return Response.json({
      identity: null,
      running: false,
      stale: true,
      ageMs: null,
      overrideAccepts: 0,
      switchedOn: false,
      mode: 'off',
      heartbeatIntervalMs: SUPERVISOR_HEARTBEAT_INTERVAL_MS,
      staleAfterMs: SUPERVISOR_STALE_AFTER_MS,
    });
  }

  // POST /api/supervisor/steward/mode — Retired in Phase 1 (decision f0ec0b06)
  // — the Orchestrator daemon replaces the Supervisor/Steward sessions; kept as a
  // dormant no-op for back-compat.
  if (url.pathname === '/api/supervisor/steward/mode' && req.method === 'POST') {
    return Response.json({ ok: true, note: 'retired' });
  }

  // POST /api/supervisor/steward/enabled — Retired in Phase 1 (decision f0ec0b06)
  // — the Orchestrator daemon replaces the Supervisor/Steward sessions; kept as a
  // dormant no-op for back-compat.
  if (url.pathname === '/api/supervisor/steward/enabled' && req.method === 'POST') {
    return Response.json({ ok: true, note: 'retired' });
  }

  // POST /api/supervisor/role/stop — Retired in Phase 1 (decision f0ec0b06)
  // — the Orchestrator daemon replaces the Supervisor/Steward sessions; no tmux
  // session is spawned for these roles anymore. Kept as a dormant no-op for
  // back-compat so stale callers don't crash.
  if (url.pathname === '/api/supervisor/role/stop' && req.method === 'POST') {
    return Response.json({ stopped: false, reason: 'role sessions retired (orchestrator daemon)' });
  }

  // ── SPEC API SURFACE (design-system-object-ui §8) ──────────────────────────
  // The seam every spec UI leaf builds against: requirements feed, inline-cheap
  // coverage (Todo.objectRef join), the durable object tree, BOM rollup, and the
  // requirement decision (approve/edit/reject). REST-poll on the Bridge cadence —
  // NO new WS events.

  // GET /api/supervisor/requirements?project=&epicId=&status= — the RequirementsInbox
  // feed: requirement-kind decision records (all statuses by default).
  if (url.pathname === '/api/supervisor/requirements' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project is required', 400);
    const filter: { kind: 'requirement'; epicId?: string | null; status?: DecisionStatus } = { kind: 'requirement' };
    const epicId = url.searchParams.get('epicId');
    if (epicId !== null) filter.epicId = epicId;
    const status = url.searchParams.get('status');
    if (status) filter.status = status as DecisionStatus;
    try {
      return Response.json({ requirements: listDecisionRecords(project, filter) });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // GET /api/supervisor/coverage?project= — inline-cheap coverage rollup over the
  // Todo.objectRef → SystemObject join (no full-tree walk, no per-change recompute).
  if (url.pathname === '/api/supervisor/coverage' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project is required', 400);
    try {
      return Response.json({ coverage: specCoverage(project) });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // GET /api/supervisor/system-objects?project= — the durable object tree (+ type
  // registry) the Spec Sheet renders via deriveSystemNodes.
  if (url.pathname === '/api/supervisor/system-objects' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project is required', 400);
    try {
      return Response.json({ objects: listObjects(project), types: listTypes(project) });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // GET /api/supervisor/bom?project=&rootId= — rolled-up bill-of-materials beneath
  // a root object (derived recursive-CTE; never stored).
  if (url.pathname === '/api/supervisor/bom' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    const rootId = url.searchParams.get('rootId');
    if (!project || !rootId) return jsonError('project and rootId are required', 400);
    try {
      return Response.json({ lines: bom(project, rootId) });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // POST /api/supervisor/requirements — propose a new requirement (the Spec Sheet
  // '+ promise' composer). Creates a requirement-kind decision record in 'proposed'
  // status, which then flows to the Bridge RequirementsInbox for signature.
  if (url.pathname === '/api/supervisor/requirements' && req.method === 'POST') {
    try {
      const { project, title, spec, epicId, rationale, authorSession } = (await req.json()) as {
        project?: string;
        title?: string;
        spec?: RequirementSpec | null;
        epicId?: string | null;
        rationale?: string | null;
        authorSession?: string | null;
      };
      if (!project || !title) return jsonError('project and title are required', 400);
      const rec = createDecisionRecord(project, { kind: 'requirement', title, spec: spec ?? null, epicId: epicId ?? null, rationale: rationale ?? null, authorSession: authorSession ?? null });
      return Response.json({ requirement: rec });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // POST /api/supervisor/requirements/decide — sign/reject/re-sign a requirement,
  // reusing the decision-record approve/supersede path. Mirrors decideEscalation.
  if (url.pathname === '/api/supervisor/requirements/decide' && req.method === 'POST') {
    try {
      const { project, id, decision, approvedBy, spec, title } = (await req.json()) as {
        project?: string;
        id?: string;
        decision?: RequirementDecision;
        approvedBy?: string;
        spec?: RequirementSpec;
        title?: string;
      };
      if (!project || !id || !decision) return jsonError('project, id, and decision are required', 400);
      const result = decideRequirement(project, { id, decision, approvedBy, spec, title });
      return Response.json(result);
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // POST /api/supervisor/edges/satisfy — the satisfy-drag landing (decision
  // 8ee2469e): an OBJECT→REQUIREMENT satisfy edge. The Spec UI drags an
  // object-linked todo onto a RequirementChip; the edge is OBJECT→req, resolved
  // via the dragged todo's `objectRef`. Accepts an explicit `objectId`, OR a
  // `todoId` whose `objectRef` is resolved here (so a todo with no objectRef is
  // rejected gracefully — there is no todo→req edge kind). Reuses D's shipped
  // system-object-edges.satisfy().
  if (url.pathname === '/api/supervisor/edges/satisfy' && req.method === 'POST') {
    try {
      const { project, objectId, todoId, reqId } = (await req.json()) as {
        project?: string;
        objectId?: string;
        todoId?: string;
        reqId?: string;
      };
      if (!project || !reqId) return jsonError('project and reqId are required', 400);
      // Resolve the object: explicit objectId wins; else the dragged todo's objectRef.
      let resolvedObjectId = objectId ?? null;
      if (!resolvedObjectId && todoId) resolvedObjectId = getTodo(project, todoId)?.objectRef ?? null;
      if (!resolvedObjectId) {
        // A todo with no objectRef → graceful reject (link an object first); no
        // todo→req edge kind exists by design.
        return jsonError('no object to satisfy with: the dragged todo has no objectRef — link it to a system object first', 422);
      }
      const edge = satisfy(project, resolvedObjectId, reqId);
      return Response.json({ edge });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  return null;
}
