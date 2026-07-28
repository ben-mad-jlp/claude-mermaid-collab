// System/orchestrator/daemon status MCP tool surface — extracted verbatim from setup.ts.
import { getFleetStatus } from '../services/fleet-status.js';
import { listLeafInflight } from '../services/worker-ledger.js';
import { breakerOpen } from '../services/headless-breaker.js';
import { frictionTrends } from '../services/friction-trends.js';
import { runtimeConfig } from '../services/runtime-config.js';
import { diagnoseClaimSuppression, getColdStartsInFlight } from '../services/coordinator-live.js';
import { requestSelfDeploy } from '../services/deploy-service.js';
import { instanceTopology } from '../services/instance-topology.js';
import { systemStatus } from '../services/system-status.js';
import * as supervisorStore from '../services/supervisor-store.js';
import { selectWatchdogActions, DEFAULT_WATCHDOG_CONFIG } from '../services/context-watchdog.js';
import { listSessionRuntimes } from '../services/session-runtime.js';
import { getOrchestratorHealth as getOrchestratorHealthSST } from '../services/orchestrator-live.js';
import { API_BASE_URL, apiFetch } from './tools/http-util.js';
import { recordSupervisorDecision } from './setup.js';

export const SYSTEM_TOOL_DEFS = [
  {"name":"check_server_health","description":"Check if MCP server, HTTP/API backend, and React UI are running","inputSchema":{"properties":{},"required":[],"type":"object"}},
  {"name":"fleet_status","description":"Live fleet read-model for a project: per in-progress lane its worker, derived liveness state (working/idle/permission/dead_shell/no_tmux), elapsed time and lease headroom — PLUS a process-headroom block {liveProcs, perUidCap, tmuxSessions, idleSessions} that surfaces the fork-EAGAIN wedge before it hits (uid live procs vs the kern.maxprocperuid cap). Read-only; one ps snapshot per call.","inputSchema":{"properties":{"project":{"description":"Absolute path to the project root whose fleet to report","type":"string"}},"required":["project"],"type":"object"}},
  {"name":"deploy_self","description":"DEPLOY the running sidecar from its own repo (human-gated, STRICTLY SEPARATE from land). After a self-project epic lands, the live :9002 binary is stale against master; this rebuilds sidecar+UI and restarts the app. Server hard-gates self-project (project must equal the sidecar's MERMAID_PROJECT) AND macOS AND the presence of scripts/deploy-desktop.sh — never deploys another repo. Spawned DETACHED, so it survives killing this very process; returns immediately with a logPath to tail. Reasons: ok | not-self-project | unsupported-platform | deploy-script-missing | spawn-failed.","inputSchema":{"properties":{"project":{"description":"The project to deploy — must be the sidecar's own repo (MERMAID_PROJECT).","type":"string"}},"required":["project"],"type":"object"}},
  {"name":"instance_topology","description":"Read-only map of every live mermaid-collab server this machine knows about, each tagged CANONICAL vs STALE SHADOW. Joins the on-disk instance records (~/.mermaid-collab/instances: port, project/session, pid, version, startedAt), the canonical :9002 ownership lockfile + a live /api/health probe (together identifying the ONE process that actually owns the canonical port), and the in-memory remote-peer registry. The live :9002 owner is tagged `canonical`; any OTHER instance also claiming :9002 is a `shadow` (the 'deploy went cosmetic because a stale source server shadows the desktop sidecar' footgun); a server on its own port is a plain `instance`. `hasShadow:true` is the warning flag. Takes no args.","inputSchema":{"properties":{},"type":"object"}},
  {"name":"launch_remote_server","description":"Start a collab server on a REMOTE machine over SSH — the same detect→launch flow the desktop 'Launch' button runs (POST /api/server/detect then /api/server/launch), exposed as one tool so it can be driven/tested headlessly. Runs on THIS sidecar (which owns the system `ssh`). Two phases: (1) DETECT — SSH into the host, probe for bun / a global mermaid-collab / the newest plugin-cache version dir, adopt the server's existing config.json token (or mint one), and synthesize a start command that binds 0.0.0.0 AND sets MERMAID_AUTH_TOKEN (a 0.0.0.0 bind is always auth-required — never an open LAN hole). (2) LAUNCH — SSH again, detach the server (setsid/nohup), and poll the remote /api/health. Pass `command` to skip detect and launch a specific command; pass `detectOnly:true` to only probe+synthesize and NOT launch. `password` is used once for the SSH prompt and never persisted; omit it to use keys/agent (BatchMode). Returns { detect?, launch?, token? } — the token is what a client must present to reach the launched (auth-required) server. NOTE: the host must be a bare host/IP; the SSH user goes in `user`, not baked into `host`.","inputSchema":{"properties":{"command":{"description":"Explicit start command to launch. If omitted, detect synthesizes one. Ignored when detectOnly is true.","type":"string"},"detectOnly":{"description":"Only run the SSH probe + synthesize a command; do NOT launch. Returns { detect }.","type":"boolean"},"host":{"description":"Bare remote host or IP (NOT user@host). The SSH user goes in `user`.","type":"string"},"password":{"description":"One-time SSH password. Never persisted. Omit to use keys/agent (BatchMode, fails fast).","type":"string"},"port":{"description":"Port the server should listen on / be probed at (default 9002).","type":"number"},"token":{"description":"Existing bearer token to thread through so detect REUSES it (avoids diverging from the server's config-authoritative token).","type":"string"},"user":{"description":"SSH user (blank = ssh default / ~/.ssh/config).","type":"string"}},"required":["host"],"type":"object"}},
  {"name":"system_status","description":"THE one-call steward rollup — call this FIRST to ground a decision instead of a stale checkpoint + N bash probes. COMPOSES the four foundational read-models (orchestrator_status: daemon running/level + pool occupancy + cold-starts · fleet_status: worker occupancy + proc-headroom early-warning · invariant_check: work-graph violation count · instance_topology: canonical :9002 confirmation vs stale shadows) PLUS inline: deploy/version drift (live sidecar pid+version+startedAt vs repo package.json version + git HEAD + uncommitted WIP — the 'did the deploy land or go cosmetic?' read), open-escalation + pending-decision counts, and steward/supervisor pause state. Returns a COMPACT summary with `pointers` to the focused tool for full detail behind any field. Read-only.","inputSchema":{"properties":{"project":{"description":"Tracking project to roll up (work-graph + deploy/git lives here).","type":"string"}},"required":["project"],"type":"object"}},
  {"name":"daemon_status","description":"LIVE leaf-executor activity — the piece fleet_status/orchestrator_status are blind to (a leaf run makes no tmux). Returns the leaves RUNNING RIGHT NOW (leafId, current nodeKind, model, attempt, elapsedMs, and a `stale` flag for rows older than 15m = a likely crashed run) + the headless circuit-breaker state (open/closed) + a `state` field (working | blocked-on-decision | claims-suppressed | claimable | idle). When scoped to a project, `state` is one of: working (leaves in flight), blocked-on-decision (a split parent has unapproved children — see `claimSuppression.blockedSplits`), claims-suppressed (ready leaves held by probes/budget/breaker), claimable (leaves ready to claim), or idle (no work). Use this to answer 'what is the daemon doing this second'; pair with orchestrator_status (level/pool/recentSpawns) and leaf_failures (what broke). Read-only.","inputSchema":{"properties":{"project":{"description":"Filter in-flight leaves to this project.","type":"string"}},"type":"object"}},
  {"name":"friction_trends","description":"Read-only recurrence rollup over the friction store. Groups the most-recent friction notes by LAYER (orchestration vs domain vs operational) with counts, and within each layer by retryReason, so a repeating problem (e.g. tmux-pane accumulation showing up as repeated orchestration friction) surfaces as a high-count reason instead of being buried in list_friction's flat newest-first list. Returns { total, considered, byLayer:[{ layer, count, reasons:[{ retryReason, count, sessions[], lastAt }] }], recurring:[{ layer, retryReason, count }] } — `recurring` is the cross-layer 'what keeps going wrong' shortlist (reasons seen >1, most-recurring first).","inputSchema":{"properties":{"layer":{"description":"Optional: restrict to one layer.","enum":["orchestration","domain","operational"],"type":"string"},"limit":{"description":"Max most-recent notes to consider (default 100, capped 1000).","type":"number"},"project":{"description":"Tracking project whose friction to roll up.","type":"string"}},"required":["project"],"type":"object"}},
  {"name":"orchestrator_off","description":"STEWARD KILL-SWITCH (one-way): force a project's Orchestrator autonomy level to 'off', stopping the daemon from driving todos. This is the steward's ONLY autonomy control — it can ALWAYS brake but can NEVER raise the level (decision 3bf1292b). It takes no level argument; raising autonomy stays human-only on the Bridge ladder. Reuses the server-side 'off' transition. Optional project (defaults to the server's cwd). Returns the resulting level for confirmation.","inputSchema":{"properties":{"project":{"description":"Project to brake (defaults to the current working directory).","type":"string"}},"type":"object"}},
  {"name":"runtime_config","description":"Read-only effective CONTROL PLANE in one view — what knobs the daemon is ACTUALLY running with, so the steward doesn't have to read config.json by hand + cross-reference N pause tools. Returns `flags` (the resolved values the running process uses, via each owning module's accessor — workerIsolation (MERMAID_WORKER_ISOLATION), poolSizes per type (MERMAID_POOL_<TYPE>), maxColdStarts (MERMAID_MAX_COLD_STARTS), deadGraceMs (MERMAID_DEAD_GRACE), and the effective context-watchdog threshold) + `overrides` (every pause/level: steward pause+liveness, supervisor pauses, this project's orchestrator autonomy level). COMPACT with `pointers` to the tool that changes each field. Read-only.","inputSchema":{"properties":{"project":{"description":"Tracking project whose per-project overrides (watchdog threshold, supervisor pause, orchestrator level) to resolve.","type":"string"}},"required":["project"],"type":"object"}},
  {"name":"orchestrator_status","description":"Live orchestrator daemon runtime snapshot: { running, tickMs, lastTickAt, projects:[{project,level}], pool:[{session,type,slot,status,todoId,tmux}], coldStartsInFlight, recentSpawns, recentAutonomousMutations:[{kind,actor,reason,project?,detail?,at}] }. `recentAutonomousMutations` (B6) is the in-memory newest-first log of self-driven mutations — reserve-leaf re-cuts, deploy-gate refusals, and terminal-mission self-heals — scoped to `project` when given (global entries always included), else all. Read-only. Returns running:false cleanly when the daemon is stopped. Thin wrapper over the worker pool + the orchestrator level/health.","inputSchema":{"properties":{"project":{"description":"Scope recentAutonomousMutations to this project (global entries are always included). Omit for all.","type":"string"}},"type":"object"}},
  {"name":"set_watchdog_threshold","description":"Set (or clear, with null) a project's context-watchdog trigger threshold (%). Overrides the 80% default for supervisor_watchdog_scan on that project. Pass null to revert to the default.","inputSchema":{"properties":{"project":{"type":"string"},"thresholdPercent":{"description":"Percent (1-100) or null to clear.","type":["number","null"]}},"required":["project","thresholdPercent"],"type":"object"}},
  {"name":"set_context_recycle","description":"Set a project's context-auto-recycle mode — the deterministic server-side driver that keeps a low-context WATCHED session alive by injecting /vibe-checkpoint → /clear → /collab (no LLM supervisor in the loop). 'off' (default) = inert; 'notify' = at the watchdog threshold, inject an advisory nudge and only auto-clear+reload once the session itself saves a fresh checkpoint (assisted); 'force' = server injects the checkpoint too, then clears+reloads (for an unattended autonomous-loop session).","inputSchema":{"properties":{"mode":{"description":"off | notify | force","enum":["off","notify","force"],"type":"string"},"project":{"type":"string"}},"required":["project","mode"],"type":"object"}},
  {"name":"context_usage","description":"Read-only per-session context-window report for a project: each watched session's contextPercent (last reported, with its age), the effective checkpoint threshold (per-project override or the 80% default), and a nearThreshold flag PLUS the watchdog action ('checkpoint'/'clear'/null) it would take this tick — computed from the SAME watchdog selector the supervisor_watchdog_scan uses, so the steward sees who is near a boundary before suggesting /clear. Returns { thresholdPercent, sessions:[{ session, status, contextPercent, contextAgeMs, checkpointReadyAt, nearThreshold, watchdogAction, reason }] }.","inputSchema":{"properties":{"project":{"description":"Tracking project whose sessions to report.","type":"string"},"thresholdPercent":{"description":"Override the checkpoint threshold % (default: per-project config → 80).","type":"number"}},"required":["project"],"type":"object"}},
];

