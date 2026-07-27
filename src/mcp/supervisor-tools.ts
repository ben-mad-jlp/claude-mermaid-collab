// Supervisor MCP tool surface — extracted verbatim from setup.ts.
//
// Owns the cohesive SUPERVISOR tool group: watching/nudging/reconciling supervised
// sessions, the escalation lifecycle (list/history/resolve/create/await), the
// pub-sub subscription tools, the supervisor decision-poll loop, the context
// watchdog (checkpoint/clear/scan), and the supervisor pause/audit controls.
// Assembled from exact byte ranges of setup.ts — behavior is identical, a pure move.
import * as supervisorStore from '../services/supervisor-store.js';
import { getWebSocketHandler } from '../services/ws-handler-manager.js';
import { listSessionRuntimes } from '../services/session-runtime.js';
import { listTodos, getTodo, createGate } from '../services/todo-store.js';
import { isGate } from '../services/todo-kind.js';
import { lastAssistantTurn } from '../services/transcript-reader.js';
import { awaitHumanDecision } from '../services/decision-relay.js';
import { coerceArrayArg } from './arg-coercion.js';
import { recordCheckpointReady, clearCheckpointReady, isCheckpointReady, tryEmitWatchdogAction, resetWatchdogDebounce } from '../services/session-status-store.js';
import { selectWatchdogActions, DEFAULT_WATCHDOG_CONFIG } from '../services/context-watchdog.js';
import { getDocument } from './document-tools.js';
import { recordSupervisorDecision } from './setup.js';

