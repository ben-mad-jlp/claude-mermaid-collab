/**
 * Session-summary read-model — Zen retirement Phase 3.
 *
 * The tmux pane-scrape + LLM-interpret pipeline (the daemon guessing a session's
 * state from a captured terminal pane) has been removed along with the tmux/terminal
 * stack itself. What remains is the SELF-REPORT path: a live session calls the
 * `update_zen_summary` MCP tool, which folds a structured `{paragraph, status, ...}`
 * payload into this module's in-memory cache via `pushSessionSummary` and broadcasts
 * a `session_summary_updated` WS message. `getSessionSummary` / `listSessionSummaries`
 * / `snapshotSummaryMessages` remain the canonical read-model for GET
 * /api/supervisor/summaries and the WS reconnect hydration snapshot.
 *
 * The in-memory cache is fully rebuildable: a restart re-seeds from the durable
 * `PERSIST_PATH` snapshot on first use.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { tmuxBaseName } from './tmux-naming.js';
import { hasWebSocketHandler } from './ws-handler-manager.js';

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
  /** AI-proposed canned replies for an OPEN (no on-screen menu) end-of-turn question —
   *  short, send-ready answers the user would plausibly give (e.g. "Yes, push" / "Not yet"). */
  suggestedAnswers?: string[];
  /** AI-proposed NEXT STEP for an idle session with NO pending question — a single short
   *  directive the human could send to keep things moving (e.g. "Run the tests" / "Push it").
   *  Distinct from suggestedAnswers (which answer OUR question); this proposes the next action. */
  aiOption?: string;
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
  // Self-report fields (optional).
  summaryText?: string;
  firstClause?: string;
  structured?: InterpreterStructured;
  summaryUpdatedAt?: number;
  summaryPaneHash?: string;
  lastSummaryAt?: number;
  summaryInFlight?: boolean;
  refreshState?: RefreshState;
  /** Consecutive interpret failures — vestigial field, retained on the type only so
   *  older persisted cache rows still deserialize cleanly. Always 0 going forward. */
  failureStreak?: number;
  /** Epoch ms before which we must NOT re-interpret this session — vestigial, unused. */
  nextRetryAt?: number;
  /** Epoch ms of the most recent SELF-push (session called update_zen_summary →
   *  pushSessionSummary). */
  lastSelfPushAt?: number;
}

// ---------------------------------------------------------------------------
// In-memory cache (rebuildable)
// ---------------------------------------------------------------------------

const cache = new Map<string, SessionSummaryEntry>();

// --- Durable cache (survives restarts/deploys) ------------------------------------
// The in-memory cache is wiped on every server restart, so a deploy blanked every Zen
// card ("No summary yet") until a session self-reported again. Persist the cache to
// disk and reload it on first use so the last self-reported paragraph survives a
// restart. `transient` mutations (summaryInFlight) are dropped on save.
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

/**
 * SELF-SUMMARY push: a LIVE session writes its OWN Zen summary — it knows its real
 * state, so no external pane-scrape + LLM interpret is needed. Validates the
 * structured payload, folds it into the cache as a FRESH summary, and broadcasts via
 * the card pipeline. `summaryPaneHash` is set to the current `paneHash` so a pushed
 * question reads as answerable (paneStillMatches). Returns ok:false if the payload
 * doesn't coerce (missing paragraph/status).
 */
export function pushSessionSummary(
  project: string,
  session: string,
  raw: unknown,
  broadcast?: (msg: unknown) => void,
): { ok: boolean; reason?: string } {
  const structured = coerceStructured(raw);
  if (!structured) return { ok: false, reason: 'invalid-structured (need paragraph + a valid status)' };
  loadCacheOnce();
  const key = `${project}::${session}`;
  const now = Date.now();
  const prev = cache.get(key);
  const paneHash = prev?.paneHash ?? '';
  const progressState: ProgressState =
    prev?.progressState ??
    (structured.status === 'working' ? 'active' : structured.status === 'idle' ? 'quiet' : 'active');
  const entry: SessionSummaryEntry = {
    project,
    session,
    tmux: prev?.tmux ?? tmuxBaseName(project, session),
    paneHash,
    paneSeenAt: now,
    quietWindows: prev?.quietWindows ?? 0,
    progressState,
    updatedAt: now,
    summaryText: structured.paragraph,
    firstClause: firstClauseOf(structured.paragraph),
    structured,
    summaryUpdatedAt: now,
    summaryPaneHash: paneHash,
    lastSummaryAt: now,
    summaryInFlight: false,
    refreshState: 'fresh',
    failureStreak: 0,
    nextRetryAt: undefined,
    lastSelfPushAt: now,
  };
  cache.set(key, entry);
  scheduleSave();
  broadcast?.({
    type: 'session_summary_updated',
    project,
    session,
    progressState,
    paneSeenAt: now,
    updatedAt: now,
    ...summaryFields(entry),
  });
  return { ok: true };
}

export function listSessionSummaries(): SessionSummaryEntry[] {
  loadCacheOnce();
  return [...cache.values()];
}

/** Re-hydration snapshot: the current cache as ready-to-send `session_summary_updated`
 *  messages, byte-identical to the live broadcast. Summaries are NOT persisted
 *  client-side — so a freshly (re)connected client would otherwise show "No summary
 *  yet" for every session. Sent once to each new WS client on connect so it starts
 *  from the server's last-known state instead of empty. */
