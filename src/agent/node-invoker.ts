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

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type AuthMode = 'subscription' | 'api' | 'unknown';

/**
 * Append a node's raw stream-json transcript to the per-leaf file, preceded by a
 * synthetic boundary marker so the reader can split the file back into nodes.
 * Best-effort: a transcript-write failure must NEVER fail the node.
 */
function captureTranscript(path: string, label: string, stdout: string, meta: { exitCode: number; durationMs: number }): void {
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
  /** Appended system prompt (--append-system-prompt). Optional. */
  appendSystemPrompt?: string;
  /** Working dir set on the spawned process (NOT a CLI flag — no --cwd exists). Required. */
  cwd: string;
  /** Wall-clock cap (ms). On expiry the process is killed → ok=false, rateLimited=false. */
  timeoutMs?: number;
  /** Ledger correlation (optional but recommended). */
  leafId?: string;
  epicId?: string;
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
}

export interface NodeUsage {
  inputTokens?: number;
  outputTokens?: number;
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
  /** Detected via exit code / stderr signal (see RATE_LIMIT_RE — heuristic). */
  rateLimited: boolean;
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
  usage?: { input_tokens?: number; output_tokens?: number };
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
      env: process.env,
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

  // Wall-clock kill: race the process exit against the timeout.
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill(); } catch { /* already gone */ }
      resolve();
    }, timeoutMs);
  });

  const exited = proc.exited.then(() => undefined);
  await Promise.race([exited, timeout]);

  // Drain streams + final exit code (the kill above makes exited resolve).
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text().catch(() => ''),
    new Response(proc.stderr as ReadableStream).text().catch(() => ''),
  ]);
  const exitCode = await proc.exited;
  if (timer) clearTimeout(timer);

  const durationMs = Math.round(Date.now() - start);

  // Persist the raw stream-json transcript (best-effort) — captured even on a
  // timeout, since the partial transcript is the most useful thing to inspect.
  if (spec.transcriptPath) {
    captureTranscript(spec.transcriptPath, spec.transcriptLabel ?? 'node', stdout, { exitCode, durationMs });
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

  const ok = exitCode === 0 && !rateLimited && !parsed.isError;

  return {
    ok,
    exitCode,
    stdout,
    durationMs,
    usage: parsed.usage,
    rateLimited,
    // Parse the subscription session-limit reset time so the breaker reopens exactly
    // when the cap lifts; undefined (unparseable) → daemon falls back to backoff.
    capReset: rateLimited ? parseCapReset(stdout, stderr) : undefined,
    authMode,
    text: parsed.text,
    parseError: parsed.parseError ?? (parsed.isError ? (stderr || 'result is_error=true') : undefined),
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
