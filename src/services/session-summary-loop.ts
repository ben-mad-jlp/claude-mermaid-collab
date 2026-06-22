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
 *
 * Z9 mobile-parity invariant: the in-memory cache (`listSessionSummaries()` /
 * `getSessionSummary()`) is the canonical HTTP read-model. Every field the zen UI
 * renders — `progressState`, `firstClause`, `summaryText`, `structured`
 * (incl. `question`/`options`/`recommended`), `refreshState`, `paneSeenAt`,
 * `updatedAt` — is stored on `SessionSummaryEntry` and populated before or by
 * `runInterpretAndEmit`. The WS `session_summary_updated` broadcast is a pure
 * superset of this entry (assembled via `summaryFields(cur)`). No field is computed
 * only inside a broadcast and withheld from the cache. The Phase-2 mobile thin-client
 * is therefore a straight HTTP+WS port with no hover/desktop-only data path.
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { listSupervised } from './supervisor-store.js';
import { getStatuses } from './session-status-store.js';
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
  /** A fuller summary shown on "more" — richer than the glance, not a restatement. */
  detail?: string;
  status: 'working' | 'idle' | 'stuck' | 'needs-input';
  question?: string;
  options?: Array<{ label: string; valueToSend: string }>;
  recommended?: number;
  multiSelect?: boolean;
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

// --- Durable cache (survives restarts/deploys) ------------------------------------
// The in-memory cache is wiped on every server restart, so a deploy blanked every Zen
// card ("No summary yet") until the loop re-summarized. Persist the cache to disk and
// reload it on first use so the interpreter paragraphs survive a restart. The loop still
// re-derives the LIVE progressState on its next tick, so a stale wedged/active never
// sticks. `transient` mutations (summaryInFlight) are dropped on save.
const PERSIST_PATH = join(process.env.MERMAID_DATA_DIR ?? join(homedir(), '.mermaid-collab'), 'session-summaries.json');
let persistEnabled = true; // disabled by __resetSummaryState so tests never touch disk
let cacheLoaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function loadCacheOnce(): void {
  if (cacheLoaded) return;
  cacheLoaded = true;
  if (!persistEnabled) return;
  try {
    const arr = JSON.parse(readFileSync(PERSIST_PATH, 'utf8')) as SessionSummaryEntry[];
    for (const e of arr) {
      if (e?.project && e?.session) cache.set(`${e.project}::${e.session}`, { ...e, summaryInFlight: false });
    }
  } catch {
    /* no file yet / unreadable → start empty */
  }
}

function scheduleSave(): void {
  if (!persistEnabled || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    try {
      mkdirSync(dirname(PERSIST_PATH), { recursive: true });
      writeFileSync(PERSIST_PATH, JSON.stringify([...cache.values()]));
    } catch {
      /* best-effort persistence — never break the loop */
    }
  }, 1000);
}

export function getSessionSummary(project: string, session: string): SessionSummaryEntry | undefined {
  loadCacheOnce();
  return cache.get(`${project}::${session}`);
}

export function listSessionSummaries(): SessionSummaryEntry[] {
  loadCacheOnce();
  return [...cache.values()];
}

/** Re-hydration snapshot: the current cache as ready-to-send `session_summary_updated`
 *  messages, byte-identical to the live broadcast (incl. the interpreter paragraph). The
 *  loop change-gates broadcasts (a frozen pane never re-emits), and summaries are NOT
 *  persisted client-side — so a freshly (re)connected client would otherwise show "No
 *  summary yet" for every idle session. Sent once to each new WS client on connect so it
 *  starts from the server's last-known state instead of empty. */
export function snapshotSummaryMessages(): Array<Record<string, unknown>> {
  loadCacheOnce(); // a client may connect before the first tick — hydrate from disk
  return listSessionSummaries().map((e) => ({
    type: 'session_summary_updated',
    project: e.project,
    session: e.session,
    progressState: e.progressState,
    paneSeenAt: e.paneSeenAt,
    updatedAt: e.updatedAt,
    ...summaryFields(e),
  }));
}

export function __resetSummaryState(): void {
  cache.clear();
  STALL_WINDOWS = DEFAULT_STALL_WINDOWS;
  WEDGE_WINDOWS = DEFAULT_WEDGE_WINDOWS;
  inFlightInterpreters.clear();
  // Tests own the cache deterministically — never load from or write to disk.
  persistEnabled = false;
  cacheLoaded = true;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; }
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

