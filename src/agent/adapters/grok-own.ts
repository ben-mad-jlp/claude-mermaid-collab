/**
 * GrokOwnHarness (PAW P4) — the second WorkerAgent, productionized from the
 * proven Phase-0 spike (`spike/grok-worker-v2.ts`).
 *
 * Unlike ClaudeCodeAgent (which wraps a tmux + `claude` CLI and SCRAPES a pane),
 * this adapter OWNS the worker loop IN-PROCESS: a Vercel AI SDK `generateText`
 * agentic loop driving `xai('grok-build-0.1')` against our completion funnel
 * (get_todo / complete_todo called IN-PROCESS — the harness already runs inside
 * the sidecar, so there is no MCP subprocess to spawn) plus a set of
 * worktree-scoped file/bash tools. There is no tmux, no pane, no `claude`.
 *
 * To satisfy the SAME WorkerAgent port (so the coordinator's watchdog / fleet
 * code never branches on provider), the harness SYNTHESIZES a "pane-equivalent"
 * text snapshot from its in-process loop state. The detector methods parse those
 * synthetic panes exactly as the Claude detectors parse real ones, so the
 * normalized WorkerEvent booleans (tuiReady / activelyWorking / permission / …)
 * stay meaningful and the conformance harness can pin them against recorded
 * grok-loop fixtures (see GROK_PANE_FIXTURES in conformance.ts).
 *
 * SAFETY: this adapter is registered DORMANT — the registry kill-switch keeps the
 * default surface claude-only, and launchWorker only routes here when a todo's
 * provider pin resolves to 'grok-build'. It must also pass the conformance suite
 * (assertGrokConformant) BEFORE it is handed out by the registry.
 *
 * Completion is NEVER trusted from the model: the grok loop calls the in-process
 * `complete_todo` funnel (same funnel Claude workers use), which routes through
 * handleWorkerComplete → resolveCompletion (the mechanical gate + the
 * work-committed re-verify) server-side. The harness only INFERS the loop is done
 * — the authoritative accept/reject/pending verdict is the resolver's.
 */
import { generateText, stepCountIs, tool } from 'ai';
import { createXai } from '@ai-sdk/xai';
import { z } from 'zod';
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_EVENT_POLL_MS } from '../worker-agent';
import { getTodo } from '../../services/todo-store';
import { getConfig, getSecret } from '../../services/config-service';
import { recordPhase } from '../../services/worker-ledger';
import { knownPricing } from '../worker-core/cost';
import { getWebSocketHandler } from '../../services/ws-handler-manager';
import type {
  WorkerAgent,
  WorkerEvent,
  LaunchSpec,
  WorkerHandle,
  PaneSource,
  EventStreamOpts,
  ProviderId,
} from '../worker-agent';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Default model for the grok-build provider — matches the spike. */
export const DEFAULT_GROK_MODEL = 'grok-build-0.1';

/** Hard per-worker deadline. One pathological loop must never wobble the daemon —
 *  the loop is wrapped in AbortSignal.timeout(this) so it always terminates. */
export const GROK_WORKER_DEADLINE_MS = 15 * 60 * 1000;

/** Step cap for the agentic loop (the spike used 50). */
export const GROK_STEP_CAP = 50;

// ---------------------------------------------------------------------------
// Synthetic "pane" lifecycle phases.
//
// The in-process loop has no terminal pane, so it emits a tiny status line per
// lifecycle phase that the detectors below parse. These tokens were chosen so
// the SAME boolean shape the Claude detectors produce is reproducible:
//   READY      → tuiReady && tuiPresent, not working
//   WORKING    → tuiReady && tuiPresent && activelyWorking
//   RATE_LIMIT → working pane carrying the rate-limit signature
//   DONE/EXIT  → not present, not ready, not working (loop ended)
// ---------------------------------------------------------------------------

