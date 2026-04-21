import type { ServerWebSocket } from 'bun';
import type { AgentCommand, AgentEvent, UserMessageEvent, ErrorEvent, CommandAckEvent, UserInputResolvedEvent, CheckpointRevertedEvent, ModelChangedEvent, SessionRenamedEvent, AgentSetModelCommand, AgentRenameSessionCommand, EffortLevel } from './contracts.ts';
import type { AgentSessionRegistry } from './session-registry.ts';
import type { WebSocketHandler } from '../websocket/handler.ts';
import type { UserInputBridge } from './user-input-bridge.ts';
import { CommandReceiptsStore, hashCommand } from './command-receipts.ts';
import type { CheckpointReactor } from './checkpoint-reactor.ts';
import type { CheckpointStore } from './checkpoint-store.ts';
import type { EventLog } from './event-log.ts';
import type { GitOps } from './git-ops.ts';

class DispatchError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

type AgentWS = ServerWebSocket<{ subscriptions: Set<string> }>;

const RECEIPT_TTL_MS = 10 * 60 * 1000;

const ALLOWED_EFFORTS = new Set<EffortLevel>(['low', 'medium', 'high', 'xhigh', 'max']);

export class AgentDispatcher {
  private receipts: CommandReceiptsStore;
  private revertMutex = new Map<string, Promise<unknown>>();

  constructor(private opts: {
    registry: AgentSessionRegistry;
    wsHandler: WebSocketHandler;
    resolvedCwd: string;
    receipts?: CommandReceiptsStore;
    reactor?: CheckpointReactor;
    userInputBridge?: UserInputBridge;
    gitOps?: GitOps;
    checkpointStore?: CheckpointStore;
    eventLog?: EventLog;
  }) {
    this.receipts = opts.receipts ?? new CommandReceiptsStore(opts.resolvedCwd, { isProjectRoot: true });
  }

  setReactor(reactor: CheckpointReactor): void {
    this.opts.reactor = reactor;
  }

  async handle(ws: AgentWS, cmd: AgentCommand): Promise<void> {
    // Command receipts middleware: idempotent dedupe + replay.
    const commandId = cmd.commandId;
    if (!commandId) {
      this.emitErrorFrame(ws, cmd, { code: 'MISSING_COMMAND_ID', message: 'commandId required' });
      return;
    }
    const payloadHash = hashCommand(cmd);
    const prior = this.receipts.get(commandId);
    if (prior) {
      if (prior.payloadHash !== payloadHash) {
        this.emitErrorFrame(ws, cmd, { code: 'COMMAND_ID_COLLISION', message: 'commandId reused with different payload' });
        return;
      }
      if (prior.outcome === 'accepted') {
        this.emitCommandAck(ws, cmd.sessionId, commandId, prior.resultSeq ?? 0);
        return;
      }
      if (prior.outcome === 'rejected') {
        this.emitErrorFrame(ws, cmd, { code: 'COMMAND_REJECTED', message: prior.errorMessage ?? 'rejected' });
        return;
      }
      // pending: an earlier invocation with this commandId is either in-flight
      // or crashed mid-dispatch. Reject as duplicate rather than re-dispatching,
      // which would double-execute side effects (see review I2). The original
      // invocation will emit the ack/error when it settles.
      this.emitErrorFrame(ws, cmd, { code: 'COMMAND_IN_FLIGHT', message: 'command already being processed' });
      return;
    }
    // First-time path: insert the pending row BEFORE dispatching so concurrent
    // re-sends observe it and short-circuit above.
    this.receipts.insertPending(cmd as { commandId: string }, payloadHash, Date.now() + RECEIPT_TTL_MS);

    try {
      const resultSeq = (await this.dispatch(ws, cmd)) ?? 0;
      this.receipts.markAccepted(commandId, resultSeq);
      this.emitCommandAck(ws, cmd.sessionId, commandId, resultSeq);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      this.receipts.markRejected(commandId, msg);
      if (err instanceof DispatchError) {
        this.emitErrorFrame(ws, cmd, { code: err.code, message: err.message });
        return;
      }
      throw err;
    }
  }

