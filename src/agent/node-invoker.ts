/**
 * Headless node primitive (PAW P1).
 *
 * A **node** = ONE bounded, non-interactive `claude -p` invocation: spawn, run to
 * completion, capture stdout, return a structured result. No tmux, no TUI scrape,
 * no liveness polling — that distinguishes it from `ClaudeCodeAgent` (interactive
 * tmux session) and the in-process own-harness loop. The node is the atomic
 * build-block a higher-level executor will chain (loop/retry live in LATER leaves;
 * this is single-shot only).
 *
 * Subscription-only: this primitive NEVER constructs an API-key path and NEVER
 * passes `--bare` (which forces ANTHROPIC_API_KEY-only auth). A fail-closed
 * pre-flight guard (`assertSubscriptionAuth`) asserts the active credential is the
 * claude.ai subscription before any node runs — matches registry.ts's fail-closed
 * conformance pattern.
 */

import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { resolveGrokModel } from './grok-model.js';
import { registerLeafProc, unregisterLeafProc, groupKillPid } from '../services/leaf-subprocess-registry.js';
import { parseNodeCommands } from '../services/node-commands.js';

export type AuthMode = 'subscription' | 'api' | 'unknown' | 'grok';

/**
 * E3 — WORKTREE WRITE ISOLATION. A node CLI (claude -p / grok) runs in a lane/epic
 * worktree (`spec.cwd`), but inheriting the server's raw `process.env` lets its `git`
 * invocations ESCAPE that worktree two ways: (1) an inherited `GIT_DIR`/`GIT_WORK_TREE`
 * pins git to a different repo regardless of cwd; (2) git repo-discovery walks UP the
 * tree, and because a linked worktree shares the main repo's `.git` (gitlink/common-dir),
 * discovery can resolve operations against the MAIN checkout — so a commit/checkout the
 * node runs corrupts the live repo and leaves the branch's work incomplete (bug 7cf3c08f,
 * observed live: src/services/*.ts + tests appeared dirty in the main checkout after a run).
 *
 * Fix: build the child env from process.env but (a) DELETE GIT_DIR + GIT_WORK_TREE so they
 * can't override the worktree, and (b) set GIT_CEILING_DIRECTORIES to the worktree's PARENT
 * so git discovery cannot climb past the worktree. Exported + pure for unit testing.
 */
export function worktreeSpawnEnv(cwd: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  // Ceiling at the worktree's parent: discovery may find the worktree's own `.git` file
  // but must not climb above it to the main checkout. (No-effect for a non-worktree cwd.)
  env.GIT_CEILING_DIRECTORIES = dirname(cwd);
  return env;
}

/**
 * Append a node's raw stream-json transcript to the per-leaf file, preceded by a
 * synthetic boundary marker so the reader can split the file back into nodes.
 * Best-effort: a transcript-write failure must NEVER fail the node.
 */
export function captureTranscript(path: string, label: string, stdout: string, meta: { exitCode: number; durationMs: number }): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const boundary = JSON.stringify({ type: 'node-boundary', label, at: new Date().toISOString(), ...meta });
    appendFileSync(path, boundary + '\n' + (stdout.endsWith('\n') ? stdout : stdout + '\n'));
  } catch { /* transcript is observability — never block the run on it */ }
}

/** One bounded headless `claude -p` invocation. */
export interface NodeSpec {
  /** The user prompt (positional). Required. */
  prompt: string;
  /** Model alias (`opus`/`sonnet`/`fable`) or full id (--model). Optional → CLI default. */
  model?: string;
  /** Comma/space tool allowlist (--allowedTools). Optional → inherit defaults. '' = none. */
  allowedTools?: string;
  /** When true, pass `--strict-mcp-config` so the CLI loads ONLY MCP servers from
   *  --mcp-config flags (here: none) — i.e. it IGNORES the cwd's .mcp.json. Build nodes
   *  use only built-in tools, so loading the project's MCP server (~200 tool schemas the
   *  node can never call, plus an HTTP connect per spawn) is dead context weight. Set for
   *  any node whose allowlist has no mcp__ tool. Optional → CLI default (loads .mcp.json). */
  strictMcpConfig?: boolean;
  /** Appended system prompt (--append-system-prompt). Optional. */
  appendSystemPrompt?: string;
  /** Working dir set on the spawned process (NOT a CLI flag — no --cwd exists). Required. */
  cwd: string;
  /** Wall-clock cap (ms). On expiry the process is killed → ok=false, rateLimited=false. */
  timeoutMs?: number;
  /** Ledger correlation (optional but recommended). */
  leafId?: string;
  epicId?: string;
  /** Tracking project — recorded in the leaf-subprocess registry (E1) so a per-project
   *  brake (level→off) can kill only this project's live node subprocesses. Optional. */
  project?: string;
  /** If set, the raw stream-json transcript for this node is appended to this file
   *  (best-effort; never fails the node). The leaf-executor points all of a leaf's
   *  nodes at one per-leaf file so the run reads as a single transcript. */
  transcriptPath?: string;
  /** Label for the node-boundary marker written into the transcript (e.g. 'plan'). */
  transcriptLabel?: string;
  /** Permission mode override. Default 'bypassPermissions' (no human to approve, headless). */
  permissionMode?: 'bypassPermissions' | 'acceptEdits' | 'default' | 'plan' | 'auto' | 'dontAsk';
  /** Reasoning effort (--effort low|medium|high|xhigh|max). Optional → CLI/model
   *  default. The daemon sets this per node kind (judgment nodes run higher). */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Grok-only: `--max-turns` cap (set by leaf-executor per node kind in PR-2). */
  maxTurns?: number;
}