export async function handleSystemTool(name: string, args: any): Promise<string | null> {
  switch (name) {
    case 'check_server_health': {
      try {
        const response = await apiFetch(`${API_BASE_URL}/api/health`, { method: 'GET', signal: AbortSignal.timeout(5000) });
        if (!response.ok) return JSON.stringify({ healthy: false, error: `Health check failed: ${response.statusText}` }, null, 2);
        return await response.text();
      } catch (error) {
        return JSON.stringify({ healthy: false, error: error instanceof Error ? error.message : 'Server not responding' }, null, 2);
      }
    }
    case 'fleet_status': {
      const { project } = args as { project: string };
      if (!project) throw new Error('Missing required: project');
      return JSON.stringify(await getFleetStatus(project), null, 2);
    }
    case 'deploy_self': {
      const { project } = args as { project: string };
      if (!project) throw new Error('Missing required: project');
      const result = await requestSelfDeploy(project);
      return JSON.stringify(result, null, 2);
    }
    case 'instance_topology': {
      const topology = await instanceTopology();
      return JSON.stringify(topology, null, 2);
    }
    case 'launch_remote_server': {
      const { host, port, user, password, command, token, detectOnly } = args as { host?: string; port?: number; user?: string; password?: string; command?: string; token?: string; detectOnly?: boolean };
      if (!host) throw new Error('Missing required: host');
      if (/@/.test(host)) throw new Error(`host must be a bare host/IP, not "${host}" — put the SSH user in the "user" arg instead`);
      const { detectRemoteLaunch, launchRemoteServer } = await import('../services/remote-launch.js');
      const p = Number(port) || 9002;
      let detect: Awaited<ReturnType<typeof detectRemoteLaunch>> | undefined;
      if (!command || detectOnly) {
        detect = await detectRemoteLaunch({ host, port: p, user: user?.trim() || undefined, password: password || undefined, token: token?.trim() || undefined });
      }
      if (detectOnly) return JSON.stringify({ phase: 'detect', detect }, null, 2);
      const effectiveCommand = command || detect?.suggestedCommand;
      const effectiveToken = token?.trim() || detect?.token;
      if (!effectiveCommand) return JSON.stringify({ phase: 'detect', ok: false, detect, error: detect?.note || detect?.error || 'no launchable command — provide `command` or install bun/mermaid-collab on the remote' }, null, 2);
      const launch = await launchRemoteServer({ host, port: p, user: user?.trim() || undefined, password: password || undefined, command: effectiveCommand, token: effectiveToken });
      return JSON.stringify({ phase: 'launch', detect, launch, token: effectiveToken }, null, 2);
    }
    case 'system_status': {
      const { project } = args as { project: string };
      if (!project) throw new Error('Missing required: project');
      return JSON.stringify(await systemStatus(project), null, 2);
    }
    case 'daemon_status': {
      const { project } = args as { project?: string };
      const now = Date.now();
      const STALE_MS = 15 * 60 * 1000;
      const inflight = listLeafInflight({ project }).map((r) => ({ leafId: r.leafId, project: r.project, epicId: r.epicId ?? null, nodeKind: r.nodeKind ?? null, model: r.model ?? null, attempt: r.attempt ?? null, startedAt: r.startedAt, elapsedMs: now - r.startedAt, stale: now - r.startedAt > STALE_MS }));
      const claimSuppression = project ? await diagnoseClaimSuppression(project) : undefined;
      const state = inflight.length > 0 ? 'working' : claimSuppression?.blocked ? 'blocked-on-decision' : (claimSuppression?.suppressed.length ?? 0) > 0 ? 'claims-suppressed' : (claimSuppression?.claimable ?? 0) > 0 ? 'claimable' : 'idle';
      return JSON.stringify({ now, state, inflight, breaker: { open: breakerOpen() }, ...(claimSuppression ? { claimSuppression } : {}) }, null, 2);
    }
    case 'friction_trends': {
      const { project, layer, limit } = args as { project: string; layer?: any; limit?: number };
      if (!project) throw new Error('Missing required: project');
      const trends = frictionTrends(project, { layer, limit });
      return JSON.stringify(trends, null, 2);
    }
    case 'orchestrator_off': {
      const { project } = args as { project?: string };
      const target = project || process.cwd();
      const { orchestratorOff } = await import('../services/orchestrator-config.js');
      const level = orchestratorOff(target);
      const { killLeafProcsForProject } = await import('../services/leaf-subprocess-registry.js');
      const killedLeaves = killLeafProcsForProject(target);
      recordSupervisorDecision('override', target, 'steward', JSON.stringify({ action: 'orchestrator_off', killedLeaves }));
      return JSON.stringify({ project: target, level, killedLeaves }, null, 2);
    }
    case 'runtime_config': {
      const { project } = args as { project: string };
      if (!project) throw new Error('Missing required: project');
      return JSON.stringify(runtimeConfig(project), null, 2);
    }
    case 'orchestrator_status': {
      const { listPool } = await import('../services/worker-pool.js');
      const health: { running: boolean; tickMs?: number; lastTickAt?: number | null; projects?: Array<{ project: string; level: string }> } = getOrchestratorHealthSST();
      const pool = listPool().map((s) => ({ project: s.project, session: s.sessionName, type: s.type, provider: s.provider, slot: s.slot, status: s.status, todoId: s.currentTodoId ?? null }));
      let recentSpawns: unknown[] = [];
      try {
        recentSpawns = supervisorStore.listSupervisorAudit({ kind: 'spawn', limit: 10 });
      } catch {}
      const { project: statusProject } = (args ?? {}) as { project?: string };
      let recentAutonomousMutations: unknown[] = [];
      try {
        const { recentAutonomousMutations: readAutonomy } = await import('../services/autonomy-log.js');
        recentAutonomousMutations = readAutonomy(statusProject ? { project: statusProject } : {});
      } catch {}
      return JSON.stringify({ running: health.running, tickMs: health.tickMs ?? null, lastTickAt: health.lastTickAt ?? null, projects: health.projects ?? [], pool, coldStartsInFlight: getColdStartsInFlight(), recentSpawns, recentAutonomousMutations }, null, 2);
    }
    case 'set_watchdog_threshold': {
      const { project, thresholdPercent } = args as { project: string; thresholdPercent: number | null };
      if (!project) throw new Error('Missing required: project');
      if (thresholdPercent !== null && (typeof thresholdPercent !== 'number' || thresholdPercent < 1 || thresholdPercent > 100)) throw new Error('thresholdPercent must be a number 1-100, or null to clear');
      supervisorStore.setWatchdogThreshold(project, thresholdPercent);
      return JSON.stringify({ project, thresholdPercent }, null, 2);
    }
    case 'set_context_recycle': {
      const { project, mode } = args as { project: string; mode: string };
      if (!project || !mode) throw new Error('Missing required: project, mode');
      if (mode !== 'off' && mode !== 'notify' && mode !== 'force') throw new Error('mode must be one of: off, notify, force');
      supervisorStore.setContextRecycleMode(project, mode);
      return JSON.stringify({ project, mode }, null, 2);
    }
    case 'context_usage': {
      const { project, thresholdPercent } = args as { project: string; thresholdPercent?: number };
      if (!project) throw new Error('Missing required: project');
      const effectiveThreshold = thresholdPercent ?? supervisorStore.getWatchdogThreshold(project) ?? DEFAULT_WATCHDOG_CONFIG.thresholdPercent;
      const cfg = { ...DEFAULT_WATCHDOG_CONFIG, thresholdPercent: effectiveThreshold };
      const now = Date.now();
      const runtimes = listSessionRuntimes(project, now);
      const actionBySession = new Map(selectWatchdogActions(runtimes, now, cfg).map((a) => [a.session, a] as const));
      const sessions = runtimes.map((r) => {
        const action = actionBySession.get(r.session) ?? null;
        return { session: r.session, status: r.status, contextPercent: r.contextPercent, contextAgeMs: r.contextUpdatedAt != null ? now - r.contextUpdatedAt : null, checkpointReadyAt: r.checkpointReadyAt, nearThreshold: action != null, watchdogAction: action?.action ?? null, reason: action?.reason ?? null };
      });
      return JSON.stringify({ project, thresholdPercent: effectiveThreshold, sessions }, null, 2);
    }
    default:
      return null;
  }
}