  private emitErrorFrame(ws: AgentWS, cmd: AgentCommand, err: { code: string; message: string }): void {
    try {
      ws.send(JSON.stringify({ type: 'agent_command_error', commandId: cmd.commandId, sessionId: cmd.sessionId, code: err.code, message: err.message }));
    } catch {
      /* dead ws */
    }
  }

  private emitCommandAck(ws: AgentWS, sessionId: string, commandId: string, resultSeq: number): void {
    const event: CommandAckEvent = { kind: 'command_ack', commandId, sessionId, resultSeq, ts: Date.now() };
    try {
      ws.send(JSON.stringify({ type: 'agent_event', channel: `agent:${sessionId}`, event }));
    } catch {
      /* dead ws */
    }
  }

  private async dispatch(ws: AgentWS, cmd: AgentCommand): Promise<number | void> {
    try {
      switch (cmd.kind) {
        case 'agent_start': {
          await this.opts.registry.getOrCreate(cmd.sessionId, cmd.cwd ?? this.opts.resolvedCwd);
          this.subscribeAndReplay(ws, cmd.sessionId);
          break;
        }
        case 'agent_resume': {
          const lastSeq = typeof cmd.lastSeq === 'number' ? cmd.lastSeq : 0;
          ws.data.subscriptions.add(`channel:agent:${cmd.sessionId}`);
          const eventLog = this.opts.registry.getEventLog();
          let finalSeq = lastSeq;
          for await (const ev of eventLog.replay(cmd.sessionId, lastSeq)) {
            const seq = (ev as { seq?: number }).seq ?? 0;
            if (seq > finalSeq) finalSeq = seq;
            try {
              ws.send(JSON.stringify({ type: 'historical_event', event: ev, seq }));
            } catch {
              /* dead ws */
            }
          }
          // If replay yielded nothing, fall back to the stored tail seq so the
          // client learns the authoritative last seq even when already current.
          if (finalSeq === lastSeq) {
            const tail = eventLog.getLastSeq(cmd.sessionId);
            if (tail > finalSeq) finalSeq = tail;
          }
          try {
            ws.send(JSON.stringify({ type: 'resume_complete', lastSeq: finalSeq }));
          } catch {
            /* dead ws */
          }
          return finalSeq;
        }
        case 'agent_send': {
          const child = await this.opts.registry.getOrCreate(cmd.sessionId, this.opts.resolvedCwd);
          if (!child.isAlive) {
            this.emitErrorToCaller(ws, cmd.sessionId, 'child', 'agent not alive', true);
            break;
          }
          if (this.opts.reactor) {
            try {
              const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              // Publish the turnId so the projector will reuse it for the
              // upcoming `turn_start`, keeping `checkpoint_created.turnId`
              // and `turn_start.turnId` in sync (see review I1).
              this.opts.registry.setPendingTurnId(cmd.sessionId, turnId);
              await this.opts.reactor.snapshot(cmd.sessionId, this.opts.resolvedCwd, turnId);
            } catch {
              // best-effort: reactor failures must not block the send
            }
          }
          child.writeUserMessage(cmd.text);
          const userEvent: UserMessageEvent = {
            kind: 'user_message',
            sessionId: cmd.sessionId,
            ts: Date.now(),
            messageId: cmd.messageId ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            text: cmd.text,
          };
          this.opts.registry.recordAndDispatch(cmd.sessionId, userEvent);
          break;
        }
        case 'agent_cancel': {
          this.opts.registry.cancelTurn(cmd.sessionId);
          break;
        }
        case 'agent_stop': {
          await this.opts.registry.stop(cmd.sessionId);
          break;
        }
        case 'agent_clear': {
          await this.opts.registry.clear(cmd.sessionId);
          break;
        }
        case 'agent_delete_session': {
          await this.opts.registry.deleteSession(cmd.sessionId);
          break;
        }
        case 'agent_permission_resolve': {
          this.opts.registry.resolvePermission(cmd.sessionId, cmd.promptId, cmd.decision);
          break;
        }
        case 'agent_commit_push_pr': {
          await this.opts.registry.runCommitPushPR(cmd.sessionId, { title: cmd.title, body: cmd.body, draft: cmd.draft });
          break;
        }
        case 'agent_checkpoint_revert': {
          return await this.handleCheckpointRevert(cmd.sessionId, cmd.turnId);
        }
        case 'agent_user_input_respond': {
          const bridge = this.opts.userInputBridge;
          if (!bridge) {
            throw new DispatchError('NO_PENDING_USER_INPUT', 'user input bridge not configured');
          }
          const ok = bridge.respond(cmd.sessionId, cmd.promptId, cmd.value);
          if (!ok) {
            throw new DispatchError('NO_PENDING_USER_INPUT', 'no pending user input for promptId');
          }
          const resolved: UserInputResolvedEvent = {
            kind: 'user_input_resolved',
            sessionId: cmd.sessionId,
            ts: Date.now(),
            promptId: cmd.promptId,
            value: cmd.value,
          };
          const seq = this.opts.registry.recordAndDispatch(cmd.sessionId, resolved);
          return seq;
        }
        case 'agent_set_model':
          return await this.handleAgentSetModel(ws, cmd);
        case 'agent_rename_session':
          return await this.handleAgentRenameSession(ws, cmd);
      }
    } catch (err) {
      if (err instanceof DispatchError) throw err;
      this.emitErrorToCaller(ws, cmd.sessionId, 'child', (err as Error).message ?? String(err), true);
    }
  }