export interface NodeUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Cached-prompt input tokens (the system prompt etc. served from cache) — the
   *  bulk of a summary interpret's input lands here, NOT in inputTokens. */
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number; // from result.total_cost_usd if present
  numTurns?: number; // from result.num_turns — the de-facto "steps"
}

export interface NodeResult {
  /** exitCode===0 && !rateLimited && parsed result is_error!==true && authMode==='subscription'. */
  ok: boolean;
  exitCode: number;
  /** Raw stdout (the JSON result string, or text). */
  stdout: string;
  durationMs: number;
  usage?: NodeUsage;
  /** Transient pause signal: a true rate-limit/cap OR a network outage (see
   *  `unreachable`). Reported as `rateLimited` so the executor's pause path handles
   *  both uniformly (pause + backoff, no attempt burned). */
  rateLimited: boolean;
  /** True when the pause was caused by a CONNECTIVITY failure (internet/API down,
   *  CONN_ERR_RE) rather than a rate cap — for logging/labels; the handling is the same. */
  unreachable?: boolean;
  /** Epoch ms the rate cap is known to reset, IF the CLI surfaces one.
   *  v1: always `undefined` (stub) — see `parseCapReset` + §5 of the P3 blueprint.
   *  The daemon falls back to pure exponential backoff when this is absent. */
  capReset?: number;
  /** The auth mode in effect for this node (from the memoized pre-flight guard). */
  authMode: AuthMode;
  /** Best-effort parsed final assistant text from the json result (result.result). */
  text?: string;
  /** Set when --output-format json failed to parse, or on timeout/auth halt. */
  parseError?: string;
  /** Set by runNode when the node process died before doing any work (a config/infra fault). */
  startFailure?: { provider: string; model: string; detail: string };
  /** Recorded by the executor from the node's own stream-json transcript — NEVER self-reported
   *  by the node. Extracted from tool_use (Bash) and tool_result blocks at the spawn boundary. */
  commands?: Array<{ cmd: string; cwd: string; exitCode: number | null }>;
}

const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * Rate-limit detection signal — HEURISTIC, runtime-unconfirmed.
 *
 * RUNTIME-CONFIRM TODO: `claude --help` documents no guaranteed exit code or
 * stderr string for a 429 / usage-limit. This regex is matched against the
 * combined stdout+stderr (and the json result subtype). It is best-effort until
 * a REAL 429 is observed in the test plan.
 *   // CONFIRM: observed exit code = ?  ,  observed stderr = ?  ,  json subtype = ?
 */
export const RATE_LIMIT_RE = /rate.?limit|429|too many requests|usage limit|overloaded|quota/i;

/** Connection/network-outage signatures. A node whose request never reached the API
 *  (DNS/TCP/TLS failure) is NOT a leaf failure — the work was never tested. We treat
 *  it like a rate-limit: PAUSE + backoff, no attempt burned (the internet-down case). */
export const CONN_ERR_RE = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|getaddrinfo|fetch failed|network error|connection error|connection (?:closed|reset|refused)|unable to connect|socket hang ?up|tls|certificate/i;

/** After SIGTERM, wait this long for a graceful exit before escalating to SIGKILL.
 *  A process stuck in a network syscall ignores SIGTERM, so the hard kill is required. */
const KILL_GRACE_MS = 3_000;
/** Hard cap on collecting stdout/stderr/exit AFTER the run resolves-or-times-out.
 *  Guarantees the invocation always returns even if a pipe never EOFs (a grandchild
 *  holding it open) — this is what kept the daemon's single-flight tick from wedging. */
const DRAIN_CAP_MS = 5_000;

/**
 * The Claude subscription session-limit message the `-p` stream-json carries in its
 * `result` field on a 429, e.g.:
 *   "You've hit your session limit · resets 8:50pm (America/Chicago)"
 * Captures HH, MM, am/pm and the IANA timezone. (Confirmed from a real 429, 2026-06-18.)
 */
export const CAP_RESET_RE = /resets\s+(\d{1,2}):(\d{2})\s*(am|pm)\s*\(\s*([A-Za-z][A-Za-z0-9_+\-/]*)\s*\)/i;

/** UTC offset (ms) of IANA `tz` at instant `at` (tz-wall-clock minus the UTC instant). */
function tzOffsetMs(tz: string, at: number): number | undefined {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p: Record<string, number> = {};
    for (const part of dtf.formatToParts(new Date(at))) {
      if (part.type !== 'literal') p[part.type] = Number(part.value);
    }
    if ([p.year, p.month, p.day, p.hour, p.minute, p.second].some((n) => Number.isNaN(n))) return undefined;
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at;
  } catch { return undefined; } // invalid IANA name → caller falls back to backoff
}

/** Epoch (ms) of the NEXT time it is hour24:minute in `tz`, strictly after `now`. */
function nextZonedEpoch(hour24: number, minute: number, tz: string, now: number): number | undefined {
  const off = tzOffsetMs(tz, now);
  if (off === undefined) return undefined;
  const wall = new Date(now + off); // a Date whose UTC fields ARE tz's wall clock
  const targetWallUTC = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), hour24, minute, 0);
  let epoch = targetWallUTC - off; // wall-clock-in-tz → real instant (off ≈ constant over <24h)
  if (epoch <= now) epoch += 24 * 60 * 60 * 1000; // already passed today → tomorrow
  return epoch;
}

/**
 * Scrape the cap-RESET instant (epoch ms) from a 429 node's output. Parses the
 * subscription session-limit message (see {@link CAP_RESET_RE}) into the next
 * occurrence of that wall-clock time in the stated timezone. Returns `undefined` when
 * the message is absent/unparseable — the daemon's headless-breaker then falls back to
 * pure exponential backoff. Fail-safe: a wrong value only changes how long the daemon
 * waits, never loses work. `now` is injectable for tests.
 */