export function snapshotSummaryMessages(): Array<Record<string, unknown>> {
  loadCacheOnce(); // a client may connect before the first push — hydrate from disk
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
  SELF_SUMMARY_NUDGE_ENABLED = envSelfNudgeEnabled();
  SELF_SUMMARY_NUDGE_INTERVAL_MS = envSelfNudgeIntervalMs();
  // Tests own the cache deterministically — never load from or write to disk.
  persistEnabled = false;
  cacheLoaded = true;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; }
}

// ---------------------------------------------------------------------------
// Self-summary nudge knobs (cadence + enable) — surfaced via runtime_config. The
// pass that used to read these (a periodic nudge to QUIET sessions to self-report)
// was removed along with the pane-scrape/interpret machinery; these accessors are
// kept as a plain settings knob so runtime_config's reported shape is unchanged.
// ---------------------------------------------------------------------------

const DEFAULT_SELF_SUMMARY_NUDGE_INTERVAL_MS = 5 * 60_000; // 5min
function envSelfNudgeEnabled(): boolean {
  const v = process.env.MERMAID_SELF_SUMMARY_NUDGE;
  return v == null ? true : (v === '1' || v === 'true'); // default ON
}
function envSelfNudgeIntervalMs(): number {
  const n = Number(process.env.MERMAID_SELF_SUMMARY_NUDGE_INTERVAL_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SELF_SUMMARY_NUDGE_INTERVAL_MS;
}

let SELF_SUMMARY_NUDGE_ENABLED = envSelfNudgeEnabled();
let SELF_SUMMARY_NUDGE_INTERVAL_MS = envSelfNudgeIntervalMs();

export function getSelfSummaryNudgeConfig(): { enabled: boolean; intervalMs: number } {
  return { enabled: SELF_SUMMARY_NUDGE_ENABLED, intervalMs: SELF_SUMMARY_NUDGE_INTERVAL_MS };
}
export function setSelfSummaryNudgeConfig(c: { enabled?: boolean; intervalMs?: number }): void {
  if (c.enabled != null) SELF_SUMMARY_NUDGE_ENABLED = c.enabled;
  if (c.intervalMs != null && c.intervalMs > 0) SELF_SUMMARY_NUDGE_INTERVAL_MS = c.intervalMs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstClauseOf(p: string): string {
  const first = (p.split(/(?<=[.!?])\s/)[0] ?? p).trim();
  return first.length > 80 ? first.slice(0, 80).trimEnd() : first;
}

function summaryFields(e: SessionSummaryEntry): {
  summaryText?: string;
  firstClause?: string;
  structured?: InterpreterStructured;
  summaryUpdatedAt?: number;
  refreshState?: RefreshState;
  paneHash?: string;
  summaryPaneHash?: string;
} {
  return {
    summaryText: e.summaryText,
    firstClause: e.firstClause,
    structured: e.structured,
    summaryUpdatedAt: e.summaryUpdatedAt,
    refreshState: e.refreshState,
    // Pane hashes let the UI gate answering on ground truth: `paneHash` is the
    // LIVE pane; `summaryPaneHash` is the pane the carried `structured`
    // question/options were captured from. Equal ⇒ the question is still on
    // screen and safe to answer even when refreshState is stale-failing.
    paneHash: e.paneHash,
    summaryPaneHash: e.summaryPaneHash,
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
  // AI canned replies for an open question — short non-empty strings, capped at 4.
  if (Array.isArray(o.suggestedAnswers)) {
    const ans = o.suggestedAnswers
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim())
      .slice(0, 4);
    if (ans.length) out.suggestedAnswers = ans;
  }
  // AI-proposed next step — a single short directive for an idle, question-free session.
  // Mutually exclusive with any pending question: drop it if we surfaced a question/options/replies.
  if (
    typeof o.aiOption === 'string' &&
    o.aiOption.trim().length > 0 &&
    !out.question &&
    !out.options &&
    !out.suggestedAnswers
  ) {
    out.aiOption = o.aiOption.trim();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Force-proof out-of-band refresh — vestigial stub
// ---------------------------------------------------------------------------

/**
 * Historically re-summarized a single session immediately by re-reading its tmux
 * pane and re-running the interpreter. The pane-scrape/interpret pipeline and the
 * tmux/terminal stack it depended on have both been removed (Zen retirement Phase
 * 3/4) — there is no pane left to read, so this now always reports
 * `capture-failed`. Kept as a stable stub (same signature/shape) purely so the
 * `POST /api/supervisor/refresh-summary` route and the UI's "force refresh" button
 * keep their existing contract instead of 404ing or throwing. The only real path to
 * a fresh summary now is a session self-reporting via `update_zen_summary`
 * (`pushSessionSummary`).
 */
export async function refreshSummaryNow(
  _project: string,
  _session: string,
  deps: { hasWs?: () => boolean } = {},
): Promise<{ ok: boolean; reason?: 'no-ws' | 'capture-failed' | 'in-flight' | 'no-session'; structured?: InterpreterStructured | null }> {
  const wsPresent = deps.hasWs ?? hasWebSocketHandler;
  if (!wsPresent()) return { ok: false, reason: 'no-ws' };
  return { ok: false, reason: 'capture-failed' };
}