  private async handleAgentSetModel(ws: AgentWS, cmd: AgentSetModelCommand): Promise<number> {
    if (typeof cmd.model !== 'string' || cmd.model.trim().length === 0) {
      throw new DispatchError('INVALID_MODEL', 'model must be non-empty string');
    }
    if (cmd.effort !== undefined && !ALLOWED_EFFORTS.has(cmd.effort)) {
      throw new DispatchError('INVALID_EFFORT', 'unknown effort level');
    }
    const meta = this.opts.registry.getSession(cmd.sessionId);
    if (!meta) throw new DispatchError('UNKNOWN_SESSION', 'unknown session');
    this.opts.registry.setModel(cmd.sessionId, cmd.model, cmd.effort);
    const event: ModelChangedEvent = {
      kind: 'model_changed',
      sessionId: cmd.sessionId,
      ts: Date.now(),
      model: cmd.model,
      effort: cmd.effort,
      seq: 0,
    };
    const seq = this.opts.registry.recordAndDispatch(cmd.sessionId, event) ?? 0;
    this.opts.wsHandler.broadcast({ type: 'sessions_list_invalidated', sessionId: cmd.sessionId });
    return seq;
  }

  private async handleAgentRenameSession(ws: AgentWS, cmd: AgentRenameSessionCommand): Promise<number> {
    const trimmed = typeof cmd.displayName === 'string' ? cmd.displayName.trim() : '';
    if (trimmed.length < 1 || trimmed.length > 128) {
      throw new DispatchError('INVALID_DISPLAY_NAME', '1-128 chars required');
    }
    const meta = this.opts.registry.getSession(cmd.sessionId);
    if (!meta) throw new DispatchError('UNKNOWN_SESSION', 'unknown session');
    this.opts.registry.setDisplayName(cmd.sessionId, trimmed);
    const event: SessionRenamedEvent = {
      kind: 'session_renamed',
      sessionId: cmd.sessionId,
      ts: Date.now(),
      displayName: trimmed,
      seq: 0,
    };
    const seq = this.opts.registry.recordAndDispatch(cmd.sessionId, event) ?? 0;
    this.opts.wsHandler.broadcast({ type: 'sessions_list_invalidated', sessionId: cmd.sessionId });
    return seq;
  }

  private async handleCheckpointRevert(sessionId: string, turnId: string): Promise<number> {
    // Serialize concurrent reverts per session. The second caller sees the
    // checkpoint already deleted and throws CHECKPOINT_NOT_FOUND.
    const prev = this.revertMutex.get(sessionId);
    const run = (async () => {
      if (prev) {
        try { await prev; } catch { /* first revert failed; we still try */ }
      }
      return this.doRevert(sessionId, turnId);
    })();
    this.revertMutex.set(sessionId, run);
    try {
      return await run;
    } finally {
      if (this.revertMutex.get(sessionId) === run) {
        this.revertMutex.delete(sessionId);
      }
    }
  }