const INTERPRETER_SYSTEM = `You are a calm, friendly narrator keeping a developer in the loop on the coding work going on in one of their automated sessions. Speak in the FIRST PERSON PLURAL — "we're …", "we just …", "we're stuck on …" — as the teammate doing the work, warm and plain. NEVER say "the session", "a worker", "an actor", "the agent", or "the user" — just say what WE are doing. You're given the last ~100 lines of a terminal pane (and optionally a pending question). Describe the STATE, not live keystrokes. Reply with ONE JSON object and nothing else: { "paragraph": string (the GLANCE — a short, friendly summary that LEADS WITH THE OVERALL GOAL (what we're ultimately trying to accomplish) and then says what we're doing right now to get there. Aim for 2-3 sentences; use a few more if that's what it takes to make the goal clear — clarity beats brevity here. If you genuinely can't tell from the pane, say "Not sure yet — nothing clear on screen."), "detail": string (a FULLER summary in the same friendly "we" voice — 3-6 sentences of deeper context the glance leaves out: how we got here, what we've done, what's next or blocking. ADD information beyond the glance, don't restate it), "status": "working"|"idle"|"stuck"|"needs-input", "question"?: string (the ask in a natural voice, only if we're waiting on a human), "options"?: [{"label": string, "valueToSend": string}] (list them in the SAME top-to-bottom order they appear on screen), "recommended"?: integer (index into options), "multiSelect"?: boolean (true ONLY when the on-screen question is a multi-select / checkbox prompt where several options can be toggled before submitting — e.g. rows shown with [ ] / checkboxes, or a "select all that apply" style ask; omit or false for a normal pick-one question) }. Never invent progress that isn't visible in the pane.`;

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
  /** Registered/known collab sessions for a project (the user-watched `design`/`planner`
   *  sessions), unioned with listSessions() so the loop summarizes the sessions Zen
   *  actually shows — not only daemon-supervised pool slots. Default: session-status rows. */
  listKnownSessions?: (project: string) => Array<{ project: string; session: string }>;
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
  if (typeof o.detail === 'string' && o.detail.trim()) out.detail = o.detail.trim();
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
  // Multi-select toggle question (Claude Code AskUserQuestion multiSelect). Only
  // meaningful alongside options — the UI accumulates picks then submits via the
  // number-toggle keystroke path. Ignored without options.
  if (o.multiSelect === true && out.options && out.options.length) out.multiSelect = true;
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
// Shared interpreter-finish helper (used by both tick and refreshSummaryNow)
// ---------------------------------------------------------------------------

/**
 * Run the interpreter for one session and fold the result into the live cache entry.
 * Assumes the caller has already stamped summaryInFlight=true + lastSummaryAt on the
 * entry under `key`. Re-reads cache by key after the await (entry may be pruned mid-call).
 * On success advances summaryPaneHash to `hash` (closes the change-gate). On failure
 * leaves summaryPaneHash untouched so a later tick retries. Always clears summaryInFlight
 * and emits one enriched session_summary_updated.
 */
async function runInterpretAndEmit(args: {
  key: string;
  project: string;
  session: string;
  pane: string;
  hash: string;
  pendingQuestion: string | null;
  model: string;
  effort: EffortLevel;
  interpret: NonNullable<SummaryTickDeps['interpret']>;
  broadcast: (msg: unknown) => void;
  now: () => number;
}): Promise<InterpreterStructured | null> {
  let structured: InterpreterStructured | null = null;
  try {
    structured = await args.interpret({
      project: args.project, session: args.session, pane: args.pane,
      pendingQuestion: args.pendingQuestion, model: args.model, effort: args.effort,
    });
  } catch {
    structured = null;
  }
  const cur = cache.get(args.key);
  if (!cur) return structured; // session pruned mid-call — drop
  cur.summaryInFlight = false;
  if (structured) {
    cur.structured = structured;
    cur.summaryText = structured.paragraph;
    cur.firstClause = firstClauseOf(structured.paragraph);
    cur.summaryPaneHash = args.hash;
    cur.summaryUpdatedAt = args.now();
    cur.refreshState = 'fresh';
  } else {
    cur.refreshState = 'stale-failing';
  }
  cache.set(args.key, cur);
  scheduleSave(); // persist the new interpreter paragraph so it survives a restart
  args.broadcast({
    type: 'session_summary_updated',
    project: args.project, session: args.session,
    progressState: cur.progressState, paneSeenAt: cur.paneSeenAt, updatedAt: cur.updatedAt,
    ...summaryFields(cur),
  });
  return structured;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export async function runSessionSummaryTick(deps: SummaryTickDeps = {}): Promise<{
  scanned: number;
  emitted: number;
  byState: Record<ProgressState, number>;
}> {
  loadCacheOnce(); // seed from disk on the first tick after a restart
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

  const listKnownSessions =
    deps.listKnownSessions ??
    ((project: string) => {
      try {
        return getStatuses(project).map((r) => ({ project: r.project, session: r.session }));
      } catch {
        return []; // no status DB (tests / fresh project) → contribute nothing
      }
    });

  const watched = watchedProjects();
  // Union daemon-supervised pool slots with the registered collab sessions (the
  // user-watched design/planner sessions that Zen renders). Both have live tmux panes;
  // summarizing only listSupervised() left every watched session showing "No summary
  // yet". Dedup by project::session — the supervised row wins (it carries launchProject).
  const sessionMap = new Map<string, { project: string; session: string; launchProject?: string | null }>();
  for (const p of watched) {
    for (const k of listKnownSessions(p)) {
      if (watched.has(k.project)) sessionMap.set(`${k.project}::${k.session}`, k);
    }
  }
  for (const s of listSessions()) {
    if (watched.has(s.project)) sessionMap.set(`${s.project}::${s.session}`, s);
  }
  const sessions = [...sessionMap.values()];

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
      const pendingQuestion = isWaiting(pane) ? extractPendingQuestion(pane) : null;
      const p = (async () => {
        await runInterpretAndEmit({ key, project, session, pane, hash, pendingQuestion, model, effort, interpret, broadcast, now });
      })();
      trackInterpreter(p);
    }
  }

  // Prune cache entries whose session is no longer supervised/watched.
  for (const key of cache.keys()) {
    if (!liveKeys.has(key)) {
      cache.delete(key);
      scheduleSave();
    }
  }

  scheduleSave(); // persist structural updates (paneSeenAt/progressState) once per tick
  return { scanned: sessions.length, emitted, byState };
}

