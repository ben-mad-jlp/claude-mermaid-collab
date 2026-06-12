/**
 * WorkerAgent port (PAW P1).
 *
 * A provider-neutral seam for "launch an autonomous worker into a session, then
 * observe its lifecycle". Today there is exactly ONE implementation — the
 * `ClaudeCodeAgent` (src/agent/adapters/claude-code.ts), which wraps today's
 * exact tmux + `claude` spawn path (ensureSession/runTodoInSession) and the pane
 * scrape detectors. The port exists so the coordinator routes launch + liveness
 * through a registry instead of hard-calling Claude-specific code; a second
 * provider can be added later WITHOUT touching the coordinator, and a kill-switch
 * (WORKER_AGENT_REGISTRY=claude-only) keeps the default surface to claude only.
 *
 * Contract invariant: the ClaudeCodeAgent's behavior must be BYTE-IDENTICAL to
 * the pre-port direct calls — same regexes, same booleans, same cadence — which
 * the conformance harness (src/agent/__tests__/conformance.ts) asserts against
 * recorded pane fixtures.
 */

/** Provider identity. Today only 'claude' is ever registered. */
export type ProviderId = 'claude';

/** Everything needed to launch one worker into a (pool) session. Mirrors the
 *  union of ensureSession + runTodoInSession inputs so the adapter can wrap them
 *  without losing any field. */
export interface LaunchSpec {
  project: string;
  session: string;
  allowedTools?: string;
  model?: string;
  runtimeMode?: 'read-only' | 'edit' | 'bypass';
  contextPrompt?: string;
  /** Worker cwd (the lane's git worktree under isolation; else the target repo). */
  cwd?: string;
  /** The worker skill to send once the session is bound, e.g.
   *  `/mermaid-collab:worker <todoId>`. When omitted, only the session is
   *  ensured (no todo is dispatched). */
  invokeSkill?: string;
}

/** Result of a launch attempt. `ready` is the session-up signal; `sent` reports
 *  whether the worker skill was dispatched (only meaningful when invokeSkill was
 *  passed). `reason` carries the first failure cause for the audit trail. */
export interface WorkerHandle {
  /** Provider that produced this handle. */
  provider: ProviderId;
  /** Session was ensured interactive + bound. */
  ready: boolean;
  /** Backing tmux base name (when known). */
  tmux?: string;
  /** Worker skill was dispatched into the session. Undefined when no invokeSkill. */
  sent?: boolean;
  /** First failure cause (ensure or dispatch), or undefined on full success. */
  reason?: string;
}

/** A normalized, point-in-time observation of a worker's pane — the provider's
 *  scrape detectors collapsed into the booleans the coordinator's watchdog reads
 *  (stall detection, fleet status). Provider-neutral so detectStalls/fleet-status
 *  never branch on Claude-specific pane shapes. */
export interface WorkerEvent {
  /** Raw captured pane text the snapshot was derived from. */
  pane: string;
  /** TUI is interactive and ready for input (status bar painted). */
  tuiReady: boolean;
  /** Pane renders any agent TUI chrome (status bar / spinner / interrupt hint).
   *  Used only to avoid a false dead-shell call during the spawn gap. */
  tuiPresent: boolean;
  /** Agent is actively working (spinner + elapsed timer, or interrupt hint). */
  activelyWorking: boolean;
  /** The agent is sitting on a permission prompt for a non-allowlisted tool. */
  permission: { isPermission: boolean; tool: string | null };
  /** Best-effort pending-question/options context for a stall escalation card. */
  stallContext: string;
}

/** The pure pane-scrape detectors a provider exposes. Each takes the captured
 *  pane text and returns the boolean/structure the coordinator reads — provider
 *  owns the regexes, the coordinator owns the policy. */
export interface WorkerDetectors {
  /** Status bar painted → interactive and ready for input. */
  isTuiReady(pane: string): boolean;
  /** Any TUI chrome present (status bar / spinner / interrupt hint). */
  isTuiPresent(pane: string): boolean;
  /** Spinner+timer or interrupt hint → actively working (not idle-at-prompt). */
  isActivelyWorking(pane: string): boolean;
  /** Permission-prompt classifier (+ the gated tool when extractable). */
  detectPermissionPrompt(pane: string): { isPermission: boolean; tool: string | null };
  /** Pending question/options pulled from the pane for an escalation card. */
  extractStallContext(pane: string): string;
  /** Is a provider process alive anywhere in `rootPid`'s subtree, per a ps
   *  snapshot's child index? (Generalized agentAliveInSubtree.) */
  isAgentAliveInSubtree(
    rootPid: number,
    snap: Map<number, { children: number[]; comm: string }>,
  ): boolean;
  /** Collapse a captured pane into a normalized WorkerEvent snapshot. */
  snapshot(pane: string): WorkerEvent;
}

/** A source of captured pane text for the event stream — abstracted so the pure
 *  adapter never touches tmux/exec directly (the coordinator injects its
 *  capturePane). `done()` lets the producer end the stream (e.g. the tmux died). */
export interface PaneSource {
  capture(): string | Promise<string>;
  /** When it returns true, the stream ends after the current poll. Optional. */
  done?(): boolean;
}

/** Event-stream cadence/termination controls. */
export interface EventStreamOpts {
  /** Poll interval between captures (ms). Defaults to DEFAULT_EVENT_POLL_MS. */
  intervalMs?: number;
  /** Abort the stream cooperatively. */
  signal?: AbortSignal;
  /** Stop after this many polls (a backstop; omit for unbounded). */
  maxPolls?: number;
}

/** The default poll cadence for the event stream — matches the watchdog/fleet
 *  poll so the normalized stream observes state on today's cadence. */
export const DEFAULT_EVENT_POLL_MS = 2000;

/** A launchable, observable worker provider. The registry maps ProviderId →
 *  WorkerAgent; the coordinator only ever sees this interface. */
export interface WorkerAgent extends WorkerDetectors {
  readonly id: ProviderId;
  /** Idempotently ensure the session is up + bound, and (when invokeSkill is
   *  given) dispatch the worker skill. Wraps the provider's native spawn path. */
  launch(spec: LaunchSpec): Promise<WorkerHandle>;
  /** Normalized WorkerEvent stream: poll `source.capture()` on `opts.intervalMs`
   *  and yield one snapshot per poll (today's booleans), until the signal aborts,
   *  `source.done()` returns true, or `maxPolls` is reached. The coordinator's
   *  watchdog reads these instead of branching on provider-specific pane shapes. */
  events(source: PaneSource, opts?: EventStreamOpts): AsyncIterable<WorkerEvent>;
}