  private async doRevert(sessionId: string, turnId: string): Promise<number> {
    const checkpointStore = this.opts.checkpointStore;
    const eventLog = this.opts.eventLog ?? this.opts.registry.getEventLog();
    const gitOps = this.opts.gitOps;
    if (!checkpointStore) {
      throw new DispatchError('CHECKPOINT_NOT_CONFIGURED', 'checkpoint store not configured');
    }

    const cp = checkpointStore.get(sessionId, turnId);
    if (!cp) {
      throw new DispatchError('CHECKPOINT_NOT_FOUND', `no checkpoint for turn ${turnId}`);
    }

    // 2. Quiesce the child: fully stop it (awaits process.exited) before any
    //    log mutation or git restore, so no late child frames slip in between
    //    the truncate and the revert event (see review I3). The next
    //    `agent_send` will re-spawn via getOrCreate.
    await this.opts.registry.stop(sessionId);

    // 3. Pre-revert safety stash (only if git available and in a repo).
    let safetyStashSha: string | undefined;
    const cwd = this.opts.resolvedCwd;
    if (gitOps) {
      try {
        const inRepo = await gitOps.isGitRepo(cwd);
        if (inRepo) {
          const sha = await gitOps.stashCreate(cwd, `cmc:pre-revert:${Date.now()}`);
          if (sha) safetyStashSha = sha;
        }
      } catch {
        // best-effort safety stash; proceed with revert
      }
    }

    // 4. Restore worktree from checkpoint stash.
    //    Treat empty-string stashSha as the 'HEAD' sentinel (no changes) so we
    //    never invoke `git checkout '' -- .` (see review I5).
    if (
      gitOps &&
      cp.stashSha !== 'none' &&
      cp.stashSha !== 'HEAD' &&
      cp.stashSha !== ''
    ) {
      try {
        await gitOps.resetHard(cwd, 'HEAD');
        // Remove post-checkpoint untracked files/dirs so `checkout <sha> -- .`
        // truly yields the pre-turn worktree. Scoped to `cwd` (the session
        // worktree), respects .gitignore (see review I4).
        await gitOps.cleanUntracked(cwd);
        await gitOps.checkoutAll(cwd, cp.stashSha);
      } catch (err) {
        throw new DispatchError('REVERT_FAILED', (err as Error).message ?? String(err));
      }
    }

    // 5. Truncate event log.
    eventLog.deleteFromSeq(sessionId, cp.firstSeq);

    // 6. Truncate checkpoint store.
    checkpointStore.deleteFromSeq(sessionId, cp.firstSeq);

    // 7. Emit CheckpointRevertedEvent as the new tail.
    const event: CheckpointRevertedEvent = {
      kind: 'checkpoint_reverted',
      sessionId,
      ts: Date.now(),
      turnId,
      firstSeq: cp.firstSeq,
      safetyStashSha,
    };
    const seq = this.opts.registry.recordAndDispatch(sessionId, event) ?? 0;
    return seq;
  }

  private subscribeAndReplay(ws: AgentWS, sessionId: string): void {
    ws.data.subscriptions.add(`channel:agent:${sessionId}`);
    const transcript = this.opts.registry.transcriptOf(sessionId);
    const channel = `agent:${sessionId}`;
    for (const event of transcript) {
      try {
        ws.send(JSON.stringify({ type: 'agent_event', channel, event }));
      } catch {
        /* dead ws */
      }
    }
  }

  private emitErrorToCaller(ws: AgentWS, sessionId: string, where: ErrorEvent['where'], message: string, recoverable: boolean): void {
    const event: ErrorEvent = { kind: 'error', sessionId, ts: Date.now(), where, message, recoverable };
    try {
      ws.send(JSON.stringify({ type: 'agent_event', channel: `agent:${sessionId}`, event }));
    } catch {
      /* ignore dead ws */
    }
  }
}
