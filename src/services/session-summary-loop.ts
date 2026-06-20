/**
 * Session-summary loop — Phase 2 of design-zen-mode.
 *
 * Zero-LLM / purely structural: tmux pane hashing + quiet-window counters +
 * deterministic state machine. Emits `session_summary_updated` WS messages with
 * a graded `progressState` and `paneSeenAt` timestamp — no text summary yet (that
 * is a later phase). Durable-trust sibling of `session-subscriptions.ts` and
 * `session-notification-tick.ts`.
 *
 * The loop enumerates INTERACTIVE watched sessions only (from `listSupervised()`,
 * filtered to watched projects). It deliberately does NOT touch the in_progress
 * todo list from coordinator-live, and does NOT operate on headless leaves.
 *
 * The in-memory cache is fully rebuildable: a restart re-seeds. The first tick
 * after a restart yields `active` or `quiet`; it never produces a false `stalled`
 * or `wedged` on first sight.
 *
 * Z7: Interpreter pass — behind change-gate + throttle + single-in-flight, fires
 * invokeNode with the configured summary model to produce a structured paragraph +
 * status. A frozen (wedged) pane costs zero model calls.
 */

import { createHash } from 'crypto';
import { listSupervised } from './supervisor-store.js';
import { tmuxBaseName } from './tmux-naming.js';
import { mux } from './session-mux/index.js';
import { argvCapturePane } from './session-mux/tmux-argv.js';
import { getWebSocketHandler, hasWebSocketHandler } from './ws-handler-manager.js';
import type { WSMessage } from '../websocket/handler.js';
import { isActivelyWorking, detectPermissionPrompt } from '../agent/adapters/claude-code.js';
import { diagnoseClaimSuppression } from './coordinator-live.js';
import { systemStatus } from './system-status.js';
import { invokeNode } from '../agent/node-invoker.js';
import { NODE_PROFILE } from './leaf-executor.js';
import { listNodeProfileOverrides, getProjectEffort } from './orchestrator-config.js';
import type { EffortLevel } from '../agent/contracts.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProgressState = 'active' | 'quiet' | 'stalled' | 'wedged' | 'unknown';

export interface InterpreterStructured {
  paragraph: string;
  status: 'working' | 'idle' | 'stuck' | 'needs-input';
  question?: string;
  options?: Array<{ label: string; valueToSend: string }>;
  recommended?: number;
}

export type RefreshState = 'fresh' | 'stale-failing';

export interface SessionSummaryEntry {
  project: string;
  session: string;
  tmux: string;
  paneHash: string;
  paneSeenAt: number;
  quietWindows: number;
  progressState: ProgressState;
  updatedAt: number;
  // Z7 interpreter fields (optional, async side-channel)
  summaryText?: string;
  firstClause?: string;
  structured?: InterpreterStructured;
  summaryUpdatedAt?: number;
  summaryPaneHash?: string;
  lastSummaryAt?: number;
  summaryInFlight?: boolean;
  refreshState?: RefreshState;
}

// ---------------------------------------------------------------------------
// In-memory cache (rebuildable)
// ---------------------------------------------------------------------------

const cache = new Map<string, SessionSummaryEntry>();

export function getSessionSummary(project: string, session: string): SessionSummaryEntry | undefined {
  return cache.get(`${project}::${session}`);
}

export function listSessionSummaries(): SessionSummaryEntry[] {
  return [...cache.values()];
}

export function __resetSummaryState(): void {
  cache.clear();
  STALL_WINDOWS = DEFAULT_STALL_WINDOWS;
  WEDGE_WINDOWS = DEFAULT_WEDGE_WINDOWS;
  inFlightInterpreters.clear();
}

// ---------------------------------------------------------------------------
// Tunable thresholds
// ---------------------------------------------------------------------------

const DEFAULT_STALL_WINDOWS = 3; // ~90s at 30s tick
const DEFAULT_WEDGE_WINDOWS = 6; // ~3min at 30s tick

let STALL_WINDOWS = DEFAULT_STALL_WINDOWS;
let WEDGE_WINDOWS = DEFAULT_WEDGE_WINDOWS;