// ---------------------------------------------------------------------------
// Force-proof out-of-band refresh
// ---------------------------------------------------------------------------

/**
 * Re-summarize a single session immediately, bypassing the change-gate and throttle
 * that `shouldSummarize` enforces. Intended for explicit user actions ("force refresh")
 * and the optimistic-clear reconcile path. Awaited (not fire-and-forget) so callers
 * receive a definite result. Does NOT register in `inFlightInterpreters` — the await
 * is the caller's synchronization.
 *
 * Guards retained: WS presence, capture success, single-in-flight (never duplicates
 * an in-flight model call).
 */
export async function refreshSummaryNow(
  project: string,
  session: string,
  deps: SummaryTickDeps = {},
): Promise<{ ok: boolean; reason?: 'no-ws' | 'capture-failed' | 'in-flight' | 'no-session'; structured?: InterpreterStructured | null }> {
  const listSessions = deps.listSessions ?? listSupervised;
  const watchedProjects = deps.watchedProjects ?? (() => new Set<string>());
  const capture = deps.capture ?? capturePaneLocal;
  const isWaiting = deps.isWaiting ?? ((pane: string) => detectPermissionPrompt(pane).isPermission);
  const broadcast =
    deps.broadcast ??
    ((msg: unknown) => { getWebSocketHandler()?.broadcast(msg as WSMessage); });
  const wsPresent = deps.hasWs ?? hasWebSocketHandler;
  const now = deps.now ?? Date.now;
  const resolveModel =
    deps.summaryModel ??
    ((proj: string) => {
      const overrides = listNodeProfileOverrides(proj) as Record<string, { model: string | null; effort: EffortLevel | null } | undefined>;
      const ov = overrides.summary;
      return {
        model: ov?.model ?? NODE_PROFILE.summary.model,
        effort: ov?.effort ?? getProjectEffort(proj) ?? NODE_PROFILE.summary.effort,
      };
    });
  const interpret = deps.interpret ?? interpretViaNode;

  if (!wsPresent()) return { ok: false, reason: 'no-ws' };

  const key = `${project}::${session}`;
  const prev = cache.get(key);

  // Resolve tmux name: prefer the cached entry; else look up the supervised row so a
  // cold cache (no prior tick) can still be force-refreshed.
  let tmux = prev?.tmux;
  if (!tmux) {
    const row = listSessions().find(
      (r) => r.project === project && r.session === session && watchedProjects().has(r.project),
    );
    if (!row) return { ok: false, reason: 'no-session' };
    const launchProject = (row as { launchProject?: string | null }).launchProject ?? null;
    tmux = tmuxBaseName(launchProject ?? project, session);
  }

  // Single-in-flight guard: never launch a duplicate model call.
  if (prev?.summaryInFlight) return { ok: false, reason: 'in-flight' };

  const pane = await capture(tmux);
  if (pane === '') return { ok: false, reason: 'capture-failed' };

  const hash = createHash('sha1').update(pane).digest('hex');
  const ts = now();

  // Ensure a live cache entry exists to fold the result into (cold-cache case).
  const entry: SessionSummaryEntry = prev ?? {
    project, session, tmux, paneHash: hash, paneSeenAt: ts, quietWindows: 0,
    progressState: 'unknown', updatedAt: ts,
  };
  entry.summaryInFlight = true;
  entry.lastSummaryAt = ts;
  cache.set(key, entry);

  const pendingQuestion = isWaiting(pane) ? extractPendingQuestion(pane) : null;
  const { model, effort } = resolveModel(project);

  // FORCE-PROOF: awaited (not fire-and-forget), deliberately skips shouldSummarize
  // (no change-gate, no throttle).
  const structured = await runInterpretAndEmit({
    key, project, session, pane, hash, pendingQuestion, model, effort,
    interpret, broadcast, now,
  });
  return { ok: structured != null, structured };
}