async function peerFetch(serverId: string | undefined, path: string, init?: { method?: string; body?: any }): Promise<any> {
  if (!serverId) throw new Error('peerFetch requires serverId');
  const peer = supervisorStore.getPeer(serverId);
  if (!peer) throw new Error('unknown peer ' + serverId);
  // Tokenless direct call (P1 §2): peers carry no token. A peer that enforces
  // auth will 401 here, and the caller degrades to desktop-brokered routing.
  const res = await fetch(peer.baseUrl + path, {
    method: init?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  return await res.json();
}

/**
 * Single-writer fence for mutating supervisor tools. Returns a structured
 * `superseded` payload (string) when the caller's epoch is no longer current —
 * the caller must then perform NO write and return this payload. Returns null
 * when the caller is the current owner OR did not supply an epoch at all.
 *
 * Enforced-WHEN-PRESENT by design: escalation_create is also called by ordinary
 * workers (which never carry a supervisor epoch), so the fence only bites when a
 * supervisor-context caller supplies `supervisorEpoch`. A superseded supervisor
 * still carries its (now stale) epoch and is correctly rejected.
 */
function supervisorFence(supervisorEpoch: number | undefined): string | null {
  if (supervisorEpoch == null) return null;
  try {
    supervisorStore.assertSupervisorOwner(supervisorEpoch);
    return null;
  } catch (e) {
    if (e instanceof supervisorStore.SupersededError) {
      return JSON.stringify(
        { superseded: true, currentEpoch: e.currentEpoch, currentSession: e.currentSession, message: e.message },
        null,
        2,
      );
    }
    throw e;
  }
}

export const SUPERVISOR_TOOL_DEFS = [
      { name: 'supervisor_list_supervised', description: 'List all supervised sessions across all projects.', inputSchema: { type: 'object', properties: {} } },
      { name: 'supervisor_nudge', description: 'Send text/keys into a supervised session tmux pane, routing to a peer server when serverId names a known peer.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' }, serverId: { type: 'string' }, text: { type: 'string' }, supervisorEpoch: { type: 'number', description: 'Ownership epoch. Pass it so the server can fence a superseded supervisor; a stale epoch is rejected (superseded) and performs no action.' } }, required: ['project', 'session', 'text'] } },
      { name: 'supervisor_reconcile', description: 'For every watched project, return session status + open-todo counts and the supervised flag.', inputSchema: { type: 'object', properties: { supervisorEpoch: { type: 'number', description: 'Ownership epoch; a superseded supervisor is rejected.' } } } },
      { name: 'read_last_assistant_turn', description: 'Read the last completed assistant turn from a Claude Code session transcript.', inputSchema: { type: 'object', properties: { claudeSessionId: { type: 'string' }, serverId: { type: 'string' } }, required: ['claudeSessionId'] } },
      { name: 'escalation_list', description: 'List open escalations.', inputSchema: { type: 'object', properties: {} } },
      { name: 'escalation_history', description: "Read-only escalation history — OPEN and RESOLVED escalations with how each was triaged and resolved (escalation_list shows OPEN only). The store is GLOBAL, so an unfiltered call spans all projects and defaults to the recent-N newest-first. FILTERS (all optional): epicId (resolves escalation.todoId → parentId chain → [EPIC] ancestor), project, todoId, session, status, kind, routedTo ('steward'=ai-resolved | 'human'=escalated-to-human), since/until (createdAt ms range), limit (default 50). PER-ROW: kind, status, createdAt/resolvedAt, timeToResolutionMs, routedTo, stewardAttempts, suggestedAction (Grok bucket+confidence+rationale), the human decision (optionId/note/decidedBy), resolutionActor (decider handle | 'daemon-auto'), recurrenceCount (how many escalations share project+session+questionText). With epicId, folds in that epic's decision records. summary:true returns aggregate counts (auto-resolved vs escalated-to-human), avg stewardAttempts, median timeToResolution, grouped by epic/project — answers 'is drive-level Grok triage resolving escalations or just bouncing them to the human?'.", inputSchema: { type: 'object', properties: { epicId: { type: 'string' }, project: { type: 'string' }, todoId: { type: 'string' }, session: { type: 'string' }, status: { type: 'string' }, kind: { type: 'string' }, routedTo: { type: 'string', enum: ['steward', 'human'] }, since: { type: 'number', description: 'Lower bound on createdAt (ms epoch).' }, until: { type: 'number', description: 'Upper bound on createdAt (ms epoch).' }, limit: { type: 'number', description: 'Recent-N cap, newest-first (default 50).' }, summary: { type: 'boolean', description: 'Return the aggregate breakdown instead of rows.' } } } },
      { name: 'escalation_resolve', description: 'Resolve an escalation by id with a status. When status is "acknowledged", routes to acknowledgeEscalation instead of resolveEscalation.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' }, supervisorEpoch: { type: 'number', description: 'Supervisor ownership epoch; a superseded supervisor is rejected.' } }, required: ['id', 'status'] } },
      { name: 'escalation_create', description: 'Create (or dedupe) an open escalation for a session. Pass todoId to link it to a work-graph todo so it auto-resolves when that todo completes. For an A/B-style decision, pass structured options[] (and optionally recommended) instead of a raw JSON questionText.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' }, kind: { type: 'string' }, questionText: { type: 'string', description: 'Human-readable prompt for the decision/question.' }, todoId: { type: 'string', description: 'Optional work-graph todo id this escalation is about (exact auto-resolve link).' }, options: { type: 'array', description: 'Optional structured choices for an A/B-style decision.', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, detail: { type: 'string' } }, required: ['id', 'label'] } }, recommended: { type: 'string', description: 'Optional id of the recommended option (must match one of options[].id).' }, ui: { type: 'object', description: 'Optional rich decision spec (BR-4): { elements: [...] } over the closed catalog (Heading, Text, Callout, CodeBlock, DiffView, CompareTable, KeyValue, OptionButton, Form, SubmitButton). Server-validated; must contain a terminal action (OptionButton/SubmitButton/Form), ≤40 elements. Compose ONLY when the decision needs evidence (a diff/compare/form); otherwise use plain options[]. Invalid specs are dropped, falling back to options[].' }, supervisorEpoch: { type: 'number', description: 'Supervisor ownership epoch. Workers escalating omit this; a superseded supervisor that passes its stale epoch is rejected (superseded).' } }, required: ['project', 'session', 'kind', 'questionText'] } },
      { name: 'await_human_decision', description: 'Block until a human posts a decision for the given escalation (via the decide endpoint), then return the chosen optionId + any note. Use after filing a structured escalation (escalation_create with options[]) to relay an A/B decision without ending the turn. Returns { timedOut: true } if no answer arrives within timeoutMs.', inputSchema: { type: 'object', properties: { escalationId: { type: 'string' }, timeoutMs: { type: 'number', description: 'Max time to wait in ms (default 600000 = 10 min).' } }, required: ['escalationId'] } },
      { name: 'supervisor_next_decision', description: 'On-demand supervisor LLM poll: return the oldest PENDING ambiguous-stop decision request (id, workerSession, signal, snapshot) the watchdog daemon enqueued, or null when the queue is empty. Read the snapshot, JUDGE, then call supervisor_resolve_decision. The LLM never loops or acts — it only judges; the daemon acts on the verdict.', inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Optional project scope; omit for all watched projects.' } } } },
      { name: 'supervisor_resolve_decision', description: 'Write a verdict for a pending decision request (the supervisor LLM\'s one judgment). verdict: escalate (surface to the human), nudge/resume (push the worker to continue), or wait (leave it). EPOCH-GATED: pass supervisorEpoch; a superseded supervisor is rejected and performs no write. The daemon acts on the verdict on its next tick.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['escalate', 'nudge', 'resume', 'wait'] }, reason: { type: 'string', description: 'Short rationale for the verdict (recorded for provenance).' }, supervisorEpoch: { type: 'number', description: 'Supervisor ownership epoch; a superseded supervisor is rejected (superseded).' } }, required: ['id', 'verdict'] } },
      { name: 'subscribe', description: 'Subscribe THIS registered collab session to notifications about a todo, an epic, a mission (every epic/leaf under it, including epics created in later iterations), or a whole project (nudge-to-pull). The notification router enqueues coalesced updates; a tiny tmux nudge then wakes the idle session, which drains them via the `inbox` tool and acts — so a steward session need not /loop or poll. scope=project omits targetId. Idempotent.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string', description: 'The collab session subscribing (must be registered).' }, scope: { type: 'string', enum: ['todo', 'epic', 'mission', 'project'] }, targetId: { type: 'string', description: 'Todo, epic, or mission id (required for scope todo/epic/mission; omit for project).' } }, required: ['project', 'session', 'scope'] } },
      { name: 'unsubscribe', description: 'Remove a subscription for THIS session. Pass scope (+ targetId for todo/epic/mission) to drop one, or all:true to drop every subscription for the session.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' }, scope: { type: 'string', enum: ['todo', 'epic', 'mission', 'project'] }, targetId: { type: 'string' }, all: { type: 'boolean', description: 'Drop ALL of this session\'s subscriptions (ignores scope/targetId).' } }, required: ['project', 'session'] } },
      { name: 'update_zen_summary', description: "Push THIS session's OWN Zen summary (self-report — the session knows its real state, no external pane-scrape/interpret needed). Folds straight into the Zen card as FRESH. `structured` = { paragraph: string (the glance: the GOAL first, then a blank line, then what we're doing now), status: 'working'|'idle'|'stuck'|'needs-input', detail?: string, question?: string (ONLY if WE asked the human something and are awaiting their reply), options?: [{label,valueToSend}], recommended?: int, multiSelect?: bool, suggestedAnswers?: string[], aiOption?: string } — the SAME schema the interpreter emits. Rejected if paragraph or a valid status is missing.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' }, structured: { type: 'object' } }, required: ['project', 'session', 'structured'] } },
      { name: 'list_subscriptions', description: 'List what THIS session is subscribed to (the nudge-to-pull subscriptions): every {scope, targetId, createdAt} for the session. Use it to SEE your subscriptions before dropping one (`unsubscribe` scope+targetId) or clearing all (`unsubscribe` all:true).', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' } }, required: ['project', 'session'] } },
      { name: 'checkpoint_ready', description: 'Context-watchdog: a session reports that its checkpoint is persisted. The server VERIFIES the named artifact was JUST written (recency gate) before recording checkpoint_ready — so a /clear can safely follow. Provide checkpointDocId (preferred — vibe-checkpoint writes the checkpoint into the vibe.vibeinstructions document’s ## Checkpoint section) OR checkpointTodoId (legacy — older flows wrote into the in_progress todo description; the claimability model no longer keeps an interactive in_progress todo, so prefer the doc). Call this at the END of your checkpoint.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' }, checkpointDocId: { type: 'string', description: 'Document id the checkpoint wrote (preferred — e.g. vibe.vibeinstructions / vibe-vibeinstructions).' }, checkpointTodoId: { type: 'string', description: 'Legacy: todo id the checkpoint updated. Older flows wrote the checkpoint into the in_progress todo description; prefer checkpointDocId.' }, maxWriteAgeMs: { type: 'number', description: 'How recent the write must be to count as a fresh checkpoint (default 120000).' } }, required: ['project', 'session'] } },
      { name: 'supervisor_clear_session', description: 'Context-watchdog HARD GATE: send /clear to a watched session ONLY if it has a recent persisted checkpoint (checkpoint_ready). Refuses otherwise. Consumes the checkpoint marker on success.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' }, serverId: { type: 'string', description: 'Optional peer server id for a remote session.' }, maxAgeMs: { type: 'number', description: 'Max age of the checkpoint marker to still allow clearing (default 600000).' }, supervisorEpoch: { type: 'number', description: 'Supervisor ownership epoch; a superseded supervisor is rejected.' } }, required: ['project', 'session'] } },
      { name: 'supervisor_pause', description: 'EMERGENCY OVERRIDE: pause supervisor driving-actions (nudge/clear/watchdog) — globally or for one project. Use when the supervisor is misbehaving. Resume with supervisor_resume.', inputSchema: { type: 'object', properties: { scope: { type: 'string', description: "'global' (default) or a project path." } } } },
      { name: 'supervisor_resume', description: 'Lift a supervisor pause (the scope you paused: "global" or a project path).', inputSchema: { type: 'object', properties: { scope: { type: 'string', description: "'global' (default) or a project path." } } } },
      { name: 'supervisor_pause_status', description: 'List active supervisor pauses.', inputSchema: { type: 'object', properties: {} } },
      { name: 'supervisor_audit_list', description: 'List the supervisor\'s durable decision/action audit trail (nudge/escalate/checkpoint/clear/…), most-recent-first. Survives restart; feeds observability + the System Map. Optional project/kind filters.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, kind: { type: 'string' }, limit: { type: 'number', description: 'Max entries (default 100, max 1000).' } } } },
      { name: 'supervisor_watchdog_scan', description: 'Context-watchdog control loop: scan a project\'s session statuses and return the per-session actions to take this tick — "checkpoint" (over the context threshold on a safe/idle boundary → nudge the session to run /vibe-checkpoint) or "clear" (a checkpoint is persisted → call supervisor_clear_session). Deterministic; the supervisor calls this each tick.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, thresholdPercent: { type: 'number', description: 'Context % that triggers a clear cycle (default 80).' } }, required: ['project'] } },
];

export async function handleSupervisorTool(name: string, args: any): Promise<string | null> {
  switch (name) {
          case 'supervisor_list_supervised': {
            return JSON.stringify(supervisorStore.listSupervised(), null, 2);
          }
          case 'supervisor_nudge': {
            const { project, session, serverId, text, supervisorEpoch } = args as { project: string; session: string; serverId?: string; text: string; supervisorEpoch?: number };
            if (!project || !session || !text) throw new Error('Missing required: project, session, text');
            { const fenced = supervisorFence(supervisorEpoch); if (fenced) return fenced; }
            if (supervisorStore.isSupervisorPaused(project)) return JSON.stringify({ sent: false, skipped: 'paused' }, null, 2);
            let result: any;
            let sent: boolean;
            if (serverId && supervisorStore.getPeer(serverId)) {
              result = await peerFetch(serverId, '/api/ide/tmux-send-keys', { method: 'POST', body: { project, session, text } });
              sent = !!(result?.tmux ?? result?.success);
            } else {
              result = { sent: false, reason: 'local tmux delivery removed' };
              sent = false;
            }
            // Surface the nudge in the UI: a toast lets the user SEE that the
            // supervisor actually pushed a session to continue (and whether it
            // landed in a live tmux pane). Broadcast on the supervisor's own
            // server — that's where the user is watching.
            getWebSocketHandler()?.broadcast({ type: 'supervisor_nudge', project, session, serverId: serverId ?? '', text, sent });
            recordSupervisorDecision('nudge', project, session, JSON.stringify({ text, sent }), serverId);
            return JSON.stringify(result, null, 2);
          }
          case 'supervisor_reconcile': {
            { const fenced = supervisorFence((args as { supervisorEpoch?: number }).supervisorEpoch); if (fenced) return fenced; }
            const out: Array<{ project: string; session: string; status: string | null; updatedAt: number | null; openTodos: number; supervised: boolean; serverId: string }> = [];
            for (const wp of supervisorStore.listWatchedProjects()) {
              // Unified read model owns the status/liveness join; the supervisor
              // overlay (supervised + open-todo count) stays a supervisor concern.
              for (const rt of listSessionRuntimes(wp.project)) {
                const supervised = supervisorStore.isSupervised(wp.project, rt.session);
                const openTodos = supervised ? listTodos(wp.project, { session: rt.session, includeCompleted: false }).length : 0;
                out.push({ project: wp.project, session: rt.session, status: rt.status, updatedAt: rt.updatedAt, openTodos, supervised, serverId: '' });
              }
            }
            // Remote supervised sessions: fetch each peer's session-status once per (serverId, project).
            const remotePairs = new Map<string, { serverId: string; project: string }>();
            for (const sup of supervisorStore.listSupervised()) {
              if (sup.serverId && supervisorStore.getPeer(sup.serverId)) remotePairs.set(sup.serverId + '|' + sup.project, { serverId: sup.serverId, project: sup.project });
            }
            const supervisedRemote = new Set(supervisorStore.listSupervised().filter(s => s.serverId).map(s => s.serverId + '|' + s.project + '|' + s.session));
            for (const { serverId: sid, project: proj } of remotePairs.values()) {
              try {
                const resp = await peerFetch(sid, '/api/session-status?project=' + encodeURIComponent(proj), { method: 'GET' });
                for (const s of (resp.statuses ?? [])) {
                  if (!supervisedRemote.has(sid + '|' + proj + '|' + s.session)) continue;
                  // openTodos:0 for remote — todos not locally queryable.
                  out.push({ project: proj, session: s.session, status: s.status, updatedAt: s.updatedAt, openTodos: 0, supervised: true, serverId: sid });
                }
              } catch {
                out.push({ project: proj, session: '(peer unreachable)', status: 'unreachable', updatedAt: null, openTodos: 0, supervised: true, serverId: sid });
              }
            }
            return JSON.stringify(out, null, 2);
          }
          case 'read_last_assistant_turn': {
            const { claudeSessionId, serverId } = args as { claudeSessionId: string; serverId?: string };
            if (!claudeSessionId) throw new Error('Missing required: claudeSessionId');
            if (serverId && supervisorStore.getPeer(serverId)) {
              return JSON.stringify(await peerFetch(serverId, '/api/transcript/last-turn?claudeSessionId=' + encodeURIComponent(claudeSessionId), { method: 'GET' }), null, 2);
            }
            return JSON.stringify(await lastAssistantTurn(claudeSessionId), null, 2);
          }
          case 'escalation_list': {
            return JSON.stringify(supervisorStore.listOpenEscalations(), null, 2);
          }
          case 'escalation_history': {
            const { getEscalationHistory } = await import('../services/escalation-history.js');
            const f = args as {
              epicId?: string; project?: string; todoId?: string; session?: string;
              status?: string; kind?: string; routedTo?: string;
              since?: number; until?: number; limit?: number; summary?: boolean;
            };
            return JSON.stringify(getEscalationHistory(f), null, 2);
          }
          case 'escalation_resolve': {
            const { id, status, supervisorEpoch } = args as { id: string; status: string; supervisorEpoch?: number };
            if (!id || !status) throw new Error('Missing required: id, status');
            { const fenced = supervisorFence(supervisorEpoch); if (fenced) return fenced; }
            if (status === 'acknowledged') {
              supervisorStore.acknowledgeEscalation(id, 'human');
            } else {
              supervisorStore.resolveEscalation(id, status);
            }
            return JSON.stringify({ success: true, id, status }, null, 2);
          }
          case 'escalation_create': {
            const { project, session, kind, questionText, todoId, options, recommended, ui, operatorGated, supervisorEpoch } = args as { project: string; session: string; kind: string; questionText: string; todoId?: string; options?: Array<{ id: string; label: string; detail?: string }>; recommended?: string; ui?: unknown; operatorGated?: boolean; supervisorEpoch?: number };
            if (!project || !session || !kind || !questionText) throw new Error('Missing required: project, session, kind, questionText');
            // Fence only bites a supervisor-context caller (one that carries an
            // epoch). Ordinary workers escalate without an epoch — never fenced.
            { const fenced = supervisorFence(supervisorEpoch); if (fenced) return fenced; }
            // Use the store's authoritative new-vs-dedup signal (no separate
            // pre-check → no TOCTOU): broadcast/record only for new escalations.
            // `ui` (BR-4) is server-validated inside createEscalation against the
            // closed catalog; an invalid spec is dropped, never throws.
            const coercedOptions = coerceArrayArg(options, 'options') as Array<{ id: string; label: string; detail?: string }> | undefined;
            const { escalation: esc, isNew } = supervisorStore.createEscalation({ project, session, kind, questionText, todoId, options: coercedOptions, recommended, ui, operatorGated });
            if (isNew) {
              getWebSocketHandler()?.broadcast({ type: 'escalation_created', project, session, kind, id: esc.id, routedTo: esc.routedTo, escalation: esc });
              recordSupervisorDecision('escalate', project, session, JSON.stringify({ kind, escalationId: esc.id }));
              // P3 (readiness ergonomics): a needs-design / operator-gated escalation
              // linked to a work-todo gets a durable, self-clearing human [GATE] (P1
              // createGate) instead of the steward's manual re-park to 'planned'. It
              // surfaces in the human inbox ("waiting on you: provision env / land
              // design") and auto-promotes the work-todo when the human clears it.
              // Best-effort: never let a gate failure break escalation creation; skip
              // when the work-todo is itself human, missing, or already gated (idempotent).
              if (todoId && supervisorStore.shouldAutoGate(kind, Boolean(operatorGated))) {
                try {
                  const work = getTodo(project, todoId);
                  const alreadyGated = work?.dependsOn?.some((d) => {
                    const dep = getTodo(project, d);
                    return !!dep && isGate(dep);
                  });
                  if (work && work.assigneeKind !== 'human' && !alreadyGated) {
                    await createGate(project, { workTodoId: todoId, title: questionText, gateKind: kind });
                  }
                } catch (e) {
                  console.warn('[escalation_create] auto-gate failed:', e instanceof Error ? e.message : String(e));
                }
              }
            }
            return JSON.stringify(esc, null, 2);
          }
          case 'await_human_decision': {
            const { escalationId, timeoutMs } = args as { escalationId: string; timeoutMs?: number };
            if (!escalationId) throw new Error('Missing required: escalationId');
            const result = await awaitHumanDecision(escalationId, { timeoutMs });
            return JSON.stringify(result, null, 2);
          }
          case 'subscribe': {
            const { project, session, scope, targetId } = args as { project?: string; session?: string; scope?: string; targetId?: string };
            if (!project || !session || !scope) throw new Error('Missing required: project, session, scope');
            if (!['todo', 'epic', 'mission', 'project'].includes(scope)) throw new Error(`Invalid scope "${scope}" (todo|epic|mission|project)`);
            const subs = await import('../services/session-subscriptions');
            const sub = subs.addSubscription(project, session, scope as any, targetId);
            return JSON.stringify({ ok: true, subscription: sub }, null, 2);
          }
          case 'unsubscribe': {
            const { project, session, scope, targetId, all } = args as { project?: string; session?: string; scope?: string; targetId?: string; all?: boolean };
            if (!project || !session) throw new Error('Missing required: project, session');
            const subs = await import('../services/session-subscriptions');
            if (all) return JSON.stringify({ ok: true, removed: subs.dropSubscriptionsForSession(project, session) }, null, 2);
            if (!scope) throw new Error('Missing required: scope (or all:true)');
            return JSON.stringify({ ok: true, removed: subs.removeSubscription(project, session, scope as any, targetId) }, null, 2);
          }
          case 'update_zen_summary': {
            const { project, session, structured } = args as { project?: string; session?: string; structured?: unknown };
            if (!project || !session || !structured) throw new Error('Missing required: project, session, structured');
            const ss = await import('../services/session-summary-loop.ts');
            const wsh = getWebSocketHandler();
            const r = ss.pushSessionSummary(project, session, structured, (m) => wsh?.broadcast(m as never));
            if (!r.ok) throw new Error(`update_zen_summary rejected: ${r.reason}`);
            return JSON.stringify({ ok: true, pushed: { project, session } }, null, 2);
          }
          case 'list_subscriptions': {
            const { project, session } = args as { project?: string; session?: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const subs = await import('../services/session-subscriptions');
            const list = subs.listSubscriptionsForSession(project, session);
            return JSON.stringify({ session, count: list.length, subscriptions: list }, null, 2);
          }
          case 'supervisor_next_decision': {
            // The on-demand supervisor LLM polls the oldest pending ambiguous-stop
            // request. Read-only; null when the queue is empty (nothing to judge).
            const { project } = args as { project?: string };
            return JSON.stringify(supervisorStore.getNextPendingDecision(project), null, 2);
          }
          case 'supervisor_resolve_decision': {
            const { id, verdict, reason, supervisorEpoch } = args as { id: string; verdict: string; reason?: string; supervisorEpoch?: number };
            if (!id || !verdict) throw new Error('Missing required: id, verdict');
            if (!supervisorStore.DECISION_VERDICTS.includes(verdict as supervisorStore.DecisionVerdict)) {
              throw new Error(`Invalid verdict "${verdict}" (expected one of ${supervisorStore.DECISION_VERDICTS.join(', ')})`);
            }
            // EPOCH-GATED (2dd13c65): resolveDecision calls assertSupervisorOwner and
            // throws SupersededError for a stale supervisor — catch it and return the
            // structured superseded payload, performing NO write (mirrors supervisorFence).
            const owner = supervisorStore.getSupervisorIdentity();
            try {
              const resolved = supervisorStore.resolveDecision({
                id,
                verdict: verdict as supervisorStore.DecisionVerdict,
                reason,
                resolvedBy: owner ? `${owner.session}@${owner.epoch}` : null,
                epoch: supervisorEpoch,
              });
              if (!resolved) return JSON.stringify({ success: false, reason: 'not-pending', id }, null, 2);
              recordSupervisorDecision('decide', resolved.project, resolved.workerSession, JSON.stringify({ decisionId: id, verdict, reason: reason ?? null }));
              return JSON.stringify({ success: true, decision: resolved }, null, 2);
            } catch (e) {
              if (e instanceof supervisorStore.SupersededError) {
                return JSON.stringify({ superseded: true, currentEpoch: e.currentEpoch, currentSession: e.currentSession, message: e.message }, null, 2);
              }
              throw e;
            }
          }
          case 'checkpoint_ready': {
            const { project, session, checkpointTodoId, checkpointDocId, maxWriteAgeMs } = args as { project: string; session: string; checkpointTodoId?: string; checkpointDocId?: string; maxWriteAgeMs?: number };
            if (!project || !session) throw new Error('Missing required: project, session');
            if (!checkpointTodoId && !checkpointDocId) throw new Error('Provide checkpointTodoId or checkpointDocId');
            const maxAge = maxWriteAgeMs ?? 120_000;
            // HARD GATE: verify the artifact was ACTUALLY just written — a
            // self-report alone is not trusted (clear-before-persist = data loss).
            let writtenAtMs: number | undefined;
            let artifact: string;
            if (checkpointTodoId) {
              artifact = `todo:${checkpointTodoId}`;
              const todo = getTodo(project, checkpointTodoId);
              if (!todo) return JSON.stringify({ persisted: false, reason: 'checkpoint-todo-not-found', checkpointTodoId }, null, 2);
              writtenAtMs = new Date(todo.updatedAt).getTime();
            } else {
              artifact = `doc:${checkpointDocId}`;
              let lastModified: unknown;
              try {
                lastModified = JSON.parse(await getDocument(project, session, checkpointDocId!))?.lastModified;
              } catch {
                return JSON.stringify({ persisted: false, reason: 'checkpoint-doc-not-found', checkpointDocId }, null, 2);
              }
              if (typeof lastModified !== 'number') {
                return JSON.stringify({ persisted: false, reason: 'no-lastModified', checkpointDocId }, null, 2);
              }
              writtenAtMs = lastModified;
            }
            if (writtenAtMs === undefined || Number.isNaN(writtenAtMs)) {
              return JSON.stringify({ persisted: false, reason: 'no-write-timestamp', artifact }, null, 2);
            }
            const ageMs = Date.now() - writtenAtMs;
            if (ageMs > maxAge) {
              return JSON.stringify({ persisted: false, reason: 'checkpoint-stale', ageMs, maxWriteAgeMs: maxAge, artifact }, null, 2);
            }
            recordCheckpointReady(project, session);
            getWebSocketHandler()?.broadcast({ type: 'claude_session_checkpoint_ready', project, session, persistedAt: Date.now() });
            recordSupervisorDecision('checkpoint', project, session, JSON.stringify({ artifact, ageMs }));
            return JSON.stringify({ persisted: true, artifact, ageMs }, null, 2);
          }
          case 'supervisor_clear_session': {
            const { project, session, serverId, maxAgeMs, supervisorEpoch } = args as { project: string; session: string; serverId?: string; maxAgeMs?: number; supervisorEpoch?: number };
            if (!project || !session) throw new Error('Missing required: project, session');
            { const fenced = supervisorFence(supervisorEpoch); if (fenced) return fenced; }
            if (supervisorStore.isSupervisorPaused(project)) return JSON.stringify({ cleared: false, reason: 'paused' }, null, 2);
            // Gate: only clear if a recent persisted checkpoint exists. For a peer
            // session the marker lives on its home server, so check there.
            let ready: boolean;
            const isPeer = !!(serverId && supervisorStore.getPeer(serverId));
            if (isPeer) {
              const maxAge = maxAgeMs ?? 600_000;
              try {
                const peer = await peerFetch(serverId!, `/api/session-status?project=${encodeURIComponent(project)}`, { method: 'GET' });
                const row = (peer?.statuses ?? []).find((s: any) => s.session === session);
                ready = !!(row?.checkpointReadyAt && Date.now() - row.checkpointReadyAt <= maxAge);
              } catch {
                return JSON.stringify({ cleared: false, reason: 'peer-status-unreachable' }, null, 2);
              }
            } else {
              ready = isCheckpointReady(project, session, maxAgeMs);
            }
            if (!ready) {
              return JSON.stringify({ cleared: false, reason: 'checkpoint-not-ready' }, null, 2);
            }
            let result: any;
            let sent: boolean;
            if (isPeer) {
              result = await peerFetch(serverId!, '/api/ide/tmux-send-keys', { method: 'POST', body: { project, session, text: '/clear' } });
              sent = !!(result?.tmux ?? result?.success);
            } else {
              result = { sent: false, reason: 'local tmux delivery removed' };
              sent = false;
            }
            if (sent && !isPeer) { clearCheckpointReady(project, session); resetWatchdogDebounce(project, session); }
            getWebSocketHandler()?.broadcast({ type: 'supervisor_session_cleared', project, session });
            recordSupervisorDecision('clear', project, session, JSON.stringify({ sent, isPeer }), serverId);
            return JSON.stringify({ cleared: sent, reason: sent ? undefined : (result?.reason ?? 'send-failed') }, null, 2);
          }
          case 'supervisor_pause': {
            const { scope } = args as { scope?: string };
            const s = scope || supervisorStore.GLOBAL_PAUSE_SCOPE;
            supervisorStore.setSupervisorPause(s, true);
            recordSupervisorDecision('override', s, '', JSON.stringify({ action: 'pause' }));
            return JSON.stringify({ paused: true, scope: s }, null, 2);
          }
          case 'supervisor_resume': {
            const { scope } = args as { scope?: string };
            const s = scope || supervisorStore.GLOBAL_PAUSE_SCOPE;
            supervisorStore.setSupervisorPause(s, false);
            recordSupervisorDecision('override', s, '', JSON.stringify({ action: 'resume' }));
            return JSON.stringify({ paused: false, scope: s }, null, 2);
          }
          case 'supervisor_pause_status': {
            return JSON.stringify({ pauses: supervisorStore.listSupervisorPauses() }, null, 2);
          }
          case 'supervisor_audit_list': {
            const { project, kind, limit } = args as { project?: string; kind?: string; limit?: number };
            const entries = supervisorStore.listSupervisorAudit({ project, kind, limit });
            return JSON.stringify({ entries }, null, 2);
          }
          case 'supervisor_watchdog_scan': {
            const { project, thresholdPercent, checkpointCooldownMs } = args as { project: string; thresholdPercent?: number; checkpointCooldownMs?: number };
            if (!project) throw new Error('Missing required: project');
            if (supervisorStore.isSupervisorPaused(project)) return JSON.stringify({ actions: [], suppressed: 0, paused: true }, null, 2);
            // Precedence: explicit arg → per-project config → built-in default.
            const effectiveThreshold = thresholdPercent ?? supervisorStore.getWatchdogThreshold(project) ?? DEFAULT_WATCHDOG_CONFIG.thresholdPercent;
            const cfg = { ...DEFAULT_WATCHDOG_CONFIG, thresholdPercent: effectiveThreshold };
            const now = Date.now();
            const cooldown = checkpointCooldownMs ?? 10 * 60 * 1000;
            // The supervisor's OWN session (if it lives in this project) is tagged
            // self=true so the loop self-checkpoints/clears instead of trying to
            // drive itself via supervisor_clear_session (which targets a PEER).
            const identity = supervisorStore.getSupervisorIdentity();
            const selfSession = identity && identity.project === project ? identity.session : undefined;
            // Feed the watchdog selector from the unified read model (a structural
            // superset of SessionStatusRow) rather than stitching getStatuses here.
            const all = selectWatchdogActions(listSessionRuntimes(project, now), now, cfg, selfSession);
            // Durable debounce on the repeatable 'checkpoint' nudge only. 'clear' is
            // self-limiting: its marker is consumed on a successful clear, and a
            // failed clear SHOULD retry — so it passes through every tick.
            const actions = all.filter((a) =>
              a.action !== 'checkpoint' || tryEmitWatchdogAction(project, a.session, 'checkpoint', cooldown, now),
            );
            return JSON.stringify({ actions, suppressed: all.length - actions.length, thresholdPercent: effectiveThreshold }, null, 2);
          }
          default:
            return null;
  }
}