export const GROK_PANE_READY = 'grok-build | ready · for agents';
export function grokPaneWorking(step: number): string {
  // Mirrors the Claude spinner "(26s · …)" shape so isActivelyWorking matches.
  return `grok-build | for agents\n✻ working step ${step} (1s · ↓ tokens · esc to interrupt)`;
}
export const GROK_PANE_RATE_LIMITED =
  'grok-build | for agents\n⏳ Rate limited (429) — temporarily limiting requests';
export const GROK_PANE_EXITED = 'grok-build | done\n(loop ended)';

// ---------------------------------------------------------------------------
// Pure detectors over the synthetic grok pane.
// ---------------------------------------------------------------------------

/** The grok status line is "painted" (loop is up and bound) when it carries the
 *  `for agents` / `ready` marker — the analogue of the Claude status bar. */
export function isGrokReady(pane: string): boolean {
  return /for agents|grok-build \| ready/.test(pane);
}

/** Any grok TUI-equivalent chrome present (status line, working spinner, the
 *  done line). Used only to avoid a false dead call during the spawn gap. */
export function isGrokPresent(pane: string): boolean {
  return /grok-build \||for agents|esc to interrupt|\(\d+(?:m\s*\d+)?s\s*·|loop ended/.test(pane);
}

/** Actively working when the synthetic spinner+timer or the interrupt hint is
 *  present — same regex family as the Claude detector. */
export function isGrokWorking(pane: string): boolean {
  return /\(\d+(?:m\s*\d+)?s\s*·/.test(pane) || /esc to interrupt/i.test(pane);
}

/** The grok loop has no human permission prompt (it is headless, tools are
 *  pre-granted) — so it never sits on a permission gate. */
export function detectGrokPermission(pane: string): { isPermission: boolean; tool: string | null } {
  void pane;
  return { isPermission: false, tool: null };
}

/** Best-effort stall context — the last few non-empty lines of the synthetic pane. */
export function extractGrokStallContext(pane: string): string {
  return pane
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-6)
    .join('\n');
}

/** A grok rate-limit (HTTP 429) carries the same signature the coordinator's
 *  detectRateLimit reads (temporarily-limiting / "Rate limited"). */
export function isGrokRateLimited(pane: string): boolean {
  if (/usage limit reached|limit will reset/i.test(pane)) return false;
  return /temporarily limiting requests/i.test(pane) || /\bRate limited\b/i.test(pane) || /\b429\b/.test(pane);
}

/** A thrown error is a rate-limit (429) when its message/status says so. Typed so
 *  the loop can map a caught throttle → the 'rate-limited' phase. */
export function isRateLimitError(err: unknown): boolean {
  const anyErr = err as { statusCode?: number; status?: number; message?: string } | null;
  if (!anyErr) return false;
  if (anyErr.statusCode === 429 || anyErr.status === 429) return true;
  return /\b429\b|rate.?limit|too many requests/i.test(anyErr.message ?? '');
}

/** Per-project opt-in for the worker-core discipline engine. A project runs
 *  worker-core ONLY if it is in the WORKER_CORE_PROJECTS config allowlist (comma-
 *  separated absolute paths and/or basenames) — so enabling it for one project can
 *  never silently change autonomous (drive-level) projects. WORKER_CORE=1 as an ENV
 *  var (NOT config) is a global override for local dev only: the GUI sidecar has no
 *  shell env, so there is no production footgun. */
export function workerCoreEnabledFor(project: string): boolean {
  if (process.env.WORKER_CORE === '1') return true; // dev/env-only global override
  const list = getConfig('WORKER_CORE_PROJECTS', '') ?? '';
  if (!list.trim()) return false;
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((p) => project === p || basename(project) === p);
}

/** Worker-fabric spine (design-worker-fabric-ui §6.4): broadcast a structural
 *  `worker_phase` event so the live work-graph can decorate the todo's node with its
 *  phase/route/cost. Additive + best-effort (a telemetry broadcast must NEVER break a
 *  run); the per-step events stay in the transcript poll, not WS, to keep node churn low. */
function broadcastWorkerPhase(
  spec: LaunchSpec,
  todoId: string,
  epicId: string | undefined,
  lifecycle: 'start' | 'end',
  e: {
    role: string;
    ts: number;
    model?: string;
    route?: { provider: string; model: string; source: string; winningScope?: string };
    usage?: { inputTokens?: number; outputTokens?: number };
    costUsd?: number;
    steps?: number;
  },
): void {
  try {
    getWebSocketHandler()?.broadcast({
      type: 'worker_phase',
      project: spec.project,
      session: spec.session,
      todoId,
      epicId,
      lifecycle,
      role: e.role,
      provider: e.route?.provider,
      model: e.route?.model ?? e.model,
      source: e.route?.source,
      winningScope: e.route?.winningScope,
      usage: lifecycle === 'end' ? e.usage : undefined,
      costUsd: lifecycle === 'end' ? e.costUsd : undefined,
      steps: lifecycle === 'end' ? e.steps : undefined,
      ts: e.ts,
    });
  } catch {
    /* a telemetry broadcast must never break the run */
  }
}

// ---------------------------------------------------------------------------
// The adapter.
// ---------------------------------------------------------------------------

/** The lifecycle phase the in-process loop is in — drives the synthetic pane the
 *  detectors observe. */
export type GrokPhase = 'idle' | 'ready' | 'working' | 'rate-limited' | 'exited' | 'failed';

/** One captured agentic step — the live transcript the UI console renders for a
 *  grok-build lane. This is NEW state ALONGSIDE the synthetic-pane/WorkerEvent
 *  contract the conformance suite pins; it never replaces lastPane/step. */
export type GrokTranscriptEntry = {
  step: number;
  ts: number;
  text?: string;
  toolCalls?: { name: string; args: unknown }[];
  toolResults?: { name: string; result: string }[];
};

/** Trim long tool-result strings so the transcript stays bounded. */
const TRANSCRIPT_RESULT_CAP = 1500;

/** In-process loop state for one lane (one per session). */
interface GrokLane {
  phase: GrokPhase;
  step: number;
  controller: AbortController;
  done: boolean;
  lastPane: string;
  /** Live transcript captured per onStepFinish (NEW; alongside the pane contract). */
  transcript: GrokTranscriptEntry[];
  /** Human steer messages queued for injection at the NEXT step boundary. */
  injectQueue: string[];
}

class GrokOwnHarnessImpl implements WorkerAgent {
  /** Provider this instance serves. Default 'grok-build' (the original harness,
   *  byte-identical). A non-grok instance (e.g. 'claude') reuses the SAME in-process
   *  worker-core machinery — only the base provider passed to the bridge differs, and
   *  it ALWAYS takes the worker-core path (no grok flat-loop fallback). */
  readonly id: ProviderId;
  constructor(id: ProviderId = 'grok-build') {
    this.id = id;
  }

  /** In-process loop state, keyed by session. Liveness is loop-promise-based (NOT a
   *  ps subtree): a lane is alive while its loop promise is unsettled. */
  private lanes = new Map<string, GrokLane>();

  async launch(spec: LaunchSpec): Promise<WorkerHandle> {
    // The daemon (launchWorker) OWNS the worktree: spec.cwd is the lane's git
    // worktree it already created. We thread it EXPLICITLY into every tool —
    // never process.chdir (a single shared cwd across concurrent lanes would
    // stomp). With no cwd we cannot isolate → refuse rather than write into the
    // wrong tree.
    const cwd = spec.cwd;
    if (!cwd || !existsSync(cwd)) {
      return { provider: this.id, ready: false, reason: 'no-cwd-dir' };
    }

    const controller = new AbortController();
    const lane: GrokLane = {
      phase: 'idle',
      step: 0,
      controller,
      done: false,
      lastPane: GROK_PANE_READY,
      transcript: [],
      injectQueue: [],
    };
    this.lanes.set(spec.session, lane);

    // The completion funnel (get_todo / complete_todo) is called IN-PROCESS — the
    // harness already runs inside the sidecar process, so there is NO MCP
    // subprocess to spawn (the packaged sidecar has no repo / no `bun` on PATH).
    // Bind the tools (in-process funnel verbs + worktree-scoped file/bash), then
    // kick off the loop. The loop runs to completion in the background; launch()
    // returns as soon as the session is "ready" (analogous to ensureSession
    // returning on a painted TUI). If no invokeSkill was passed, only the session
    // is ensured.
    lane.phase = 'ready';
    lane.lastPane = GROK_PANE_READY;

    if (!spec.invokeSkill) {
      // Session ensured, nothing dispatched (matches the Claude no-invokeSkill path).
      return {
        provider: this.id,
        ready: true,
        tmux: spec.session,
        sent: undefined,
        injectFollowup: (text: string) => this.injectFollowup(spec.session, text),
      };
    }

    // Fire the loop. We DO NOT await it here — the daemon observes liveness via
    // isAlive()/events() and completion via the in-process complete_todo funnel.
    // PARALLEL-RUN: opt a lane into the shared worker-core discipline engine instead
    // of the flat loop. PER-PROJECT by design (workerCoreEnabledFor): only projects
    // in the WORKER_CORE_PROJECTS allowlist run it, so enabling it for one project can
    // never silently change autonomous (drive-level) projects. Default = flat loop.
    // A non-grok instance (e.g. claude in-process) has NO grok flat loop — it always
    // runs worker-core. grok-build keeps the per-project flag (parallel-run vs flat loop).
    const useWorkerCore = this.id !== 'grok-build' || workerCoreEnabledFor(spec.project);
    const driver = useWorkerCore
      ? this.runViaWorkerCore(spec, cwd, lane)
      : this.runLoop(spec, cwd, lane);
    void driver.catch(() => {
      // the driver already records phase=failed; the hard catch here is the final
      // backstop so a rejected promise can never escape into the daemon tick.
      lane.phase = 'failed';
      lane.done = true;
    });

    return {
      provider: this.id,
      ready: true,
      tmux: spec.session,
      sent: true,
      injectFollowup: (text: string) => this.injectFollowup(spec.session, text),
    };
  }

  /** Live transcript for a lane (the human-readable agentic log the UI console
   *  renders for a grok-build lane). Empty array for unknown sessions. */
  getTranscript(session: string): GrokTranscriptEntry[] {
    return this.lanes.get(session)?.transcript ?? [];
  }

  /** Queue a human steer follow-up. It is appended as a `user` turn at the NEXT
   *  step boundary (via prepareStep) — NOT injected mid-step. Returns false when
   *  there is no live lane to steer. */
  injectFollowup(session: string, text: string): boolean {
    const lane = this.lanes.get(session);
    if (!lane || lane.done) return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    lane.injectQueue.push(trimmed);
    return true;
  }

  /** The in-process agentic loop. Wrapped in a hard try/catch + a per-worker
   *  deadline so one bad loop can't wobble the daemon. */
  /** PARALLEL-RUN driver: run this lane through the shared worker-core discipline
   *  engine (the host-owned vibe-go recipe) instead of the flat loop. Selected by
   *  WORKER_CORE=1. Dynamic import keeps the adapter↔worker-core↔coordinator graph
   *  cycle-free. Completion is host-authoritative inside runWorkerCore. */
  private async runViaWorkerCore(spec: LaunchSpec, cwd: string, lane: GrokLane): Promise<void> {
    const todoId = invokeSkillTodoId(spec.invokeSkill);
    // Resolve the todo's epic once at lane start (for per-epic cost rollup / budget bars).
    const epicId = getTodo(spec.project, todoId)?.parentId ?? undefined;
    lane.phase = 'working';
    lane.lastPane = grokPaneWorking(0);
    let runCostUsd = 0;
    try {
      const { runWorkerCore, makeCoordinatorWorkerDeps } = await import('../worker-core');
      const deps = makeCoordinatorWorkerDeps(spec.project, todoId, { provider: this.id });
      await runWorkerCore(
        {
          project: spec.project,
          todoId,
          cwd,
          session: spec.session,
          abortSignal: lane.controller.signal,
          // Sink worker-core phase events into the SAME live transcript the Bridge
          // console reads (/api/worker-transcript) — the worker-core path is observable
          // in the existing UI, no black box (north-star §6).
          onEvent: (e) => {
            if (e.type === 'phase-start') {
              lane.step += 1;
              lane.lastPane = grokPaneWorking(lane.step);
              // Routing visibility (north-star §6): which provider/model ran + why.
              const route = e.route
                ? ` → ${e.route.provider}/${e.route.model} (${e.route.source})`
                : e.model ? ` (${e.model})` : '';
              lane.transcript.push({ step: lane.step, ts: e.ts, text: `▶ ${e.role}${route}` });
              broadcastWorkerPhase(spec, todoId, epicId, 'start', e);
            } else if (e.type === 'step') {
              lane.step += 1;
              lane.transcript.push({
                step: lane.step,
                ts: e.ts,
                text: e.text,
                toolCalls: e.toolCalls,
                toolResults: e.toolResults,
              });
            } else if (e.type === 'phase-end') {
              // Per-phase cost line → the live transcript + the run total (cost ledger).
              runCostUsd += e.costUsd ?? 0;
              // Durable, queryable audit trail (north-star §6) — best-effort, never throws.
              recordPhase({
                project: spec.project,
                todoId,
                epicId,
                session: spec.session,
                phase: e.role,
                provider: e.route?.provider ?? this.id,
                model: e.model ?? '?',
                source: e.route?.source ?? 'default',
                inputTokens: e.usage?.inputTokens ?? 0,
                outputTokens: e.usage?.outputTokens ?? 0,
                costUsd: e.costUsd ?? 0,
                knownPrice: knownPricing(e.model),
                steps: e.steps,
                parseError: e.parseError ?? null,
              });
              broadcastWorkerPhase(spec, todoId, epicId, 'end', e);
              const tok = e.usage ? `${e.usage.inputTokens ?? 0}/${e.usage.outputTokens ?? 0} tok` : '';
              lane.step += 1;
              lane.transcript.push({
                step: lane.step,
                ts: e.ts,
                text: `◀ ${e.role} · ${e.model ?? '?'} · ${tok} · $${(e.costUsd ?? 0).toFixed(4)}`,
              });
            }
          },
        },
        deps,
      );
      lane.transcript.push({ step: ++lane.step, ts: Date.now(), text: `💲 run cost: $${runCostUsd.toFixed(4)}` });
      lane.phase = 'exited';
      lane.lastPane = GROK_PANE_EXITED;
    } catch (e) {
      if (isRateLimitError(e)) {
        lane.phase = 'rate-limited';
        lane.lastPane = GROK_PANE_RATE_LIMITED;
      } else {
        lane.phase = 'failed';
        lane.lastPane = GROK_PANE_EXITED;
      }
    } finally {
      lane.done = true;
    }
  }

  private async runLoop(
    spec: LaunchSpec,
    cwd: string,
    lane: GrokLane,
  ): Promise<void> {
    // Worktree-scoped path guard — reject any escape out of the lane's worktree.
    const safe = (p: string): string => {
      const abs = resolve(cwd, p);
      if (!abs.startsWith(cwd)) throw new Error('path escapes the worktree');
      return abs;
    };

    const todoId = invokeSkillTodoId(spec.invokeSkill);
    // Capture the lane's claim token at LANE START, not at completion — a token read
    // at completion time would always match the current row and defeat the CAS.
    const laneClaimToken = getTodo(spec.project, todoId)?.claim?.token ?? undefined;

    const tools = {
      get_todo: tool({
        description: 'Read the work-graph todo you are assigned (the task spec).',
        inputSchema: z.object({ project: z.string(), todoId: z.string() }),
        // In-process funnel — no MCP subprocess (we already run in the sidecar).
        execute: async ({ project, todoId }) => {
          const todo = getTodo(project, todoId);
          return todo ? JSON.stringify(todo) : '(todo not found)';
        },
      }),
      complete_todo: tool({
        description: 'Report completion of your todo: accepted or rejected. The server runs the authoritative gate.',
        inputSchema: z.object({ project: z.string(), todoId: z.string(), acceptance: z.enum(['accepted', 'rejected']) }),
        // In-process funnel — same server-authoritative resolver Claude workers
        // hit (handleWorkerComplete → resolveCompletion). DYNAMIC imports here to
        // break the import cycle: coordinator-live imports the adapter registry,
        // which imports this file; a static import would close that loop.
        execute: async ({ project, todoId, acceptance }) => {
          const { makeCoordinatorDeps } = await import('../../services/coordinator-live');
          const { handleWorkerComplete } = await import('../../services/coordinator-daemon');
          const result = await handleWorkerComplete(makeCoordinatorDeps(), project, todoId, acceptance, laneClaimToken);
          return JSON.stringify(result);
        },
      }),
      write_file: tool({
        description: 'Write a file (relative to the worktree root). Do NOT use absolute paths.',
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        execute: async ({ path, content }) => {
          const abs = safe(path);
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, content);
          return `wrote ${path}`;
        },
      }),
      read_file: tool({
        description: 'Read a file (relative to the worktree root).',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => {
          const abs = safe(path);
          return existsSync(abs) ? readFileSync(abs, 'utf8') : '(no such file)';
        },
      }),
      run_bash: tool({
        description:
          'Run a bash command. You are ALREADY inside your isolated worktree — do NOT cd to absolute paths; use relative paths.',
        inputSchema: z.object({ cmd: z.string() }),
        execute: async ({ cmd }) => {
          // The harness owns cwd (the isolation seam) — an absolute `cd` out of the
          // worktree is rejected, exactly as the spike does.
          if (/(^|&&|;|\|)\s*cd\s+\//.test(cmd)) {
            return 'ERROR: you are already in your worktree — do not cd to absolute paths; use relative paths.';
          }
          // cwd is threaded EXPLICITLY — never process.chdir.
          const r = spawnSync('bash', ['-lc', cmd], { cwd, encoding: 'utf8' });
          return `exit=${r.status}\n${((r.stdout ?? '') + (r.stderr ?? '')).slice(-1800)}`;
        },
      }),
    };

    const project = spec.project;
    const prompt = [
      `You are an autonomous coding worker. Your assigned todo id is "${todoId}" in project "${project}".`,
      'You are ALREADY inside your isolated git worktree — it is the current directory. Create all files HERE with relative paths. Do NOT cd to any absolute path.',
      `STEP 1: call get_todo({project:"${project}", todoId:"${todoId}"}) to read the spec.`,
      'STEP 2: implement it HERE (relative paths) using write_file.',
      'STEP 3: run_bash your tests and iterate until they pass.',
      'STEP 4: run_bash `git add -A && git commit -m "feat: <summary>"`.',
      `STEP 5: call complete_todo({project:"${project}", todoId:"${todoId}", acceptance:"accepted"}).`,
      'Then stop. Do not ask questions.',
    ].join('\n');

    // Hard deadline: the loop ALWAYS terminates. Compose the external teardown
    // abort with a timeout abort.
    const deadline = AbortSignal.timeout(GROK_WORKER_DEADLINE_MS);
    const abortSignal = anyAbort(lane.controller.signal, deadline);

    lane.phase = 'working';
    try {
      // config.json-first, env fallback (same precedence grokAvailable() uses) —
      // never the bare `xai` singleton, which only reads process.env and can
      // diverge from a Secrets-UI-rotated key (see grok-review-lane-fix).
      const apiKey = getSecret('XAI_API_KEY');
      if (!apiKey) {
        throw new Error('GrokOwnHarness: XAI_API_KEY not configured (env or Secrets UI)');
      }
      await generateText({
        model: createXai({ apiKey })(spec.model ?? DEFAULT_GROK_MODEL),
        tools,
        stopWhen: stepCountIs(GROK_STEP_CAP),
        system: 'Autonomous coding worker. Use tools only. Be terse.',
        prompt,
        abortSignal,
        // prepareStep runs BEFORE each step. We drain any queued human steer and
        // append it as user turn(s) so Grok sees the steer at the NEXT step
        // boundary (never mid-step). Returning { messages } overrides the messages
        // sent to the model for this step; returning {} leaves them unchanged.
        prepareStep: ({ messages }) => {
          if (lane.injectQueue.length === 0) return {};
          const queued = lane.injectQueue.splice(0, lane.injectQueue.length);
          const injected = queued.map((text) => ({ role: 'user' as const, content: text }));
          return { messages: [...messages, ...injected] };
        },
        // onStepFinish receives the StepResult for the step that just finished.
        // We capture its text + tool calls/results into the live transcript
        // (NEW state) while keeping the existing step/phase/lastPane updates that
        // drive the synthetic pane the conformance detectors pin.
        onStepFinish: (stepResult) => {
          lane.step += 1;
          lane.phase = 'working';
          lane.lastPane = grokPaneWorking(lane.step);

          const toolCalls = (stepResult.toolCalls ?? []).map((c) => ({
            name: c.toolName,
            args: c.input,
          }));
          const toolResults = (stepResult.toolResults ?? []).map((r) => {
            const out = (r as { output?: unknown }).output;
            const str = typeof out === 'string' ? out : JSON.stringify(out ?? null);
            return {
              name: r.toolName,
              result: str.length > TRANSCRIPT_RESULT_CAP ? `${str.slice(0, TRANSCRIPT_RESULT_CAP)}…` : str,
            };
          });
          lane.transcript.push({
            step: lane.step,
            ts: Date.now(),
            text: stepResult.text || undefined,
            toolCalls: toolCalls.length ? toolCalls : undefined,
            toolResults: toolResults.length ? toolResults : undefined,
          });
        },
      });
      // Loop done. Grok completion is INFERRED — the server-authoritative resolver
      // (run via the in-process complete_todo the loop already called) decides the gate +
      // epic-branch check. The terminal in-process signal is "no further work".
      lane.phase = 'exited';
      lane.lastPane = GROK_PANE_EXITED;
    } catch (e) {
      if (isRateLimitError(e)) {
        lane.phase = 'rate-limited';
        lane.lastPane = GROK_PANE_RATE_LIMITED;
      } else {
        lane.phase = 'failed';
        lane.lastPane = GROK_PANE_EXITED;
      }
    } finally {
      lane.done = true;
    }
  }

  /** The terminal completion signal the daemon reads when the in-process loop
   *  ends. Grok completion is INFERRED ({ tier: 'none' }) — never a model
   *  self-report; the resolver runs the gate + epic-branch check. */
  completionSignal(session: string): { tier: 'none' } {
    void session;
    return { tier: 'none' };
  }

  /** Loop liveness — a lane is alive while its loop has not settled (done === false)
   *  and it was not torn down. This is loop-promise-based, NOT a ps subtree. */
  isAlive(session: string): boolean {
    const lane = this.lanes.get(session);
    return !!lane && !lane.done;
  }

  /** Abort the loop for a lane (idempotent). */
  async teardown(session: string): Promise<void> {
    const lane = this.lanes.get(session);
    if (!lane) return;
    try {
      lane.controller.abort();
    } catch {
      /* best-effort */
    }
    lane.done = true;
    this.lanes.delete(session);
  }

  // --- WorkerDetectors (over the synthetic grok pane) ----------------------

  isTuiReady(pane: string): boolean {
    return isGrokReady(pane);
  }
  isTuiPresent(pane: string): boolean {
    return isGrokPresent(pane);
  }
  isActivelyWorking(pane: string): boolean {
    return isGrokWorking(pane);
  }
  detectPermissionPrompt(pane: string): { isPermission: boolean; tool: string | null } {
    return detectGrokPermission(pane);
  }
  extractStallContext(pane: string): string {
    return extractGrokStallContext(pane);
  }
  /** In-process liveness is loop-promise-based, so the ps-subtree BFS is N/A here.
   *  There is no `grok` process child to find — return false (the coordinator uses
   *  isAlive() for the in-process path; this method exists only for port parity and
   *  must never CLAIM a process subtree it doesn't own). */
  isAgentAliveInSubtree(
    _rootPid: number,
    _snap: Map<number, { children: number[]; comm: string }>,
  ): boolean {
    return false;
  }

  async *events(source: PaneSource, opts: EventStreamOpts = {}): AsyncIterable<WorkerEvent> {
    const interval = opts.intervalMs ?? DEFAULT_EVENT_POLL_MS;
    const max = opts.maxPolls ?? Infinity;
    let polls = 0;
    while (polls < max) {
      if (opts.signal?.aborted) return;
      const pane = await source.capture();
      yield this.snapshot(pane);
      polls++;
      if (source.done?.() || opts.signal?.aborted || polls >= max) return;
      await sleep(interval);
    }
  }

  /** A PaneSource that captures the lane's current synthetic pane — lets the
   *  coordinator's watchdog observe the in-process loop via the SAME events()
   *  contract it uses for the tmux-backed Claude lane. */
  paneSource(session: string): PaneSource {
    return {
      capture: () => this.lanes.get(session)?.lastPane ?? GROK_PANE_EXITED,
      done: () => !this.isAlive(session),
    };
  }

  snapshot(pane: string): WorkerEvent {
    return {
      pane,
      tuiReady: isGrokReady(pane),
      tuiPresent: isGrokPresent(pane),
      activelyWorking: isGrokWorking(pane),
      permission: detectGrokPermission(pane),
      stallContext: extractGrokStallContext(pane),
    };
  }
}

