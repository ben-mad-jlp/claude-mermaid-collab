import type { ServerWebSocket } from 'bun';
import type { AgentCommand, AgentEvent, UserMessageEvent, ErrorEvent, CommandAckEvent } from './contracts.ts';
import type { AgentSessionRegistry } from './session-registry.ts';
import type { WebSocketHandler } from '../websocket/handler.ts';
import { CommandReceiptsStore, hashCommand } from './command-receipts.ts';

type AgentWS = ServerWebSocket<{ subscriptions: Set<string> }>;

const RECEIPT_TTL_MS = 10 * 60 * 1000;

export class AgentDispatcher {
  private receipts: CommandReceiptsStore;

  constructor(private opts: { registry: AgentSessionRegistry; wsHandler: WebSocketHandler; resolvedCwd: string; receipts?: CommandReceiptsStore }) {
    this.receipts = opts.receipts ?? new CommandReceiptsStore(opts.resolvedCwd, { isProjectRoot: true });
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
      // pending (crash recovery scenario): fall through and try again
    } else {
      this.receipts.insertPending(cmd as { commandId: string }, payloadHash, Date.now() + RECEIPT_TTL_MS);
    }

    try {
      const resultSeq = (await this.dispatch(ws, cmd)) ?? 0;
      this.receipts.markAccepted(commandId, resultSeq);
      this.emitCommandAck(ws, cmd.sessionId, commandId, resultSeq);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      this.receipts.markRejected(commandId, msg);
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
        case 'agent_set_permission_mode': {
          this.opts.registry.setPermissionMode(cmd.sessionId, cmd.mode);
          break;
        }
        case 'agent_commit_push_pr': {
          await this.opts.registry.runCommitPushPR(cmd.sessionId, { title: cmd.title, body: cmd.body, draft: cmd.draft });
          break;
        }
      }
    } catch (err) {
      this.emitErrorToCaller(ws, cmd.sessionId, 'child', (err as Error).message ?? String(err), true);
    }
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