export function parseCapReset(stdout: string, stderr: string, now: number = Date.now()): number | undefined {
  const m = `${stdout}\n${stderr}`.match(CAP_RESET_RE);
  if (!m) return undefined;
  const minute = Number(m[2]);
  let hour = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) hour += 12;
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour > 23 || minute > 59) return undefined;
  return nextZonedEpoch(hour, minute, m[4], now);
}

/**
 * Build the exact `claude -p` argv (NOT a shell string — spawned directly, so no
 * shell quoting is needed). Flags are pushed only when the corresponding spec
 * field is set. NEVER includes `--bare`. cwd is NOT a flag (set on spawn opts).
 *
 * IMPORTANT: the prompt is NOT a positional arg. `--allowedTools <tools...>` (and
 * `--append-system-prompt`'s neighbors) are VARIADIC in this CLI build, so a
 * trailing positional prompt gets greedily consumed by the preceding variadic
 * flag → "Input must be provided…". The prompt is therefore fed via STDIN (which
 * the CLI explicitly supports: "through stdin or as a prompt argument"). See
 * `invokeNode`, which writes `spec.prompt` to the child's stdin.
 *
 * Exported for unit testing the argv construction.
 */
export function buildNodeArgv(spec: NodeSpec): string[] {
  const argv: string[] = [
    'claude',
    '-p',
    // stream-json (requires --verbose) emits the full turn-by-turn transcript as
    // JSONL, ending in the SAME result object json-format gave. We capture that
    // stream as the per-leaf transcript; parseNodeJson reads the final result line.
    '--output-format', 'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--permission-mode', spec.permissionMode ?? 'bypassPermissions',
  ];
  if (spec.model) argv.push('--model', spec.model);
  if (spec.effort) argv.push('--effort', spec.effort);
  // Strip MCP: --strict-mcp-config with NO --mcp-config flags = zero MCP servers, so the
  // cwd's .mcp.json (the ~200-tool mermaid server) is not loaded into a node that can't
  // call it. A boolean flag (no value), so it never collides with the variadic args below.
  if (spec.strictMcpConfig) argv.push('--strict-mcp-config');
  // allowedTools may be '' (= no tools) — push it explicitly when defined (not just truthy).
  if (spec.allowedTools !== undefined) argv.push('--allowedTools', spec.allowedTools);
  if (spec.appendSystemPrompt) argv.push('--append-system-prompt', spec.appendSystemPrompt);
  // NB: prompt deliberately NOT appended as a positional — it goes on stdin.
  return argv;
}

/** Shape of `claude auth status --json` on a claude.ai-subscription machine. */
interface AuthStatus {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
  subscriptionType?: string;
  email?: string;
}

/** Apply the blueprint §1 decision rule to a parsed auth-status object. */
export function authModeFromStatus(s: AuthStatus | null): AuthMode {
  if (!s) return 'unknown';
  const isSubscription =
    s.loggedIn === true &&
    s.authMethod === 'claude.ai' &&
    s.apiProvider === 'firstParty' &&
    typeof s.subscriptionType === 'string' &&
    s.subscriptionType.length > 0;
  if (isSubscription) return 'subscription';
  // An API-key credential reports a non-claude.ai authMethod / non-firstParty provider.
  if (s.authMethod || s.apiProvider) return 'api';
  return 'unknown';
}

/** Run `claude auth status --json` and parse it. Returns null on any failure. */
function readAuthStatus(): AuthStatus | null {
  try {
    const p = Bun.spawnSync(['claude', 'auth', 'status', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    });
    const out = p.stdout?.toString() ?? '';
    if (!out.trim()) return null;
    return JSON.parse(out) as AuthStatus;
  } catch {
    return null;
  }
}

// Memoized pre-flight result (run ONCE before the first node, like registry.ts's
// conformance gates). Cached across all invokeNode calls.
let cachedAuthMode: AuthMode | null = null;

/**
 * Pre-flight subscription-identity guard — memoized, FAIL-CLOSED.
 *
 * Runs `claude auth status --json` once, applies the §1 decision rule, and THROWS
 * unless the active auth is the claude.ai subscription. Nodes never run under an
 * API key by default (the HALT contract). The executor calls this at startup;
 * `invokeNode` reads the memoized value.
 *
 * Returns the resolved AuthMode ('subscription') on success.
 */
export function assertSubscriptionAuth(): AuthMode {
  if (cachedAuthMode === null) {
    cachedAuthMode = authModeFromStatus(readAuthStatus());
  }
  if (cachedAuthMode !== 'subscription') {
    throw new Error(
      `refusing to run nodes: active auth is '${cachedAuthMode}', expected claude.ai subscription ` +
        `(loggedIn + authMethod=claude.ai + apiProvider=firstParty + subscriptionType). ` +
        `Re-authenticate with the subscription; nodes never run under an API key.`,
    );
  }
  return cachedAuthMode;
}

/** Resolve the memoized auth mode WITHOUT throwing (so a node can stamp authMode
 *  on its result and surface a HALT itself rather than crash the process). */
function resolveAuthMode(): AuthMode {
  if (cachedAuthMode === null) {
    cachedAuthMode = authModeFromStatus(readAuthStatus());
  }
  return cachedAuthMode;
}

/** For tests: drop the memoized auth so the next call re-reads `auth status`. */
export function _resetAuthCache(): void {
  cachedAuthMode = null;
}

