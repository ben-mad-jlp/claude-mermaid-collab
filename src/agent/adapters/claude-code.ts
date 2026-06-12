/**
 * ClaudeCodeAgent (PAW P1) — the ONE WorkerAgent implementation today.
 *
 * It WRAPS today's exact spawn path (ensureSession + runTodoInSession from
 * services/claude-launch) and is the canonical home for the pane-scrape detectors
 * that previously lived inline in services/coordinator-live.ts. The detectors were
 * MOVED here VERBATIM — every regex is byte-for-byte unchanged — so the watchdog
 * (stall detection, dead-shell detection, fleet-status) observes identical state.
 * coordinator-live.ts now re-exports them from here for its existing importers
 * (fleet-status.ts, tmux-reaper.ts) so nothing downstream breaks.
 *
 * The conformance harness (src/agent/__tests__/conformance.ts) pins this
 * byte-identical contract against recorded pane fixtures.
 */
import { ensureSession, runTodoInSession } from '../../services/claude-launch';
import { DEFAULT_EVENT_POLL_MS } from '../worker-agent';
import type {
  WorkerAgent,
  WorkerEvent,
  LaunchSpec,
  WorkerHandle,
  PaneSource,
  EventStreamOpts,
} from '../worker-agent';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Pure pane-scrape detectors — MOVED from coordinator-live.ts (regexes UNCHANGED)
// and claude-launch.ts (isTuiReady). Pure string → boolean/struct, no tmux/ps.
// ---------------------------------------------------------------------------

/** The status bar (e.g. "🧠 0% ctx |" / "← for agents") only renders once the
 *  TUI is interactive — a reliable "ready for input" marker. (The ❯ prompt and
 *  welcome box appear earlier, during load, so they're not used.) Moved verbatim
 *  from claude-launch.ts. */
export function isTuiReady(pane: string): boolean {
  return /ctx\s*\||for agents/.test(pane);
}

/** Cheap corroboration: does the pane render any Claude TUI chrome (status bar,
 *  spinner, interrupt hint)? Used only to AVOID a false dead-shell call during the
 *  brief spawn gap before claude paints — the PID check is the primary signal.
 *  Deliberately omits the bare `❯` (oh-my-zsh/p10k prompts use it too). */
