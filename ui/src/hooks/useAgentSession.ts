import { useEffect, useCallback, useRef } from 'react';
import { ulid } from 'ulid';
import { getWebSocketClient } from '../lib/websocket';
import { useAgentStore } from '../stores/agentStore';
import { useUIStore } from '../stores/uiStore';
import type {
  AgentEvent,
  AgentCommand,
  AgentCommandBody,
  CommandId,
  PermissionDecision,
  PermissionMode,
  UserInputValue,
  EffortLevel,
} from '../types/agent';

export interface CommitPushPRInput {
  title: string;
  body?: string;
  draft?: boolean;
}

export interface UseAgentSessionReturn {
  send: (text: string) => void;
  cancel: (turnId?: string) => void;
  resolvePermission: (promptId: string, decision: PermissionDecision) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  commitPushPR: (input: CommitPushPRInput) => void;
  respondUserInput: (promptId: string, value: UserInputValue) => void;
  revertToCheckpoint: (turnId: string) => void;
  setModel: (model: string, effort?: EffortLevel) => void;
  renameSession: (displayName: string) => void;
}

function mintCommandId(): CommandId {
  try {
    return ulid();
  } catch {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function useAgentSession(sessionId: string | null): UseAgentSessionReturn {
  const clientRef = useRef(getWebSocketClient());
  // Commands queued while disconnected (sent once reconnected).
  const pendingRef = useRef<AgentCommand[]>([]);
  // Commands that have been sent but not yet acked by the server. Keyed by commandId
  // so that reconnects can re-send them and command_ack can drop them.
  const pendingRetriesRef = useRef<Map<CommandId, AgentCommand>>(new Map());
  const agentChatVisible = useUIStore((s) => s.agentChatVisible);
  const applyEvent = useAgentStore((s) => s.applyEvent);

  const sendCmd = useCallback((cmd: AgentCommandBody): CommandId => {
    const commandId = mintCommandId();
    const full: AgentCommand = { ...cmd, commandId } as AgentCommand;
    pendingRetriesRef.current.set(commandId, full);
    const c = clientRef.current;
    const wire = { type: full.kind, ...full };
    if (c.isConnected()) c.send(wire as any);
    else pendingRef.current.push(full);
    return commandId;
  }, []);

  useEffect(() => {
    if (!sessionId || !agentChatVisible) return;
    useAgentStore.getState().reset();
    const channel = `agent:${sessionId}`;
    const client = clientRef.current;

    client.subscribe(channel);
    sendCmd({ kind: 'agent_resume', sessionId });

    const msgSub = client.onMessage((msg: any) => {
      if (msg?.type === 'agent_event' && msg.event) {
        const evt = msg.event as AgentEvent;
        if (evt.sessionId !== sessionId) return;
        if (evt.kind === 'command_ack') {
          pendingRetriesRef.current.delete(evt.commandId);
          return;
        }
        const seq = (evt as unknown as { seq?: number }).seq;
        if (typeof seq === 'number') {
          useAgentStore.getState().updateLastSeenSeq(seq);
        }
        applyEvent(evt);
        return;
      }
      if (msg?.type === 'historical_event' && msg.event) {
        const evt = msg.event as AgentEvent;
        if (evt.sessionId !== sessionId) return;
        const seq = typeof msg.seq === 'number'
          ? msg.seq
          : (evt as unknown as { seq?: number }).seq;
        if (typeof seq === 'number') {
          useAgentStore.getState().updateLastSeenSeq(seq);
        }
        useAgentStore.getState().applyEvent(evt, { historical: true });
        return;
      }
      if (msg?.type === 'resume_complete') {
        if (typeof msg.lastSeq === 'number') {
          useAgentStore.getState().updateLastSeenSeq(msg.lastSeq);
        }
        useAgentStore.getState().setHistoricalDone(true);
        return;
      }
    });

    const connectSub = client.onConnect(() => {
      client.subscribe(channel);
      // Send agent_resume directly (fresh commandId) — do not reuse retry buffer for resume.
      const lastSeq = useAgentStore.getState().lastSeenSeq ?? 0;
      const resumeCmd: AgentCommand = {
        kind: 'agent_resume',
        sessionId,
        commandId: mintCommandId(),
      };
      pendingRetriesRef.current.set(resumeCmd.commandId!, resumeCmd);
      client.send({ type: resumeCmd.kind, ...resumeCmd, lastSeq } as any);

      // Flush disconnect-queued commands.
      const queued = pendingRef.current;
      pendingRef.current = [];
      for (const cmd of queued) client.send({ type: cmd.kind, ...cmd } as any);

      // Re-send anything still awaiting an ack.
      for (const [, cmd] of pendingRetriesRef.current) {
        if (cmd.commandId === resumeCmd.commandId) continue;
        client.send({ type: cmd.kind, ...cmd } as any);
      }
    });

    return () => {
      msgSub.unsubscribe();
      connectSub.unsubscribe();
      client.unsubscribe(channel);
    };
  }, [sessionId, agentChatVisible, applyEvent, sendCmd]);

  const send = useCallback(
    (text: string) => {
      if (!sessionId) return;
      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      useAgentStore.getState().send(text, id);
      sendCmd({ kind: 'agent_send', sessionId, text, messageId: id });
    },
    [sessionId, sendCmd],
  );

  const cancel = useCallback(
    (turnId?: string) => {
      if (!sessionId) return;
      sendCmd({ kind: 'agent_cancel', sessionId, turnId });
    },
    [sessionId, sendCmd],
  );

  const resolvePermission = useCallback(
    (promptId: string, decision: PermissionDecision) => {
      if (!sessionId) return;
      useAgentStore.getState().resolvePermission(sessionId, promptId, decision);
      sendCmd({ kind: 'agent_permission_resolve', sessionId, promptId, decision });
    },
    [sessionId, sendCmd],
  );

  const setPermissionMode = useCallback(
    (mode: PermissionMode) => {
      if (!sessionId) return;
      // Legacy permission-mode command alias was removed; this now only
      // updates local optimistic state. Use setRuntimeMode / setInteractionMode
      // for the split replacements wired to WS.
      useAgentStore.getState().setPermissionMode(sessionId, mode);
    },
    [sessionId],
  );

  const commitPushPR = useCallback(
    (input: CommitPushPRInput) => {
      if (!sessionId) return;
      // Optimistically mark commit in-flight; server events will unset later.
      useAgentStore.setState({ commitInFlight: true });
      sendCmd({
        kind: 'agent_commit_push_pr',
        sessionId,
        title: input.title,
        body: input.body,
        draft: input.draft,
      });
    },
    [sessionId, sendCmd],
  );

  const respondUserInput = useCallback(
    (promptId: string, value: UserInputValue) => {
      if (!sessionId) return;
      sendCmd({ kind: 'agent_user_input_respond', sessionId, promptId, value });
    },
    [sessionId, sendCmd],
  );

  const revertToCheckpoint = useCallback(
    (turnId: string) => {
      if (!sessionId) return;
      sendCmd({ kind: 'agent_checkpoint_revert', sessionId, turnId });
    },
    [sessionId, sendCmd],
  );

  const setModel = useCallback((model: string, effort?: EffortLevel) => {
    if (!sessionId) return;
    sendCmd({ kind: 'agent_set_model', sessionId, model, ...(effort !== undefined ? { effort } : {}) });
  }, [sessionId, sendCmd]);

  const renameSession = useCallback((displayName: string) => {
    if (!sessionId) return;
    sendCmd({ kind: 'agent_rename_session', sessionId, displayName });
  }, [sessionId, sendCmd]);

  return {
    send,
    cancel,
    resolvePermission,
    setPermissionMode,
    commitPushPR,
    respondUserInput,
    revertToCheckpoint,
    setModel,
    renameSession,
  };
}
