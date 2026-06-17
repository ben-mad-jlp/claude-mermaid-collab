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

export type AuthMode = 'subscription' | 'api' | 'unknown';

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
  /** Permission mode override. Default 'bypassPermissions' (no human to approve, headless). */
  permissionMode?: 'bypassPermissions' | 'acceptEdits' | 'default' | 'plan' | 'auto' | 'dontAsk';
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
 * Best-effort scrape of a cap-RESET timestamp (epoch ms) from a node's output.
 *
 * UNCONFIRMED — v1 STUB returning `undefined`. `claude --help` documents no
 * reset-time field, so there is no safe format to parse yet. Pure exponential
 * backoff (owned by the daemon's headless-breaker) is the correct, dependency-free
 * default. See §1c/§5 of the P3 blueprint and the RUNTIME-CONFIRM TODO above: when a
 * REAL 429 is first observed, populate a CAP_RESET_RE (ISO-8601 / unix-epoch /
 * `retry after Ns`) here. Fail-safe: a wrong value only changes how long the daemon
 * waits, never loses work.
 */
export function parseCapReset(_stdout: string, _stderr: string): number | undefined {
  return undefined;
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
    '--output-format', 'json',
    '--no-session-persistence',
    '--permission-mode', spec.permissionMode ?? 'bypassPermissions',
  ];
  if (spec.model) argv.push('--model', spec.model);
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
  try {
    const j = JSON.parse(stdout) as ClaudeJsonResult;
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
  } catch (e) {
    return {
      text: stdout,
      isError: false,
      parseError: e instanceof Error ? e.message : String(e),
    };
  }
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
    // v1 stub → always undefined; daemon uses pure backoff. See parseCapReset.
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
