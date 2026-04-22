/**
 * EditDecisionBridge — per-hunk review mailbox keyed on `${project}::${session}::${snippetId}`.
 *
 * The agent calls {@link wait} to register a pending edit decision and receive a
 * promise that resolves once the user (via websocket command) calls {@link resolve}
 * with that key. A timeout fires after `DEFAULT_TIMEOUT_MS` and rejects the promise
 * with `Error('edit_decision_timeout')` so the caller can handle the expiry case.
 *
 * The bridge intentionally does NOT import EventLog or emit events itself.
 * Event emission is the caller's responsibility so the bridge stays pure.
 */

export interface EditDecision {
  decision: 'accepted' | 'rejected';
  comment?: string;
}

interface PendingDecision {
  key: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (decision: EditDecision) => void;
  reject: (err: Error) => void;
}

const DEFAULT_TIMEOUT_MS = 300_000;

export class EditDecisionBridge {
  private pending = new Map<string, PendingDecision>();

  /**
   * Register a mailbox entry for the given composite key, start the timeout,
   * and return a promise that resolves with the user's decision.
   *
   * If an entry already exists for the same key (e.g. a snippet was replaced
   * before the previous decision was made) the existing promise is rejected
   * with `Error('replaced')` before the new entry is installed.
   *
   * On timeout the promise rejects with `Error('edit_decision_timeout')`.
   */
  wait(
    project: string,
    session: string,
    snippetId: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<EditDecision> {
    const key = `${project}::${session}::${snippetId}`;

    // Handle "replaced" case — reject existing entry before overwriting
    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.reject(new Error('replaced'));
      this.pending.delete(key);
    }

    return new Promise<EditDecision>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(key)) return;
        this.pending.delete(key);
        reject(new Error('edit_decision_timeout'));
      }, timeoutMs);
      (timer as any).unref?.();

      const entry: PendingDecision = {
        key,
        timer,
        resolve,
        reject,
      };

      this.pending.set(key, entry);
    });
  }

  /**
   * Resolve the pending decision for the given composite key with the provided
   * decision value. Returns `true` if a pending entry was matched (and resolved),
   * `false` otherwise (unknown key or duplicate resolve).
   */
  resolve(project: string, session: string, snippetId: string, decision: EditDecision): boolean {
    const key = `${project}::${session}::${snippetId}`;
    const entry = this.pending.get(key);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    entry.resolve(decision);
    return true;
  }

  /**
   * Cancel the pending decision for the given composite key, rejecting its
   * promise with `Error('edit_decision_cancelled')`. No-op if no entry exists.
   */
  cancel(project: string, session: string, snippetId: string): void {
    const key = `${project}::${session}::${snippetId}`;
    const entry = this.pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    entry.reject(new Error('edit_decision_cancelled'));
  }
}

/**
 * Shared singleton EditDecisionBridge. MCP tools and other callers that need to
 * await edit decisions without direct access to the session registry may use this
 * instance.
 */
export const editDecisionBridge = new EditDecisionBridge();
