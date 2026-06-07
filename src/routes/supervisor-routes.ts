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
  isStewardEnabled,
  setStewardEnabled,
  SUPERVISOR_HEARTBEAT_INTERVAL_MS,
  SUPERVISOR_STALE_AFTER_MS,
  getPeer,
  getSupervisorConfig,
  setSupervisorConfig,
  listSupervisorAudit,
} from '../services/supervisor-store.ts';
import { createItem, listItems, updateItem, deleteItem } from '../services/roadmap-store.ts';
import { listTodos, updateTodo, getTodo } from '../services/todo-store.ts';
import { listDecisionRecords, createDecisionRecord, type DecisionStatus, type RequirementSpec } from '../services/decision-record-store.ts';
import { listObjects, listTypes } from '../services/system-object-store.ts';
import { bom } from '../services/system-object-bom.ts';
import { satisfy } from '../services/system-object-edges.ts';
import { specCoverage, decideRequirement, type RequirementDecision } from '../services/spec-coverage.ts';
import { startCoordinator, stopCoordinator, isCoordinatorRunning } from '../services/coordinator-live.ts';
import { SUPERVISOR_PROJECT, SUPERVISOR_SESSION, STEWARD_PROJECT, STEWARD_SESSION } from '../config.ts';
import { sendTmuxKeys } from '../services/tmux-send.ts';
import { getWebSocketHandler } from '../services/ws-handler-manager.ts';

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function handleSupervisorRoutes(req: Request, url: URL): Promise<Response | null> {
  // PROJECTS
  if (url.pathname === '/api/supervisor/projects' && req.method === 'GET') {
    return Response.json({ projects: listWatchedProjects() });
  }

  if (url.pathname === '/api/supervisor/projects' && req.method === 'POST') {
    try {
      const { project } = (await req.json()) as { project?: string };
      if (!project) return jsonError('project is required', 400);
      addWatchedProject(project);
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
      const todo = await updateTodo(project, id, status ? { status } : {});
      return Response.json({ todo });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // COORDINATOR DAEMON STATUS / CONTROL (PCS Phase 5).
  if (url.pathname === '/api/supervisor/coordinator' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project is required', 400);
    return Response.json({ running: isCoordinatorRunning(project) });
  }
  if (url.pathname === '/api/supervisor/coordinator' && req.method === 'POST') {
    try {
      const { project, action } = (await req.json()) as { project?: string; action?: 'start' | 'stop' };
      if (!project || !action) return jsonError('project and action are required', 400);
      const changed = action === 'start' ? startCoordinator(project) : stopCoordinator(project);
      const running = isCoordinatorRunning(project);
      // BUGFIX (af49309a): broadcast coordinator state so every client's
      // FleetVitals pill flips live (start/stop), instead of only updating for
      // the client that issued the toggle. (The stale-after-restart case is
      // additionally covered by the Bridge's resync-on-reconnect, 5b8dc726.)
      getWebSocketHandler()?.broadcast({ type: 'coordinator_status', project, running });
      return Response.json({ running, changed });
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
  if (url.pathname === '/api/supervisor/escalations/resolve' && req.method === 'POST') {
    try {
      const { id, status } = (await req.json()) as { id?: string; status?: string };
      if (!id || !status) return jsonError('id and status are required', 400);
      resolveEscalation(id, status);
      return Response.json({ ok: true });
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
        resolveEscalation(id, 'decided');
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
        const res = await fetch(peer.baseUrl + '/api/ide/tmux-send-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(peer.token ? { Authorization: 'Bearer ' + peer.token } : {}) },
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

  // GET /api/supervisor/steward-identity[?project=] — the Steward panel's front
  // door. Mirrors /api/supervisor/identity's liveness math (heartbeat staleness),
  // but reads the INDEPENDENT 'steward' role row (separate epoch line). Also
  // surfaces the SCARY observability metric the panel leads with:
  // `overrideAccepts` — how many todos the steward force-accepted past the gate
  // (override_accept_todo stamps completedBy='steward'); scoped to ?project= when
  // given, 0 otherwise. No new WS events — REST-poll on the panel's 10s cadence.
  if (url.pathname === '/api/supervisor/steward-identity' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    const overrideAccepts = project
      ? listTodos(project, { includeCompleted: true }).filter((t) => t.completedBy === 'steward').length
      : 0;
    const identity = getSupervisorIdentity('steward');
    const switchedOn = isStewardEnabled();
    if (!identity) {
      // No steward registered: report not-running so the panel renders the
      // definitive "Become the Steward" front door rather than flashing crashed.
      return Response.json({
        identity: null,
        running: false,
        stale: true,
        ageMs: null,
        overrideAccepts,
        switchedOn,
        heartbeatIntervalMs: SUPERVISOR_HEARTBEAT_INTERVAL_MS,
        staleAfterMs: SUPERVISOR_STALE_AFTER_MS,
      });
    }
    const ageMs = Date.now() - identity.updatedAt;
    const stale = ageMs > SUPERVISOR_STALE_AFTER_MS;
    return Response.json({
      ...identity,
      identity,
      running: !stale,
      stale,
      ageMs,
      overrideAccepts,
      switchedOn,
      heartbeatIntervalMs: SUPERVISOR_HEARTBEAT_INTERVAL_MS,
      staleAfterMs: SUPERVISOR_STALE_AFTER_MS,
    });
  }

  // POST /api/supervisor/steward/enabled { enabled } — the live human ON/OFF
  // switch (StewardPanel toggle). PERSISTENT; while OFF the router sends every
  // escalation to the human and the running steward idles. Distinct from the
  // env arm (MERMAID_STEWARD_AUTO) and the transient steward_pause.
  if (url.pathname === '/api/supervisor/steward/enabled' && req.method === 'POST') {
    const { enabled } = (await req.json()) as { enabled?: boolean };
    if (typeof enabled !== 'boolean') return jsonError('enabled (boolean) required', 400);
    setStewardEnabled(enabled);
    return Response.json({ switchedOn: enabled });
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