/** Extract the todoId from an invokeSkill like `/mermaid-collab:worker <todoId>`. */
function invokeSkillTodoId(invokeSkill?: string): string {
  if (!invokeSkill) return '';
  const m = invokeSkill.trim().match(/(\S+)\s*$/);
  return m ? m[1] : '';
}

/** Compose multiple AbortSignals into one that aborts when ANY input aborts.
 *  (AbortSignal.any exists in modern runtimes but we compose explicitly so the
 *  intent is clear and the deadline reason is preserved.) */
function anyAbort(...signals: AbortSignal[]): AbortSignal {
  if (typeof (AbortSignal as { any?: unknown }).any === 'function') {
    return (AbortSignal as unknown as { any(s: AbortSignal[]): AbortSignal }).any(signals);
  }
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

/** The single GrokOwnHarness instance (stateful — it tracks in-process lanes — so
 *  one shared instance is the lane registry). */
type InProcessHarness = WorkerAgent & {
  isAlive(session: string): boolean;
  teardown(session: string): Promise<void>;
  paneSource(session: string): PaneSource;
  completionSignal(session: string): { tier: 'none' };
  getTranscript(session: string): GrokTranscriptEntry[];
  injectFollowup(session: string, text: string): boolean;
};

export const GrokOwnHarness: InProcessHarness = new GrokOwnHarnessImpl();

/** In-process Claude worker — the SAME worker-core harness with 'claude' as the base
 *  provider (daemon-native, NOT the legacy `claude` CLI). Reached only via
 *  resolveAnthropicCoreAgent behind the claude-in-process flag (parallel-run vs
 *  ClaudeCodeAgent), so it never changes default claude behavior. */
export const AnthropicOwnHarness: InProcessHarness = new GrokOwnHarnessImpl('claude');
