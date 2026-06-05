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
} from '../services/supervisor-store.ts';
import { createItem, listItems, updateItem, deleteItem } from '../services/roadmap-store.ts';
import { listTodos, updateTodo } from '../services/todo-store.ts';
import { startCoordinator, stopCoordinator, isCoordinatorRunning } from '../services/coordinator-live.ts';
import { SUPERVISOR_PROJECT, SUPERVISOR_SESSION } from '../config.ts';
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
      return Response.json({ running: isCoordinatorRunning(project), changed });
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

  return null;
}
