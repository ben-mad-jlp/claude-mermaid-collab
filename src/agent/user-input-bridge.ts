import { randomUUID } from 'node:crypto';
import type { UserInputKind, UserInputValue } from './contracts';

/**
 * UserInputBridge — mid-turn input mailbox keyed on promptId.
 *
 * The dispatcher calls {@link request} to mint a promptId and get back a
 * promise that resolves once the user (via websocket command) calls
 * {@link respond} with that promptId. A timeout fires after `timeoutMs` and
 * rejects the promise with `Error('user_input_timeout')` so the caller can
 * catch and emit a `UserInputResolvedEvent` with `{ kind: 'timeout' }`.
 *
 * The bridge intentionally does NOT import EventLog or emit events itself.
 * Event emission is the caller's responsibility so the bridge stays pure.
 */

export interface UserInputChoice {
  id: string;
  label: string;
}

interface PendingEntry {
  promptId: string;
  prompt: string;
  expectedKind: UserInputKind;
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: UserInputValue) => void;
  reject: (err: Error) => void;
}

export interface UserInputRequestHandle {
  promptId: string;
  promise: Promise<UserInputValue>;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export class UserInputBridge {
  // sessionId -> (promptId -> entry)
  private pending = new Map<string, Map<string, PendingEntry>>();

  /**
   * Create a mailbox entry, start timeout, and return the promptId + awaitable
   * promise. On timeout the promise rejects with `Error('user_input_timeout')`.
   */
  request(
    sessionId: string,
    prompt: string,
    expectedKind: UserInputKind,
    _choices?: Array<UserInputChoice>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): UserInputRequestHandle {
    const promptId = randomUUID();

    const promise = new Promise<UserInputValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        const submap = this.pending.get(sessionId);
        const entry = submap?.get(promptId);
        if (!entry) return;
        submap!.delete(promptId);
        reject(new Error('user_input_timeout'));
      }, timeoutMs);
      (timer as any).unref?.();

      const entry: PendingEntry = {
        promptId,
        prompt,
        expectedKind,
        timer,
        resolve,
        reject,
      };

      let submap = this.pending.get(sessionId);
      if (!submap) {
        submap = new Map();
        this.pending.set(sessionId, submap);
      }
      submap.set(promptId, entry);
    });

    return { promptId, promise };
  }

  /**
   * Look up the mailbox entry for (sessionId, promptId) and resolve it with
   * the provided value. Returns `true` if a pending entry was matched (and
   * resolved), `false` otherwise (unknown promptId or duplicate respond).
   */
  respond(sessionId: string, promptId: string, value: UserInputValue): boolean {
    const submap = this.pending.get(sessionId);
    const entry = submap?.get(promptId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    submap!.delete(promptId);
    entry.resolve(value);
    return true;
  }

  /**
   * Returns true iff a pending mailbox entry exists for (sessionId, promptId).
   */
  hasPending(sessionId: string, promptId: string): boolean {
    return this.pending.get(sessionId)?.has(promptId) ?? false;
  }

  /**
   * Cancel every pending request for a session, rejecting each promise with
   * `Error('session_ended')`. Called on session end/stop.
   */
  cancelAll(sessionId: string): void {
    const submap = this.pending.get(sessionId);
    if (!submap) return;
    for (const entry of submap.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('session_ended'));
    }
    this.pending.delete(sessionId);
  }
}

/**
 * Shared singleton UserInputBridge. MCP tools and other callers that need to
 * await user input without direct access to the session registry may use this
 * instance. The agent dispatcher reads responses via `respond(...)` and emits
 * the resolved event through its EventLog.
 */
export const userInputBridge = new UserInputBridge();