/** Shape of the `--output-format json` single result object (fields best-effort). */
interface ClaudeJsonResult {
  result?: string;
  is_error?: boolean;
  subtype?: string;
  num_turns?: number;
  total_cost_usd?: number;
  /** HTTP status of an API error (null/absent on success; 429 = rate limit, 5xx = transient). */
  api_error_status?: number | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

/** Parse a `--output-format json` result string into usage + text. */
export function parseNodeJson(stdout: string): {
  text?: string;
  usage?: NodeUsage;
  isError: boolean;
  subtype?: string;
  apiErrorStatus?: number;
  parseError?: string;
} {
  // Two accepted shapes, parsed identically once the result object is in hand:
  //   (a) --output-format json        → stdout IS the single result object.
  //   (b) --output-format stream-json → stdout is JSONL; the LAST {"type":"result"}
  //       line is the same result object (the rest are the captured transcript).
  // Back-compatible: try (a) first, fall back to scanning for the result line.
  const j = extractResultObject(stdout);
  if (j == null) {
    return {
      text: stdout,
      isError: false,
      parseError: 'no parseable result object in node output',
    };
  }
  const usage: NodeUsage = {
    inputTokens: j.usage?.input_tokens,
    outputTokens: j.usage?.output_tokens,
    cacheReadTokens: j.usage?.cache_read_input_tokens,
    cacheCreationTokens: j.usage?.cache_creation_input_tokens,
    costUsd: j.total_cost_usd,
    numTurns: j.num_turns,
  };
  return {
    text: typeof j.result === 'string' ? j.result : undefined,
    usage,
    isError: j.is_error === true,
    subtype: j.subtype,
    apiErrorStatus: typeof j.api_error_status === 'number' ? j.api_error_status : undefined,
  };
}

/**
 * Pull the result object out of either a single-JSON (`--output-format json`) or a
 * JSONL stream (`--output-format stream-json`). For the stream, the final
 * `{"type":"result",...}` line carries the same fields as the json-format output.
 */
function extractResultObject(stdout: string): ClaudeJsonResult | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  // (a) whole stdout is one JSON object.
  try {
    const j = JSON.parse(trimmed) as ClaudeJsonResult;
    if (j && typeof j === 'object') return j;
  } catch { /* fall through to JSONL scan */ }
  // (b) JSONL — scan from the end for the last `type:'result'` line.
  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line[0] !== '{') continue;
    try {
      const obj = JSON.parse(line) as ClaudeJsonResult & { type?: string };
      if (obj && obj.type === 'result') return obj;
    } catch { /* keep scanning */ }
  }
  return null;
}

/**
 * Run ONE bounded headless `claude -p` node. Single-shot: NO loop, NO retry.
 *
 * Steps (blueprint §4):
 *  1. Resolve memoized authMode. If not 'subscription' → HALT+ALARM: ok=false,
 *     loud parseError, never spawn (never run under an API key).
 *  2. Build argv (§2), spawn with cwd on the process (no --cwd flag).
 *  3. Wall-clock timeout race → kill on expiry.
 *  4. Capture stdout/stderr, await exit code.
 *  5. Parse the json result (final text, num_turns, cost, usage, is_error).
 *  6. Heuristic rate-limit detection (RATE_LIMIT_RE).
 *  7. Stamp authMode, return NodeResult.
 */