export function isClaudeTuiPresent(pane: string): boolean {
  return /ctx\s*\||for agents|esc to interrupt|\(\d+(?:m\s*\d+)?s\s*·/.test(pane);
}

/** A Claude TUI pane is ACTIVELY WORKING when it shows a spinner with an elapsed
 *  timer (e.g. "✻ Zesting… (26s · ↓ 1.1k tokens)") or the interrupt hint. When the
 *  worker has ended its turn and sits at the input prompt awaiting a human, neither
 *  is present. */
export function isActivelyWorking(pane: string): boolean {
  return /\(\d+(?:m\s*\d+)?s\s*·/.test(pane) || /esc to interrupt/i.test(pane);
}

/** Best-effort: pull the worker's pending question/options out of the pane so the
 *  escalation card carries context (fix-3) rather than a bare "stalled". */
export function extractStallContext(pane: string): string {
  const lines = pane.split('\n').map((l) => l.trim()).filter(Boolean);
  const picked = lines.filter((l) =>
    /^[•\-*]?\s*\(?[a-cA-C1-3][).]/.test(l) ||
    /\boption\b|\bescalat/i.test(l) ||
    /\brecommend/i.test(l) ||
    /reply with|which option|proceed with/i.test(l),
  );
  const ctx = picked.slice(-8).join('\n');
  return ctx.length > 0 ? ctx : lines.slice(-6).join('\n');
}

/** A Claude Code PERMISSION PROMPT is a distinct class of idle-at-prompt from a
 *  self-filed escalation/decision. It renders the tool call plus the "Do you want
 *  to proceed?" 1.Yes / 2.Yes-don't-ask / 3.No menu for a non-allowlisted tool.
 *  Returns the requested tool name when extractable. */
export function detectPermissionPrompt(pane: string): { isPermission: boolean; tool: string | null } {
  // The prompt question + the don't-ask-again affordance is the most specific
  // signature (the bare "Do you want to proceed?" can appear in other prose).
  const hasQuestion = /Do you want to proceed\?/i.test(pane);
  const hasDontAsk = /Yes,?\s*(?:and\s*)?don'?t ask again/i.test(pane);
  const hasYesNoMenu =
    /(?:^|\n)\s*❯?\s*1\.\s*Yes\b/i.test(pane) && /(?:^|\n)\s*❯?\s*(?:2|3)\.\s*(?:Yes|No)\b/i.test(pane);
  const isPermission = hasQuestion && (hasDontAsk || hasYesNoMenu);
  if (!isPermission) return { isPermission: false, tool: null };
  return { isPermission: true, tool: extractRequestedTool(pane) };
}

/** Best-effort: pull the tool the permission prompt is gating out of the pane.
 *  Prefers an explicit MCP tool token (mcp__server__tool), then a tool-call
 *  line ending in "(", then null. */
export function extractRequestedTool(pane: string): string | null {
  const mcp = pane.match(/mcp__[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+/);
  if (mcp) return mcp[0];
  const lines = pane.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    // A tool call line typically looks like "ToolName(arg: …)" or "ToolName(".
    const m = l.match(/^([A-Za-z][\w-]*)\s*\(/);
    if (m && !/^(?:if|for|while|switch|function|return)$/i.test(m[1])) return m[1];
  }
  return null;
}

/** Pure BFS: is an agent process (matched by `matcher` over the comm string)
 *  anywhere in `rootPid`'s subtree, per the snapshot's child index? Generalized
 *  from claudeAliveInSubtree — the Claude matcher is `/claude/i`. Exported for
 *  unit testing (no tmux/ps required). */
export function agentAliveInSubtree(
  rootPid: number,
  snap: Map<number, { children: number[]; comm: string }>,
  matcher: RegExp,
): boolean {
  const seen = new Set<number>();
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const node = snap.get(pid);
    if (!node) continue;
    if (matcher.test(node.comm)) return true;
    for (const c of node.children) if (!seen.has(c)) queue.push(c);
  }
  return false;
}

/** The `claude` process matcher — the regex preserved byte-for-byte from the old
 *  inline claudeAliveInSubtree. */
export const CLAUDE_COMM_MATCHER = /claude/i;

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

class ClaudeCodeAgentImpl implements WorkerAgent {
  readonly id = 'claude' as const;

  async launch(spec: LaunchSpec): Promise<WorkerHandle> {
    // Wrap today's EXACT path: ensureSession (idempotent spawn + /collab bind),
    // then — only if a worker skill was requested — runTodoInSession. The branch
    // structure + the `ok = started && reason === undefined` semantics mirror the
    // old inline launchWorker body so behavior is byte-identical.
    const ensured = await ensureSession({
      project: spec.project,
      session: spec.session,
      allowedTools: spec.allowedTools,
      model: spec.model,
      runtimeMode: spec.runtimeMode,
      contextPrompt: spec.contextPrompt,
      cwd: spec.cwd,
    });
    const handle: WorkerHandle = {
      provider: this.id,
      ready: ensured.ready,
      tmux: ensured.tmux,
      reason: ensured.reason,
    };
    if (ensured.ready && spec.invokeSkill) {
      const run = await runTodoInSession({
        session: spec.session,
        invokeSkill: spec.invokeSkill,
        tmux: ensured.tmux,
      });
      handle.sent = run.sent;
      if (!run.sent) handle.reason = run.reason;
    }
    return handle;
  }

  isTuiReady(pane: string): boolean {
    return isTuiReady(pane);
  }
  isTuiPresent(pane: string): boolean {
    return isClaudeTuiPresent(pane);
  }
  isActivelyWorking(pane: string): boolean {
    return isActivelyWorking(pane);
  }
  detectPermissionPrompt(pane: string): { isPermission: boolean; tool: string | null } {
    return detectPermissionPrompt(pane);
  }
  extractStallContext(pane: string): string {
    return extractStallContext(pane);
  }
  isAgentAliveInSubtree(
    rootPid: number,
    snap: Map<number, { children: number[]; comm: string }>,
  ): boolean {
    return agentAliveInSubtree(rootPid, snap, CLAUDE_COMM_MATCHER);
  }

  /** Normalized WorkerEvent stream: poll the injected pane source on cadence and
   *  yield one snapshot per poll (today's booleans), until aborted / done /
   *  maxPolls. Pure of tmux/exec — the coordinator injects its capturePane as the
   *  source — so behavior is identical to the watchdog's existing poll loop. */
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

  /** Collapse a captured pane into the normalized WorkerEvent snapshot the
   *  events iterator yields — exactly today's booleans, no new derivation. */
  snapshot(pane: string): WorkerEvent {
    return {
      pane,
      tuiReady: isTuiReady(pane),
      tuiPresent: isClaudeTuiPresent(pane),
      activelyWorking: isActivelyWorking(pane),
      permission: detectPermissionPrompt(pane),
      stallContext: extractStallContext(pane),
    };
  }
}

/** The single ClaudeCodeAgent instance. Stateless (pure detectors + a thin spawn
 *  wrapper), so one shared instance is safe. */
export const ClaudeCodeAgent: WorkerAgent = new ClaudeCodeAgentImpl();