export function setSummaryThresholds(t: { stallWindows?: number; wedgeWindows?: number }): void {
  if (t.stallWindows != null) STALL_WINDOWS = t.stallWindows;
  if (t.wedgeWindows != null) WEDGE_WINDOWS = t.wedgeWindows;
}

export function getSummaryThresholds(): { stallWindows: number; wedgeWindows: number } {
  return { stallWindows: STALL_WINDOWS, wedgeWindows: WEDGE_WINDOWS };
}

// ---------------------------------------------------------------------------
// Interpreter consts
// ---------------------------------------------------------------------------

export const MIN_SUMMARY_INTERVAL_MS = 45_000;
export const INTERPRETER_TIMEOUT_MS = 60_000;

const INTERPRETER_SYSTEM = `You are a calm session interpreter. You are given the last ~100 lines of a terminal pane from one Claude Code worker session, and optionally a pending question it is asking. Describe the **state** of the session, NOT live action. Reply with ONE JSON object and nothing else: { "paragraph": string (3-5 sentences describing the STATE; if the pane is ambiguous say "unclear from the pane" rather than confabulate), "status": "working"|"idle"|"stuck"|"needs-input", "question"?: string (the verbatim or lightly paraphrased ask, only if it is waiting on a human), "options"?: [{"label": string, "valueToSend": string}], "recommended"?: integer (index into options) }. Never invent progress that is not visible in the pane.`;

// ---------------------------------------------------------------------------
// In-flight interpreter tracking
// ---------------------------------------------------------------------------

const inFlightInterpreters = new Set<Promise<void>>();

function trackInterpreter(p: Promise<void>): void {
  inFlightInterpreters.add(p);
  p.finally(() => inFlightInterpreters.delete(p));
}

export async function __drainInterpreters(): Promise<void> {
  while (inFlightInterpreters.size) await Promise.all([...inFlightInterpreters]);
}

// ---------------------------------------------------------------------------
// Injectable deps seam
// ---------------------------------------------------------------------------

export interface SummaryTickDeps {
  listSessions?: () => Array<{ project: string; session: string; launchProject?: string | null }>;
  watchedProjects?: () => Set<string>;
  capture?: (tmux: string) => Promise<string>;
  isActive?: (pane: string) => boolean;
  isWaiting?: (pane: string) => boolean;
  diagnoseSuppression?: (project: string) => Promise<{ suppressed: boolean; claimable: number; projectGate: string | null }>;
  systemStatus?: (project: string) => Promise<{ fleet: { inProgress: number; working: number }; orchestrator: { poolOccupancy: number } }>;
  broadcast?: (msg: unknown) => void;
  hasWs?: () => boolean;
  now?: () => number;
  interpret?: (args: {
    project: string;
    session: string;
    pane: string;
    pendingQuestion: string | null;
    model: string;
    effort: EffortLevel;
  }) => Promise<InterpreterStructured | null>;
  summaryModel?: (project: string) => { model: string; effort: EffortLevel };
}

// ---------------------------------------------------------------------------
// Local capture helper (mirrors coordinator-live.ts:354 — kept decoupled)
// ---------------------------------------------------------------------------