export async function invokeNode(spec: NodeSpec): Promise<NodeResult> {
  // WALL-CLOCK start (Date.now), NOT performance.now: the monotonic clock PAUSES while
  // the process is suspended (macOS App Nap / sleep), so a node that the OS napped for
  // 16 min then the wall-clock timeout killed reported durationMs≈47s — wildly under the
  // real lifetime and self-contradicting the "timed out after 600000ms" label (the build123d
  // T14 overnight case). Wall time counts suspend, so durationMs now reflects reality and
  // agrees with the timeout. (We never sub-ms-profile a node here; ms wall is the right unit.)
  const start = Date.now();
  const authMode = resolveAuthMode();

  // HALT + ALARM contract: if the active auth is not the subscription, refuse to
  // spawn — surface a loud, machine-readable error the executor will act on.
  if (authMode !== 'subscription') {
    const msg =
      `HALT: node refused — active auth is '${authMode}', not a claude.ai subscription. ` +
      `Nodes must run under the subscription, never an API key. (PAW P1 subscription guard.)`;
    // eslint-disable-next-line no-console
    console.error(`[node-invoker] ${msg}`);
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      durationMs: Math.round(Date.now() - start),
      rateLimited: false,
      authMode,
      parseError: msg,
    };
  }

  const argv = buildNodeArgv(spec);
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(argv, {
      cwd: spec.cwd,
      // Prompt on stdin (NOT a positional — see buildNodeArgv): avoids the
      // variadic-flag greedily eating a trailing positional prompt.
      stdin: new TextEncoder().encode(spec.prompt),
      stdout: 'pipe',
      stderr: 'pipe',
      env: worktreeSpawnEnv(spec.cwd), // E3: isolate git to the worktree (no main-checkout escape)
      // E1: own process group (group leader pid == pgid) so the daemon can kill the
      // whole subtree (CLI + model subprocess) via process.kill(-pid) on off/drop/hold.
      detached: true,
    });
  } catch (e) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      durationMs: Math.round(Date.now() - start),
      rateLimited: false,
      authMode,
      parseError: `spawn failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // E1: track this node's process-group leader so a brake (off/drop/hold/shutdown) can
  // kill the whole subtree mid-run. Cleared after collection below.
  registerLeafProc(spec.leafId, proc.pid, spec.project ?? '');

  // Start draining stdout/stderr IMMEDIATELY (concurrent with the run) — NOT after the
  // timeout. Reading the pipes after a kill is exactly what wedged the daemon: a
  // grandchild holding the pipe open means `new Response(stream).text()` never EOFs, so
  // the await hangs forever and the single-flight tick guard never clears. Reading
  // concurrently captures partial output and lets us cap the wait below.
  const stdoutP = new Response(proc.stdout as ReadableStream).text().catch(() => '');
  const stderrP = new Response(proc.stderr as ReadableStream).text().catch(() => '');

  // Wall-clock kill with ESCALATION: SIGTERM, then SIGKILL after a grace period (a
  // process stuck in a network syscall ignores SIGTERM). race process exit vs timeout.
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      // E1: group-kill (detached → leader pid) so the model subprocess the CLI forked
      // dies too, not just the CLI leader. groupKillPid does the SIGTERM→SIGKILL grace.
      groupKillPid(proc.pid);
      resolve();
    }, timeoutMs);
  });

  const exited = proc.exited.then(() => undefined);
  await Promise.race([exited, timeout]);

  // BOUNDED collection: never await an unbounded stream/exit. Each is capped so the
  // invocation ALWAYS returns (within timeoutMs + DRAIN_CAP_MS), which is what makes
  // the daemon un-wedgeable — partial output is acceptable, a permanent hang is not.
  const capped = <T>(p: Promise<T>, fallback: T): Promise<T> =>
    Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), DRAIN_CAP_MS))]);
  const stdout = await capped(stdoutP, '');
  const stderr = await capped(stderrP, '');
  const exitCode = await capped(proc.exited, -1);
  if (timer) clearTimeout(timer);
  if (hardTimer) clearTimeout(hardTimer);
  // E1: the subprocess has exited (or been killed) — forget it so a later brake doesn't
  // signal a recycled pid. Guard on proc.pid so a fast next-node spawn's entry survives.
  unregisterLeafProc(spec.leafId, proc.pid);

  const durationMs = Math.round(Date.now() - start);

  // Persist the raw stream-json transcript (best-effort) — captured even on a
  // timeout, since the partial transcript is the most useful thing to inspect.
  if (spec.transcriptPath) {
    captureTranscript(spec.transcriptPath, spec.transcriptLabel ?? 'node', stdout, { exitCode, durationMs });
  }

  // Parse commands from stream-json (best-effort; parse failure → [])
  let commands: ReturnType<typeof parseNodeCommands> = [];
  try {
    commands = parseNodeCommands(stdout, spec.cwd);
  } catch {
    // parse failure never fails a node
  }

  if (timedOut) {
    return {
      ok: false,
      exitCode,
      stdout,
      durationMs,
      rateLimited: false,
      authMode,
      text: stdout,
      parseError: `node timed out after ${timeoutMs}ms (killed)`,
      commands,
    };
  }

  const parsed = parseNodeJson(stdout);

  // Rate-limit detection — POSITIVE evidence only (todo 4ec5a13c). A genuine rate
  // limit is the API returning 429, surfaced as `api_error_status` on the json
  // result. TRANSIENT 5xx (500/502/503/529 — e.g. the Anthropic blips that paused
  // real L1 runs) and every other failure are NOT rate limits: they return ok=false
  // with rateLimited=false, so the executor's in-place-retry / fresh-attempt path
  // (ce02d796) recovers them instead of spuriously PAUSING for a cap that isn't
  // there. The old broad RATE_LIMIT_RE over result text false-positived on those
  // transient 5xx (and on any node that merely mentioned "quota"/"overloaded").
  const rateLimited =
    parsed.apiErrorStatus === 429 ||
    // Fallback ONLY when there's no structured status (hard failure, unparseable
    // result): a NARROW explicit 429 on stderr — never the broad text heuristic.
    (parsed.apiErrorStatus === undefined &&
      exitCode !== 0 &&
      /\b429\b|rate limit (?:exceeded|reached)|too many requests/i.test(stderr));

  // Network outage / unreachable API: the request never reached the model, so the
  // leaf was never actually tested. Classify it as a transient PAUSE (same handling
  // as a rate limit — pause + backoff, no attempt burned) instead of a leaf failure
  // that burns retries. Only when there's NO structured API result (a genuine
  // connection failure, not a model error that happens to mention "tls" etc.).
  const unreachable =
    !rateLimited &&
    exitCode !== 0 &&
    parsed.apiErrorStatus === undefined &&
    !parsed.isError &&
    CONN_ERR_RE.test(stderr);

  // `transient` drives the executor's pause path (rate-limit OR connectivity); both
  // pause + back off rather than burning an attempt. capReset only applies to a real
  // session cap; an outage has none → undefined → the daemon falls back to backoff.
  const transient = rateLimited || unreachable;
  const ok = exitCode === 0 && !transient && !parsed.isError;

  return {
    ok,
    exitCode,
    stdout,
    durationMs,
    usage: parsed.usage,
    // Report `transient` (rate-limit OR connectivity outage) as rateLimited so the
    // executor's existing pause path handles both without touching every call site.
    rateLimited: transient,
    // `unreachable` distinguishes a network outage from a true cap for logging/labels.
    unreachable,
    // Parse the subscription session-limit reset time so the breaker reopens exactly
    // when the cap lifts; an outage has no reset → undefined → daemon backoff.
    capReset: rateLimited ? parseCapReset(stdout, stderr) : undefined,
    authMode,
    text: parsed.text,
    parseError: parsed.parseError ?? (parsed.isError ? (stderr || 'result is_error=true') : undefined),
    commands,
  };
}

/**
 * Thin seam — deliberately NOT the full `WorkerAgent` port (no tmux launch, no
 * pane detectors, no event stream). Just a one-shot function behind a tiny
 * interface so a later leaf can compose nodes into a higher-level executor.
 */
export interface NodeInvoker {
  invoke(spec: NodeSpec): Promise<NodeResult>;
}

/** Default invoker — wraps `invokeNode`. */
export const ClaudeNodeInvoker: NodeInvoker = {
  invoke: invokeNode,
};

// ---------------------------------------------------------------------------
// Grok headless primitive (PR-1) — parallel to invokeNode / ClaudeNodeInvoker.
// ---------------------------------------------------------------------------

/** Narrow stderr rate-limit fallback — matches Claude invokeNode (4ec5a13c). */
const GROK_RATE_LIMIT_STDERR_RE = /\b429\b|rate limit (?:exceeded|reached)|too many requests/i;

let cachedGrokBin: string | null = null;
/** Resolve the `grok` binary to an ABSOLUTE path. Override with GROK_BIN.
 *  The deployed sidecar is a macOS GUI app whose PATH is minimal (/usr/bin:/bin:…) and omits
 *  ~/.grok/bin / ~/.local/bin, so a bare `grok` intermittently fails `posix_spawn` with ENOENT.
 *  Resolve a known absolute install path once; fall back to bare 'grok' (PATH) only if none exist. */
export function resolveGrokBin(): string {
  const override = process.env.GROK_BIN?.trim();
  if (override) return override;
  if (cachedGrokBin) return cachedGrokBin;
  for (const c of [join(homedir(), '.grok', 'bin', 'grok'), join(homedir(), '.local', 'bin', 'grok')]) {
    if (existsSync(c)) { cachedGrokBin = c; return c; }
  }
  return 'grok';
}
/** For tests: drop the memoized grok binary path. */
export function _resetGrokBinCache(): void { cachedGrokBin = null; }

interface GrokAuthFile {
  expires_at?: string | number;
  access_token?: string;
}

interface GrokAuthStatus {
  loggedIn?: boolean;
  authenticated?: boolean;
}

/** Is a single credential record valid (has a token, not expired)? The real
 *  ~/.grok/auth.json record carries the token as `key` (OIDC) or `access_token`, plus an
 *  `expires_at` that is an ISO STRING (e.g. "2026-06-25T20:15:11Z") or epoch ms. */
function grokRecordValid(r: Record<string, unknown> | null | undefined): boolean {
  if (!r || typeof r !== 'object') return false;
  const token = (r.access_token ?? r.key) as unknown;
  if (typeof token !== 'string' || token.length === 0) return false;
  const exp = r.expires_at;
  if (exp == null) return true;
  const ms = typeof exp === 'number' ? exp : Date.parse(String(exp));
  return !Number.isFinite(ms) || ms > Date.now();
}

/** Apply grok auth rule to a parsed status / auth-file snapshot. Handles three shapes:
 *  (1) `grok auth status --json` → { loggedIn|authenticated }, (2) a flat auth record
 *  { access_token, expires_at }, and (3) the REAL ~/.grok/auth.json, which nests the
 *  record under an `<issuer>::<client_id>` key: { "https://auth.x.ai::<id>": { key,
 *  refresh_token, expires_at, ... } }. PR-1 only handled (1)/(2) → mis-read a logged-in
 *  machine as 'unknown' and halted every grok leaf. */
export function authModeFromGrokStatus(s: GrokAuthStatus | GrokAuthFile | Record<string, unknown> | null): AuthMode {
  if (!s) return 'unknown';
  if ('loggedIn' in s && (s as GrokAuthStatus).loggedIn === true) return 'grok';
  if ('authenticated' in s && (s as GrokAuthStatus).authenticated === true) return 'grok';
  // Flat record (shape 2).
  if (grokRecordValid(s as Record<string, unknown>)) return 'grok';
  // Nested issuer-keyed record(s) (shape 3) — valid if ANY nested credential is valid.
  for (const v of Object.values(s as Record<string, unknown>)) {
    if (v && typeof v === 'object' && grokRecordValid(v as Record<string, unknown>)) return 'grok';
  }
  return 'unknown';
}

function readGrokAuthStatus(): GrokAuthStatus | GrokAuthFile | null {
  try {
    const p = Bun.spawnSync([resolveGrokBin(), 'auth', 'status', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    });
    const out = p.stdout?.toString() ?? '';
    if (out.trim() && p.exitCode === 0) {
      return JSON.parse(out) as GrokAuthStatus;
    }
  } catch { /* fall through to auth.json */ }
  try {
    const raw = readFileSync(join(homedir(), '.grok', 'auth.json'), 'utf-8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as GrokAuthFile;
  } catch {
    return null;
  }
}

let cachedGrokAuthMode: AuthMode | null = null;

/**
 * Pre-flight Grok OIDC guard — memoized, FAIL-CLOSED. Separate cache from Claude.
 * Verifies `grok` is on PATH (or GROK_BIN) and credentials look valid.
 */
export function assertGrokAuth(): AuthMode {
  if (cachedGrokAuthMode === null) {
    if (!Bun.which(resolveGrokBin())) {
      cachedGrokAuthMode = 'unknown';
    } else {
      cachedGrokAuthMode = authModeFromGrokStatus(readGrokAuthStatus());
    }
  }
  if (cachedGrokAuthMode !== 'grok') {
    throw new Error(
      `refusing to run grok nodes: active auth is '${cachedGrokAuthMode}', expected grok OIDC ` +
        `(grok on PATH + valid ~/.grok/auth.json or grok auth status). ` +
        `Run 'grok login' or set GROK_BIN.`,
    );
  }
  return cachedGrokAuthMode;
}

function resolveGrokAuthMode(): AuthMode {
  if (cachedGrokAuthMode === null) {
    if (!Bun.which(resolveGrokBin())) {
      cachedGrokAuthMode = 'unknown';
    } else {
      cachedGrokAuthMode = authModeFromGrokStatus(readGrokAuthStatus());
    }
  }
  return cachedGrokAuthMode;
}

/** For tests: drop memoized grok auth. */
export function _resetGrokAuthCache(): void {
  cachedGrokAuthMode = null;
}

interface GrokJsonTerminal {
  text?: string;
  stopReason?: string;
  sessionId?: string;
  thought?: string;
  total_cost_usd?: number;
  num_turns?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  errorCode?: string;
}

/**
 * Build argv for headless `grok --prompt-file` (spawned as `[grokBin, ...argv]`).
 * Exported for unit tests.
 */
export function buildGrokArgv(spec: NodeSpec, promptFile: string): string[] {
  const absCwd = resolve(spec.cwd);
  const argv: string[] = [
    '--prompt-file', promptFile,
    '--output-format', spec.transcriptPath ? 'streaming-json' : 'json',
    '--permission-mode', spec.permissionMode ?? 'bypassPermissions',
    '--cwd', absCwd,
    '--no-plan', '--no-subagents', '--no-memory', '--disable-web-search',
  ];
  if (spec.model) argv.push('-m', resolveGrokModel(spec.model, spec.transcriptLabel));
  if (spec.effort) argv.push('--effort', spec.effort);
  if (spec.allowedTools !== undefined) argv.push('--allowedTools', spec.allowedTools);
  if (spec.appendSystemPrompt) argv.push('--append-system-prompt', spec.appendSystemPrompt);
  if (spec.maxTurns != null) argv.push('--max-turns', String(spec.maxTurns));
  return argv;
}

function extractGrokTerminal(stdout: string): GrokJsonTerminal | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const j = JSON.parse(trimmed) as GrokJsonTerminal;
    if (j && typeof j === 'object' && ('stopReason' in j || 'text' in j)) return j;
  } catch { /* JSONL scan */ }
  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line[0] !== '{') continue;
    try {
      const obj = JSON.parse(line) as GrokJsonTerminal & { type?: string };
      if (obj && (obj.stopReason != null || obj.type === 'end')) return obj;
    } catch { /* keep scanning */ }
  }
  return null;
}

/**
 * Assemble the assistant text from grok streaming-json. Grok streams the reply as MANY
 * chunked lines `{"type":"text","data":"VER"}` `{"type":"text","data":"DI"}` … — the full
 * text is the CONCATENATION of every `type:"text"` line's `data`. Neither the per-chunk
 * lines nor the terminal `{"type":"end","stopReason":...}` object carry a single `text`
 * field, so the old `.text`-only scan always came back EMPTY → the review verdict was
 * unreadable → infinite revise loop. Also tolerates a single-JSON object with a `.text`
 * field (the `--output-format json` shape) and ignores `type:"thought"` reasoning chunks.
 */
function assembleGrokText(stdout: string): string {
  let out = '';
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    try {
      const obj = JSON.parse(t) as { type?: string; data?: string; text?: string };
      if (obj.type === 'text' && typeof obj.data === 'string') out += obj.data;
      else if (obj.type !== 'thought' && typeof obj.text === 'string') out += obj.text; // single-json
    } catch { /* skip non-JSON / partial lines */ }
  }
  return out;
}

/** Parse grok `--output-format json|streaming-json` stdout. */
export function parseGrokOutput(stdout: string): {
  text?: string;
  stopReason?: string;
  usage?: NodeUsage;
  parseError?: string;
} {
  const terminal = extractGrokTerminal(stdout);
  // Prefer the terminal's own `text` (single-json shape); else assemble the streamed
  // `type:"text"` chunks (the real streaming-json shape — the terminal has no text).
  const assembled = assembleGrokText(stdout);
  const text =
    (typeof terminal?.text === 'string' && terminal.text.length > 0)
      ? terminal.text
      : (assembled.length > 0 ? assembled : undefined);

  if (!terminal && text == null) {
    return { text: undefined, parseError: 'grok: no parseable terminal object in node output' };
  }
  const usage: NodeUsage | undefined = terminal
    ? {
        inputTokens: terminal.usage?.input_tokens,
        outputTokens: terminal.usage?.output_tokens,
        cacheReadTokens: terminal.usage?.cache_read_input_tokens,
        cacheCreationTokens: terminal.usage?.cache_creation_input_tokens,
        costUsd: terminal.total_cost_usd,
        numTurns: terminal.num_turns,
      }
    : undefined;
  return { text, stopReason: terminal?.stopReason, usage };
}

function writePromptTempFile(prompt: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mermaid-node-'));
  const file = join(dir, 'prompt.txt');
  writeFileSync(file, prompt, 'utf-8');
  return { dir, file };
}

function cleanupPromptTemp(dir: string, file: string): void {
  try { unlinkSync(file); } catch { /* best-effort */ }
  try { rmdirSync(dir); } catch { /* best-effort */ }
}

function grokParseError(msg: string): string {
  return msg.startsWith('grok:') ? msg : `grok: ${msg}`;
}

/**
 * Run ONE bounded headless `grok --prompt-file` node. Mirrors invokeNode structure.
 */
export async function invokeGrokNode(spec: NodeSpec): Promise<NodeResult> {
  const start = Date.now();
  const authMode = resolveGrokAuthMode();

  if (authMode !== 'grok') {
    const msg =
      `grok: HALT: node refused — active auth is '${authMode}', not grok OIDC. ` +
      `Run 'grok login' and ensure grok is on PATH (or set GROK_BIN).`;
    // eslint-disable-next-line no-console
    console.error(`[node-invoker] ${msg}`);
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      durationMs: Math.round(Date.now() - start),
      rateLimited: false,
      authMode,
      parseError: msg,
    };
  }

  let promptDir = '';
  let promptFile = '';
  try {
    ({ dir: promptDir, file: promptFile } = writePromptTempFile(spec.prompt));
  } catch (e) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      durationMs: Math.round(Date.now() - start),
      rateLimited: false,
      authMode,
      parseError: grokParseError(`prompt temp file failed: ${e instanceof Error ? e.message : String(e)}`),
    };
  }

  const grokBin = resolveGrokBin();
  const argv = buildGrokArgv(spec, promptFile);
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // TRANSIENT guard: a not-yet-materialized worktree cwd makes posix_spawn fail with ENOENT
  // (Bun attributes it to the command, e.g. "ENOENT … 'grok'"). That is INFRA, not a node
  // failure — report it as transient (rateLimited+unreachable) so the executor pauses & retries
  // the SAME node in place rather than discarding the attempt and re-running the (opus) blueprint.
  if (!existsSync(spec.cwd)) {
    cleanupPromptTemp(promptDir, promptFile);
    return {
      ok: false, exitCode: -1, stdout: '', durationMs: Math.round(Date.now() - start),
      rateLimited: true, unreachable: true, authMode,
      parseError: grokParseError(`worktree cwd not present yet: ${spec.cwd}`),
    };
  }

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([grokBin, ...argv], {
      cwd: spec.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: worktreeSpawnEnv(spec.cwd), // E3: isolate git to the worktree (no main-checkout escape)
      detached: true, // E1: own process group so a brake can kill the subtree
    });
  } catch (e) {
    cleanupPromptTemp(promptDir, promptFile);
    // An ENOENT here is transient infra (binary path race / cwd vanished mid-spawn) — classify
    // as transient so it's retried in place, never a hard fail that re-runs the blueprint.
    const msg = e instanceof Error ? e.message : String(e);
    const transient = /ENOENT|posix_spawn|EAGAIN|ENOMEM/i.test(msg);
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      durationMs: Math.round(Date.now() - start),
      rateLimited: transient,
      unreachable: transient || undefined,
      authMode,
      parseError: grokParseError(`spawn failed: ${msg}`),
    };
  }

  // E1: track this grok node's process-group leader (see invokeNode). Cleared below.
  registerLeafProc(spec.leafId, proc.pid, spec.project ?? '');

  const stdoutP = new Response(proc.stdout as ReadableStream).text().catch(() => '');
  const stderrP = new Response(proc.stderr as ReadableStream).text().catch(() => '');

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      // E1: group-kill (detached → leader pid) so the model subprocess the CLI forked
      // dies too, not just the CLI leader. groupKillPid does the SIGTERM→SIGKILL grace.
      groupKillPid(proc.pid);
      resolve();
    }, timeoutMs);
  });

  const exited = proc.exited.then(() => undefined);
  await Promise.race([exited, timeout]);

  const capped = <T>(p: Promise<T>, fallback: T): Promise<T> =>
    Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), DRAIN_CAP_MS))]);
  const stdout = await capped(stdoutP, '');
  const stderr = await capped(stderrP, '');
  const exitCode = await capped(proc.exited, -1);
  if (timer) clearTimeout(timer);
  if (hardTimer) clearTimeout(hardTimer);
  unregisterLeafProc(spec.leafId, proc.pid); // E1: forget the exited/killed subprocess

  cleanupPromptTemp(promptDir, promptFile);

  const durationMs = Math.round(Date.now() - start);

  if (spec.transcriptPath) {
    captureTranscript(spec.transcriptPath, spec.transcriptLabel ?? 'node', stdout, { exitCode, durationMs });
  }

  if (timedOut) {
    const partial = parseGrokOutput(stdout);
    return {
      ok: false,
      exitCode,
      stdout,
      durationMs,
      rateLimited: false,
      authMode,
      text: partial.text,
      parseError: grokParseError(`node timed out after ${timeoutMs}ms (killed)`),
    };
  }

  const parsed = parseGrokOutput(stdout);

  const rateLimited =
    exitCode !== 0 &&
    parsed.stopReason === undefined &&
    GROK_RATE_LIMIT_STDERR_RE.test(stderr);

  const unreachable =
    !rateLimited &&
    exitCode !== 0 &&
    parsed.stopReason === undefined &&
    CONN_ERR_RE.test(stderr);

  const transient = rateLimited || unreachable;

  let parseError = parsed.parseError;
  if (!parseError && parsed.stopReason === 'Cancelled') {
    parseError = grokParseError(`run cancelled${stderr.trim() ? ` — ${stderr.trim()}` : ''}`);
  } else if (!parseError && /max turns reached/i.test(stderr)) {
    parseError = grokParseError('max turns reached');
  } else if (!parseError && exitCode !== 0 && parsed.stopReason !== 'EndTurn') {
    parseError = grokParseError(stderr.trim() || `exit ${exitCode}`);
  }

  const ok = exitCode === 0 && !transient && parsed.stopReason === 'EndTurn';

  return {
    ok,
    exitCode,
    stdout,
    durationMs,
    usage: parsed.usage,
    rateLimited: transient,
    unreachable,
    capReset: undefined,
    authMode,
    text: parsed.text,
    parseError,
  };
}

/** Grok headless invoker — wraps `invokeGrokNode`. */
export const GrokNodeInvoker: NodeInvoker = {
  invoke: invokeGrokNode,
};
