/**
 * CheckpointReactor — before-turn hook that snapshots the working tree and
 * records a checkpoint row.
 *
 * Called by the dispatcher before spawning a child turn. For git repos it uses
 * `git stash create` to capture a working-tree snapshot without altering the
 * index/worktree. For non-git cwds (or failures) it falls back to a `'none'`
 * sentinel. A clean git repo (no changes) reports `'HEAD'`.
 *
 * The reactor:
 *   1. Captures a stash SHA (or sentinel).
 *   2. Inserts a checkpoint row keyed on (sessionId, turnId).
 *   3. Appends a `checkpoint_created` event to the event log so replay sees
 *      the checkpoint alongside the events produced during the turn.
 */

import type { GitOps } from './git-ops.js';
import type { CheckpointStore } from './checkpoint-store.js';
import type { EventLog } from './event-log.js';
import type { AgentEvent, CheckpointCreatedEvent } from './contracts.js';

export interface CheckpointSnapshotResult {
  sha: string;
  firstSeq: number;
}

export class CheckpointReactor {
  constructor(
    private gitOps: GitOps,
    private store: CheckpointStore,
    private eventLog: EventLog,
  ) {}

  async snapshot(
    sessionId: string,
    cwd: string,
    turnId: string,
  ): Promise<CheckpointSnapshotResult> {
    const inRepo = await this.gitOps.isGitRepo(cwd);
    let sha = 'none';
    if (inRepo) {
      try {
        sha = await this.gitOps.stashCreate(cwd, `cmc:turn:${turnId}`);
      } catch {
        sha = 'none';
      }
      if (sha === '') sha = 'HEAD'; // no changes sentinel
    }
    const firstSeq = this.eventLog.getLastSeq(sessionId) + 1;
    this.store.insert({ sessionId, turnId, firstSeq, stashSha: sha });
    const event: CheckpointCreatedEvent = {
      kind: 'checkpoint_created',
      sessionId,
      turnId,
      firstSeq,
      stashSha: sha,
      ts: Date.now(),
    };
    try {
      this.eventLog.append(sessionId, [event as AgentEvent]);
    } catch (err) {
      // Roll back the checkpoint row so we never leave a checkpoint whose
      // corresponding `checkpoint_created` event was never persisted
      // (see review I6). Bubble up so the dispatcher's best-effort catch
      // treats this as a reactor failure that does not block the send.
      try {
        this.store.deleteFromSeq(sessionId, firstSeq);
      } catch {
        /* ignore rollback failure — primary error is more informative */
      }
      throw err;
    }
    return { sha, firstSeq };
  }
}