async function capturePaneLocal(tmuxName: string): Promise<string> {
  try {
    const proc = Bun.spawn(mux.cmd(argvCapturePane(tmuxName, 100)), {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const [stdout] = await Promise.all([
      proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(''),
      proc.exited,
    ]);
    return stdout;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Interpreter helpers
// ---------------------------------------------------------------------------

function firstClauseOf(p: string): string {
  const first = (p.split(/(?<=[.!?])\s/)[0] ?? p).trim();
  return first.length > 80 ? first.slice(0, 80).trimEnd() : first;
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function extractPendingQuestion(pane: string): string | null {
  const det = detectPermissionPrompt(pane);
  if (det.isPermission) return det.tool ? `Permission requested for ${det.tool}` : 'Permission requested';
  const lines = pane.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}

function summaryFields(e: SessionSummaryEntry): {
  summaryText?: string;
  firstClause?: string;
  structured?: InterpreterStructured;
  summaryUpdatedAt?: number;
  refreshState?: RefreshState;
} {
  return {
    summaryText: e.summaryText,
    firstClause: e.firstClause,
    structured: e.structured,
    summaryUpdatedAt: e.summaryUpdatedAt,
    refreshState: e.refreshState,
  };
}

function coerceStructured(raw: unknown): InterpreterStructured | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const paragraph = typeof o.paragraph === 'string' ? o.paragraph.trim() : '';
  const STATUSES = ['working', 'idle', 'stuck', 'needs-input'];
  if (!paragraph || typeof o.status !== 'string' || !STATUSES.includes(o.status)) return null;
  const out: InterpreterStructured = { paragraph, status: o.status as InterpreterStructured['status'] };
  if (typeof o.question === 'string' && o.question.trim()) out.question = o.question.trim();
  if (Array.isArray(o.options)) {
    const opts = o.options.filter((x): x is { label: string; valueToSend: string } =>
      !!x && typeof (x as Record<string, unknown>).label === 'string' && typeof (x as Record<string, unknown>).valueToSend === 'string',
    );
    if (opts.length) out.options = opts;
  }
  if (
    typeof o.recommended === 'number' &&
    Number.isInteger(o.recommended) &&
    out.options &&
    o.recommended >= 0 &&
    o.recommended < out.options.length
  ) {
    out.recommended = o.recommended;
  }
  return out;
}

async function interpretViaNode(args: {
  project: string;
  session: string;
  pane: string;
  pendingQuestion: string | null;
  model: string;
  effort: EffortLevel;
}): Promise<InterpreterStructured | null> {
  const userPrompt = args.pendingQuestion
    ? `${args.pane}\n\n[Pending question]: ${args.pendingQuestion}`
    : args.pane;
  const result = await invokeNode({
    prompt: userPrompt,
    model: args.model,
    effort: args.effort,
    allowedTools: '',
    appendSystemPrompt: INTERPRETER_SYSTEM,
    cwd: args.project,
    permissionMode: 'bypassPermissions',
    timeoutMs: INTERPRETER_TIMEOUT_MS,
  });
  if (!result.ok || !result.text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(stripFences(result.text));
  } catch {
    return null;
  }
  return coerceStructured(raw);
}

function shouldSummarize(
  prev: SessionSummaryEntry | undefined,
  hash: string,
  progressState: ProgressState,
  paneNonEmpty: boolean,
  wsPresentNow: boolean,
  nowMs: number,
): boolean {
  if (!wsPresentNow || !paneNonEmpty) return false;
  if (prev?.summaryInFlight) return false;
  if (hash === prev?.summaryPaneHash) return false; // change-gate: frozen pane = zero cost
  const throttleOk = nowMs - (prev?.lastSummaryAt ?? 0) >= MIN_SUMMARY_INTERVAL_MS;
  const becameIdle =
    (prev?.progressState === 'active' || prev?.progressState === 'quiet') &&
    (progressState === 'quiet' || progressState === 'stalled');
  return throttleOk || becameIdle;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export async function runSessionSummaryTick(deps: SummaryTickDeps = {}): Promise<{
  scanned: number;
  emitted: number;
  byState: Record<ProgressState, number>;
}> {
  const listSessions = deps.listSessions ?? listSupervised;
  const watchedProjects = deps.watchedProjects ?? (() => new Set<string>());
  const capture = deps.capture ?? capturePaneLocal;
  const isActive = deps.isActive ?? isActivelyWorking;
  const isWaiting = deps.isWaiting ?? ((pane: string) => detectPermissionPrompt(pane).isPermission);
  const diagnoseSuppression =
    deps.diagnoseSuppression ??
    (async (project: string) => {
      const r = await diagnoseClaimSuppression(project);
      return { suppressed: r.claimable === 0, claimable: r.claimable, projectGate: r.projectGate };
    });
  const getSystemStatus =
    deps.systemStatus ??
    (async (project: string) => {
      return systemStatus(project);
    });
  const broadcast =
    deps.broadcast ??
    ((msg: unknown) => {
      getWebSocketHandler()?.broadcast(msg as WSMessage);
    });
  const wsPresent = deps.hasWs ?? hasWebSocketHandler;
  const now = deps.now ?? Date.now;
  const resolveModel =
    deps.summaryModel ??
    ((project: string) => {
      const overrides = listNodeProfileOverrides(project) as Record<string, { model: string | null; effort: EffortLevel | null } | undefined>;
      const ov = overrides.summary;
      return {
        model: ov?.model ?? NODE_PROFILE.summary.model,
        effort: ov?.effort ?? getProjectEffort(project) ?? NODE_PROFILE.summary.effort,
      };
    });
  const interpret = deps.interpret ?? interpretViaNode;

  const watched = watchedProjects();
  const sessions = listSessions().filter((s) => watched.has(s.project));

  const byState: Record<ProgressState, number> = {
    active: 0,
    quiet: 0,
    stalled: 0,
    wedged: 0,
    unknown: 0,
  };
  let emitted = 0;

  // Track which (project, session) keys are still alive for pruning.
  const liveKeys = new Set<string>();

  for (const row of sessions) {
    const project = row.project;
    const session = row.session;
    const launchProject = (row as { launchProject?: string | null }).launchProject ?? null;
    const tmux = tmuxBaseName(launchProject ?? project, session);
    const key = `${project}::${session}`;
    liveKeys.add(key);

    const ts = now();
    const prev = cache.get(key);

    // WS-gap → unknown (no live corroboration).
    if (!wsPresent()) {
      const entry: SessionSummaryEntry = {
        project,
        session,
        tmux,
        paneHash: prev?.paneHash ?? '',
        paneSeenAt: prev?.paneSeenAt ?? ts,
        quietWindows: prev?.quietWindows ?? 0,
        progressState: 'unknown',
        updatedAt: ts,
        summaryText: prev?.summaryText,
        firstClause: prev?.firstClause,
        structured: prev?.structured,
        summaryUpdatedAt: prev?.summaryUpdatedAt,
        summaryPaneHash: prev?.summaryPaneHash,
        lastSummaryAt: prev?.lastSummaryAt,
        summaryInFlight: prev?.summaryInFlight,
        refreshState: prev?.refreshState,
      };
      cache.set(key, entry);
      byState.unknown++;
      broadcast({ type: 'session_summary_updated', project, session, progressState: 'unknown', paneSeenAt: entry.paneSeenAt, updatedAt: ts, ...summaryFields(entry) });
      emitted++;
      continue;
    }

    const pane = await capture(tmux);

    // Capture-fail → unknown; reset quietWindows so a failure streak can't masquerade
    // as a quiet streak (the failure is informative: we couldn't read the pane at all).
    if (pane === '') {
      const entry: SessionSummaryEntry = {
        project,
        session,
        tmux,
        paneHash: '',
        paneSeenAt: prev?.paneSeenAt ?? ts,
        quietWindows: 0,
        progressState: 'unknown',
        updatedAt: ts,
        summaryText: prev?.summaryText,
        firstClause: prev?.firstClause,
        structured: prev?.structured,
        summaryUpdatedAt: prev?.summaryUpdatedAt,
        summaryPaneHash: prev?.summaryPaneHash,
        lastSummaryAt: prev?.lastSummaryAt,
        summaryInFlight: prev?.summaryInFlight,
        refreshState: prev?.refreshState,
      };
      cache.set(key, entry);
      byState.unknown++;
      broadcast({ type: 'session_summary_updated', project, session, progressState: 'unknown', paneSeenAt: entry.paneSeenAt, updatedAt: ts, ...summaryFields(entry) });
      emitted++;
      continue;
    }

    // Hash and apply the change-gate.
    const hash = createHash('sha1').update(pane).digest('hex');
    const changed = !prev || prev.paneHash !== hash;

    let paneSeenAt: number;
    let quietWindows: number;

    if (changed) {
      paneSeenAt = ts;
      quietWindows = 0;
    } else {
      paneSeenAt = prev!.paneSeenAt;
      quietWindows = (prev?.quietWindows ?? 0) + 1;
    }

    // Grade the state.
    let progressState: ProgressState;

    if (changed) {
      progressState = 'active';
    } else if (quietWindows < STALL_WINDOWS) {
      progressState = 'quiet';
    } else {
      // At or above stall threshold.
      if (isWaiting(pane)) {
        // A worker at a human/permission prompt is not stalled — clamp to quiet.
        progressState = 'quiet';
      } else if (quietWindows < WEDGE_WINDOWS || isActive(pane)) {
        // isActive (spinner present) also keeps it at stalled, not wedged — still
        // technically working even if the pane hasn't changed text.
        progressState = 'stalled';
      } else {
        // quietWindows >= WEDGE_WINDOWS and not actively spinning. Corroborate.
        let progressStateCandidate: ProgressState = 'wedged';
        try {
          const [suppression, sysStatus] = await Promise.all([
            diagnoseSuppression(project),
            getSystemStatus(project),
          ]);
          // If either corroborator says something is legitimately in flight → downgrade.
          const laneBlocked = suppression.claimable === 0 && suppression.projectGate !== null;
          const buildingOrWaiting =
            sysStatus.fleet.working > 0 ||
            sysStatus.fleet.inProgress > 0 ||
            sysStatus.orchestrator.poolOccupancy > 0;
          if (laneBlocked || buildingOrWaiting) {
            progressStateCandidate = 'stalled';
          }
        } catch {
          // Corroborators failed — never fabricate wedged, default to stalled.
          progressStateCandidate = 'stalled';
        }
        progressState = progressStateCandidate;
      }
    }

    const entry: SessionSummaryEntry = {
      project,
      session,
      tmux,
      paneHash: hash,
      paneSeenAt,
      quietWindows,
      progressState,
      updatedAt: ts,
      // Carry forward all interpreter fields so change-gate + single-in-flight survive across ticks.
      summaryText: prev?.summaryText,
      firstClause: prev?.firstClause,
      structured: prev?.structured,
      summaryUpdatedAt: prev?.summaryUpdatedAt,
      summaryPaneHash: prev?.summaryPaneHash,
      lastSummaryAt: prev?.lastSummaryAt,
      summaryInFlight: prev?.summaryInFlight,
      refreshState: prev?.refreshState,
    };
    cache.set(key, entry);
    byState[progressState]++;
    broadcast({ type: 'session_summary_updated', project, session, progressState, paneSeenAt, updatedAt: ts, ...summaryFields(entry) });
    emitted++;

    // Interpreter pass — fire-and-forget behind strict gate.
    if (shouldSummarize(prev, hash, progressState, true, wsPresent(), ts)) {
      const { model, effort } = resolveModel(project);
      entry.summaryInFlight = true;
      entry.lastSummaryAt = ts; // stamp at LAUNCH so throttle counts attempts, not completions
      cache.set(key, entry);
      const p = (async () => {
        const pendingQuestion = isWaiting(pane) ? extractPendingQuestion(pane) : null;
        let structured: InterpreterStructured | null = null;
        try {
          structured = await interpret({ project, session, pane, pendingQuestion, model, effort });
        } catch {
          structured = null;
        }
        const cur = cache.get(key);
        if (!cur) return; // session pruned mid-call — drop
        cur.summaryInFlight = false;
        if (structured) {
          cur.structured = structured;
          cur.summaryText = structured.paragraph;
          cur.firstClause = firstClauseOf(structured.paragraph);
          cur.summaryPaneHash = hash; // close change-gate until pane moves
          cur.summaryUpdatedAt = now();
          cur.refreshState = 'fresh';
        } else {
          cur.refreshState = 'stale-failing'; // do NOT advance summaryPaneHash → retry later
        }
        cache.set(key, cur);
        // SECOND enriched emit — carries structured + refreshState
        broadcast({
          type: 'session_summary_updated',
          project,
          session,
          progressState: cur.progressState,
          paneSeenAt: cur.paneSeenAt,
          updatedAt: cur.updatedAt,
          ...summaryFields(cur),
        });
      })();
      trackInterpreter(p);
    }
  }

  // Prune cache entries whose session is no longer supervised/watched.
  for (const key of cache.keys()) {
    if (!liveKeys.has(key)) {
      cache.delete(key);
    }
  }

  return { scanned: sessions.length, emitted, byState };
}
