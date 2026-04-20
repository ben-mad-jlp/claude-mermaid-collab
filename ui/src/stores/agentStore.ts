import { create } from 'zustand';
import type {
  AgentEvent,
  PermissionMode,
  PermissionDecision,
  SessionWorktree,
  RuntimeMode,
  InteractionMode,
} from '../types/agent';
import { splitPermissionMode } from '../types/agent';

const MODE_V2_STORAGE_KEY = 'cmc:mode:v2';
const MODE_V1_STORAGE_KEY = 'cmc:permission-mode';

interface PersistedModeV2 {
  runtime: RuntimeMode;
  interaction: InteractionMode;
}

function hydrateModes(): PersistedModeV2 {
  const fallback: PersistedModeV2 = { runtime: 'edit', interaction: 'ask' };
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const legacy = localStorage.getItem(MODE_V1_STORAGE_KEY);
    if (legacy) {
      const split = splitPermissionMode(legacy as PermissionMode);
      const migrated: PersistedModeV2 = split;
      try {
        localStorage.setItem(MODE_V2_STORAGE_KEY, JSON.stringify(migrated));
        localStorage.removeItem(MODE_V1_STORAGE_KEY);
      } catch {
        // ignore write failures
      }
      return migrated;
    }
    const raw = localStorage.getItem(MODE_V2_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedModeV2>;
      if (parsed && parsed.runtime && parsed.interaction) {
        return { runtime: parsed.runtime, interaction: parsed.interaction };
      }
    }
  } catch {
    // ignore parse/read failures, fall through to default
  }
  return fallback;
}

function persistModes(modes: PersistedModeV2): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(MODE_V2_STORAGE_KEY, JSON.stringify(modes));
  } catch {
    // ignore write failures
  }
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  historical?: boolean;
  turnId?: string;
}

export interface ProgressChunk {
  channel: 'stdout' | 'stderr';
  chunk: string;
  seq: number;
}

export interface AgentToolCallItem {
  type: 'tool_call';
  id: string;
  turnId?: string;
  name: string;
  input: unknown;
  status: 'running' | 'ok' | 'error' | 'canceled';
  output?: unknown;
  progress: ProgressChunk[];
  startTs: number;
  endTs?: number;
  error?: string;
  historical?: boolean;
  index?: number;
}

export interface AgentPermissionItem {
  type: 'permission';
  id: string; // promptId
  toolUseId: string;
  turnId: string;
  name: string;
  input: unknown;
  status: 'pending' | 'allowed' | 'denied' | 'timeout';
  decision?: PermissionDecision;
  deadlineMs: number;
  ts: number;
  resolvedBy?: 'user' | 'session_allowlist' | 'mode_auto' | 'worktree_auto' | 'timeout';
}

export type AgentTimelineItem =
  | (AgentMessage & { type: 'message' })
  | AgentToolCallItem
  | AgentPermissionItem;

export interface CompactionEntry {
  seq?: number;
  ts: number;
  tokensBefore: number;
  tokensAfter: number;
  messagesRetained: number;
  /** id of the last timeline item at the time this compaction arrived (null when first) */
  afterTimelineId: string | null;
}

interface DeltaBuffer {
  nextIndex: number;
  pending: Map<number, string>;
}

export interface PendingUserInputItem {
  promptId: string;
  sessionId: string;
  prompt: string;
  expectedKind: 'text' | 'choice';
  choices?: Array<{ id: string; label: string }>;
  deadlineMs: number;
  ts: number;
}

interface AgentState {
  timeline: AgentTimelineItem[];
  pendingUserInputs: Record<string, PendingUserInputItem>;
  currentTurnId: string | null;
  streamingMessageId: string | null;
  claudeSessionId: string | null;
  cwd: string | null;
  ready: boolean;
  resumed: boolean;
  lastError: string | null;
  usage: { inputTokens: number; outputTokens: number; costUsd?: number } | null;
  deltaBuffers: Record<string, DeltaBuffer>;
  permissionMode: PermissionMode;
  runtimeMode: RuntimeMode;
  interactionMode: InteractionMode;
  pendingPromptCount: number;
  worktree: SessionWorktree | null;
  worktreeDirty: boolean;
  commitInFlight: boolean;
  thinkingBlocks: Record<string, string>;
  nestedTimelines: Record<string, string[]>;
  trustedTools: string[];
  multiSession: {
    activeSessionId: string | null;
    sessions: Record<string, { name: string; unread: number }>;
  };
  userMessageHistory: string[];
  prStatus: Record<string, { number: number; url: string; checks?: string; reviews?: string }>;
  attachments: Record<string, Array<{ attachmentId: string; mimeType: string; url: string; sizeBytes: number }>>;
  lastSeenSeq: number | null;
  historicalDone: boolean;
  checkpointsByTurn: Record<string, { firstSeq: number; stashSha: string }>;
  compactions: CompactionEntry[];
  thinkingByTurn: Record<string, string>;
  modelByTurn: Record<string, string>;
}

interface AgentActions {
  applyEvent: (event: AgentEvent, opts?: { historical?: boolean }) => void;
  updateLastSeenSeq: (seq: number) => void;
  setHistoricalDone: (b: boolean) => void;
  send: (text: string, id?: string) => void;
  cancel: () => void;
  resume: () => void;
  resolvePermission: (sessionId: string, promptId: string, decision: PermissionDecision) => void;
  setPermissionMode: (sessionId: string, mode: PermissionMode) => void;
  setRuntimeMode: (mode: RuntimeMode) => void;
  setInteractionMode: (mode: InteractionMode) => void;
  appendThinking: (turnId: string, chunk: string) => void;
  setThinking: (turnId: string, text: string) => void;
  addNested: (parentTurnId: string, childTurnId: string) => void;
  setTrustedTools: (list: string[]) => void;
  revokeTrusted: (name: string) => void;
  addSession: (sessionId: string, name: string) => void;
  setActive: (sessionId: string | null) => void;
  markRead: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
  pushUserMessage: (text: string) => void;
  recallUserMessage: (index: number) => string | undefined;
  setPRStatus: (sessionId: string, status: { number: number; url: string; checks?: string; reviews?: string }) => void;
  clearPRStatus: (sessionId: string) => void;
  addAttachment: (sessionId: string, attachment: { attachmentId: string; mimeType: string; url: string; sizeBytes: number }) => void;
  removeAttachment: (sessionId: string, attachmentId: string) => void;
  reset: () => void;
  messages: () => AgentMessage[];
  isStreaming: () => boolean;
}

const initialState: AgentState = {
  timeline: [],
  pendingUserInputs: {},
  currentTurnId: null,
  streamingMessageId: null,
  claudeSessionId: null,
  cwd: null,
  ready: false,
  resumed: false,
  lastError: null,
  usage: null,
  deltaBuffers: {},
  permissionMode: 'supervised',
  runtimeMode: 'edit',
  interactionMode: 'ask',
  pendingPromptCount: 0,
  worktree: null,
  worktreeDirty: false,
  commitInFlight: false,
  thinkingBlocks: {},
  nestedTimelines: {},
  trustedTools: [],
  multiSession: { activeSessionId: null, sessions: {} },
  userMessageHistory: [],
  prStatus: {},
  attachments: {},
  lastSeenSeq: null,
  historicalDone: false,
  checkpointsByTurn: {},
  compactions: [],
  thinkingByTurn: {},
  modelByTurn: {},
};

const hydratedModes = hydrateModes();

export const useAgentStore = create<AgentState & AgentActions>((set, get) => ({
  ...initialState,
  runtimeMode: hydratedModes.runtime,
  interactionMode: hydratedModes.interaction,

  applyEvent: (event, opts) => {
    // Advance lastSeenSeq if this event carries a seq (server ordering).
    const evSeq = (event as unknown as { seq?: number }).seq;
    if (typeof evSeq === 'number' && Number.isFinite(evSeq)) {
      const cur = get().lastSeenSeq;
      if (cur === null || evSeq > cur) set({ lastSeenSeq: evSeq });
    }
    // If replayed as historical, tag the event so downstream handlers mark items.
    if (opts?.historical === true) {
      event = { ...(event as object), historical: true } as AgentEvent;
    }
    switch (event.kind) {
      case 'session_started': {
        set({
          ready: true,
          claudeSessionId: event.claudeSessionId,
          cwd: event.cwd,
          resumed: event.resumed,
          lastError: null,
        });
        return;
      }
      case 'user_message': {
        const timeline = get().timeline;
        if (timeline.some((t) => t.type === 'message' && (t as AgentMessage).id === event.messageId)) return;
        const historical = (event as unknown as { historical?: boolean }).historical;
        set({
          timeline: [
            ...timeline,
            {
              type: 'message',
              id: event.messageId,
              role: 'user',
              text: event.text,
              ...(historical ? { historical: true } : {}),
            },
          ],
        });
        return;
      }
      case 'turn_start': {
        // Backfill replays historical turns with ids prefixed `hist-`; don't let
        // those flip currentTurnId (would cause a brief flicker in the UI).
        if (typeof event.turnId === 'string' && event.turnId.startsWith('hist-')) return;
        set({ currentTurnId: event.turnId, streamingMessageId: null });
        return;
      }
      case 'assistant_delta': {
        const { timeline, deltaBuffers } = get();
        const msgId = event.messageId;
        let items = timeline;
        let bufs = { ...deltaBuffers };
        const existing = items.find((t) => t.type === 'message' && (t as AgentMessage).id === msgId);
        if (!existing) {
          items = [...items, { type: 'message', id: msgId, role: 'assistant', text: '', turnId: event.turnId }];
          bufs[msgId] = { nextIndex: 0, pending: new Map() };
        } else if (!bufs[msgId]) {
          bufs[msgId] = { nextIndex: 0, pending: new Map() };
        }
        const buf = bufs[msgId];
        if (event.index === buf.nextIndex) {
          let appended = event.text;
          buf.nextIndex++;
          while (buf.pending.has(buf.nextIndex)) {
            appended += buf.pending.get(buf.nextIndex)!;
            buf.pending.delete(buf.nextIndex);
            buf.nextIndex++;
          }
          items = items.map((t) =>
            t.type === 'message' && (t as AgentMessage).id === msgId
              ? { ...(t as AgentMessage & { type: 'message' }), text: (t as AgentMessage).text + appended }
              : t,
          );
        } else {
          buf.pending.set(event.index, event.text);
        }
        set({ timeline: items, deltaBuffers: bufs, streamingMessageId: msgId });
        return;
      }
      case 'assistant_message_complete': {
        const { timeline, deltaBuffers } = get();
        const existing = timeline.find(
          (t) => t.type === 'message' && (t as AgentMessage).id === event.messageId,
        ) as (AgentMessage & { type: 'message' }) | undefined;
        // Backfill replay guard: if we already have a live (non-historical)
        // version of this message, ignore a historical duplicate from resume().
        if (existing && !existing.historical && event.historical) {
          return;
        }
        const items: AgentTimelineItem[] = existing
          ? timeline.map((t) =>
              t.type === 'message' && (t as AgentMessage).id === event.messageId
                ? {
                    ...(t as AgentMessage & { type: 'message' }),
                    text: event.text,
                    historical: event.historical,
                    turnId: event.turnId,
                  }
                : t,
            )
          : [
              ...timeline,
              {
                type: 'message' as const,
                id: event.messageId,
                role: 'assistant' as const,
                text: event.text,
                historical: event.historical,
                turnId: event.turnId,
              },
            ];
        const { [event.messageId]: _, ...restBufs } = deltaBuffers;
        set({ timeline: items, deltaBuffers: restBufs });
        return;
      }
      case 'turn_end': {
        // Backfill replays produce hist- turn ids; skip so they don't reset
        // streamingMessageId or usage for the live turn.
        if (typeof event.turnId === 'string' && event.turnId.startsWith('hist-')) return;
        const cur = get().currentTurnId;
        set({
          streamingMessageId: null,
          usage: event.usage ?? get().usage,
          currentTurnId: cur === event.turnId ? null : cur,
        });
        return;
      }
      case 'session_ended': {
        // Cancel sends SIGINT to the Claude CLI, which exits (reason: 'exit').
        // The server transparently respawns via --resume on the next agent_send,
        // so keep `ready` truthy and let the input stay enabled. Only a 'error'
        // reason (spawn failure, etc.) should gate input until the user retries.
        const isFatal = event.reason === 'error';
        set({
          ready: isFatal ? false : get().ready,
          streamingMessageId: null,
          currentTurnId: null,
          lastError: isFatal ? `session ended (code ${event.code ?? '?'})` : get().lastError,
        });
        return;
      }
      case 'error': {
        set({ lastError: event.message });
        return;
      }
      case 'tool_call_started': {
        const { timeline } = get();
        if (timeline.some((t) => t.type === 'tool_call' && t.id === event.toolUseId)) return;
        set({
          timeline: [
            ...timeline,
            {
              type: 'tool_call',
              id: event.toolUseId,
              turnId: event.turnId,
              name: event.name,
              input: event.input,
              status: 'running',
              progress: [],
              startTs: event.ts,
              historical: event.historical,
              index: event.index,
            },
          ],
        });
        return;
      }
      case 'tool_call_progress': {
        const { timeline } = get();
        const idx = timeline.findIndex((t) => t.type === 'tool_call' && t.id === event.toolUseId);
        if (idx < 0) return;
        const item = timeline[idx] as AgentToolCallItem;
        const chunk: ProgressChunk = { channel: event.channel, chunk: event.chunk, seq: event.seq };
        const progress = [...item.progress];
        let insertAt = progress.length;
        for (let i = 0; i < progress.length; i++) {
          if (progress[i].seq > chunk.seq) {
            insertAt = i;
            break;
          }
          if (progress[i].seq === chunk.seq) return;
        }
        progress.splice(insertAt, 0, chunk);
        const next = [...timeline];
        next[idx] = { ...item, progress };
        set({ timeline: next });
        return;
      }
      case 'tool_call_completed': {
        const { timeline } = get();
        const idx = timeline.findIndex((t) => t.type === 'tool_call' && t.id === event.toolUseId);
        if (idx < 0) return;
        const item = timeline[idx] as AgentToolCallItem;
        if (!item.historical && event.historical) return;
        const next = [...timeline];
        next[idx] = {
          ...item,
          status: event.status,
          output: event.output,
          error: event.error,
          endTs: event.ts,
          historical: event.historical ?? item.historical,
        };
        set({ timeline: next });
        return;
      }
      case 'sub_agent_turn': {
        // Associate the child turnId with its parent Task's tool call so the
        // TaskView can render a nested timeline for the subagent.
        const cur = get().nestedTimelines;
        const list = cur[event.parentTurnId] ?? [];
        if (list.includes(event.turnId)) return;
        set({ nestedTimelines: { ...cur, [event.parentTurnId]: [...list, event.turnId] } });
        return;
      }
      case 'permission_requested': {
        const { timeline, pendingPromptCount } = get();
        if (
          timeline.some(
            (t) => t.type === 'permission' && (t as AgentPermissionItem).id === event.promptId,
          )
        ) {
          return;
        }
        const item: AgentPermissionItem = {
          type: 'permission',
          id: event.promptId,
          toolUseId: event.toolUseId,
          turnId: event.turnId,
          name: event.name,
          input: event.input,
          status: 'pending',
          deadlineMs: event.deadlineMs,
          ts: event.ts,
        };
        set({
          timeline: [...timeline, item],
          pendingPromptCount: pendingPromptCount + 1,
        });
        return;
      }
      case 'permission_resolved': {
        const { timeline, pendingPromptCount } = get();
        const idx = timeline.findIndex(
          (t) => t.type === 'permission' && (t as AgentPermissionItem).id === event.promptId,
        );
        if (idx < 0) return;
        const prev = timeline[idx] as AgentPermissionItem;
        const newStatus: AgentPermissionItem['status'] =
          event.decision === 'deny'
            ? 'denied'
            : event.decision === 'timeout' || event.resolvedBy === 'timeout'
              ? 'timeout'
              : 'allowed';
        const updated: AgentPermissionItem = {
          ...prev,
          status: newStatus,
          resolvedBy: event.resolvedBy,
        };
        if (event.decision !== 'timeout' && event.resolvedBy !== 'timeout') {
          updated.decision = event.decision as PermissionDecision;
        }
        const next = [...timeline];
        next[idx] = updated;
        const wasPending = prev.status === 'pending';
        set({
          timeline: next,
          pendingPromptCount: wasPending
            ? Math.max(0, pendingPromptCount - 1)
            : pendingPromptCount,
        });
        return;
      }
      case 'worktree_info': {
        set({ worktree: event.info, worktreeDirty: event.dirty });
        return;
      }
      case 'user_input_requested': {
        const cur = get().pendingUserInputs;
        if (cur[event.promptId]) return;
        set({
          pendingUserInputs: {
            ...cur,
            [event.promptId]: {
              promptId: event.promptId,
              sessionId: event.sessionId,
              prompt: event.prompt,
              expectedKind: event.expectedKind,
              choices: event.choices,
              deadlineMs: event.deadlineMs,
              ts: event.ts,
            },
          },
        });
        return;
      }
      case 'user_input_resolved': {
        const cur = get().pendingUserInputs;
        if (!cur[event.promptId]) return;
        const { [event.promptId]: _, ...rest } = cur;
        set({ pendingUserInputs: rest });
        return;
      }
      case 'checkpoint_created': {
        const cur = get().checkpointsByTurn;
        if (cur[event.turnId]) return;
        set({
          checkpointsByTurn: {
            ...cur,
            [event.turnId]: { firstSeq: event.firstSeq, stashSha: event.stashSha },
          },
        });
        return;
      }
      case 'session_cleared': {
        // Reset stale per-session state. Preserve completed messages (timeline
        // messages remain; streaming/pending state is cleared).
        set({
          currentTurnId: null,
          streamingMessageId: null,
          pendingUserInputs: {},
          thinkingByTurn: {},
          thinkingBlocks: {},
          modelByTurn: {},
          compactions: [],
          deltaBuffers: {},
          pendingPromptCount: 0,
        });
        return;
      }
      case 'compaction': {
        const { timeline, compactions } = get();
        const last = timeline.length > 0 ? timeline[timeline.length - 1].id : null;
        const entry: CompactionEntry = {
          seq: (event as unknown as { seq?: number }).seq,
          ts: event.ts,
          tokensBefore: event.tokensBefore,
          tokensAfter: event.tokensAfter,
          messagesRetained: event.messagesRetained,
          afterTimelineId: last,
        };
        set({ compactions: [...compactions, entry] });
        return;
      }
      case 'assistant_thinking': {
        const cur = get().thinkingByTurn;
        const prev = cur[event.turnId] ?? '';
        const next = event.delta === true ? prev + event.text : event.text;
        set({ thinkingByTurn: { ...cur, [event.turnId]: next } });
        return;
      }
      case 'model_change': {
        const cur = get().modelByTurn;
        if (cur[event.turnId] === event.model) return;
        set({ modelByTurn: { ...cur, [event.turnId]: event.model } });
        return;
      }
      case 'checkpoint_reverted': {
        const cur = get().checkpointsByTurn;
        const next: Record<string, { firstSeq: number; stashSha: string }> = {};
        for (const [tid, entry] of Object.entries(cur)) {
          if (entry.firstSeq < event.firstSeq) next[tid] = entry;
        }
        set({ checkpointsByTurn: next });
        return;
      }
      default: {
        // eslint-disable-next-line no-console
        console.warn('[agentStore] unknown event kind', event);
      }
    }
  },

  updateLastSeenSeq: (seq) => {
    if (!Number.isFinite(seq)) return;
    const cur = get().lastSeenSeq;
    if (cur === null || seq > cur) set({ lastSeenSeq: seq });
  },

  setHistoricalDone: (b) => set({ historicalDone: b }),

  send: (text, id) => {
    const msgId =
      id ??
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    const existing = get().timeline;
    if (existing.some((t) => t.type === 'message' && (t as AgentMessage).id === msgId)) return;
    set({ timeline: [...existing, { type: 'message', id: msgId, role: 'user', text }] });
  },

  cancel: () => {
    // Stub — useAgentSession hook will send WS agent_cancel (Wave 4).
  },

  resume: () => {
    // Stub — useAgentSession hook will send WS agent_resume (Wave 4).
  },

  resolvePermission: (_sessionId, _promptId, _decision) => {
    // Stub — useAgentSession hook will send WS agent_permission_resolve.
  },

  setPermissionMode: (_sessionId, mode) => {
    // Optimistically update local mode. The legacy WS command was removed in
    // the w3 cutover; callers should use setRuntimeMode/setInteractionMode.
    set({ permissionMode: mode });
  },

  setRuntimeMode: (mode) => {
    const interaction = get().interactionMode;
    set({ runtimeMode: mode });
    persistModes({ runtime: mode, interaction });
  },

  setInteractionMode: (mode) => {
    const runtime = get().runtimeMode;
    set({ interactionMode: mode });
    persistModes({ runtime, interaction: mode });
  },

  appendThinking: (turnId, chunk) => {
    const cur = get().thinkingBlocks;
    set({ thinkingBlocks: { ...cur, [turnId]: (cur[turnId] ?? '') + chunk } });
  },
  setThinking: (turnId, text) => {
    set({ thinkingBlocks: { ...get().thinkingBlocks, [turnId]: text } });
  },
  addNested: (parentTurnId, childTurnId) => {
    const cur = get().nestedTimelines;
    const list = cur[parentTurnId] ?? [];
    if (list.includes(childTurnId)) return;
    set({ nestedTimelines: { ...cur, [parentTurnId]: [...list, childTurnId] } });
  },
  setTrustedTools: (list) => set({ trustedTools: [...list] }),
  revokeTrusted: (name) => set({ trustedTools: get().trustedTools.filter((n) => n !== name) }),
  addSession: (sessionId, name) => {
    const ms = get().multiSession;
    if (ms.sessions[sessionId]) return;
    set({ multiSession: { ...ms, sessions: { ...ms.sessions, [sessionId]: { name, unread: 0 } } } });
  },
  setActive: (sessionId) => {
    set({ multiSession: { ...get().multiSession, activeSessionId: sessionId } });
  },
  markRead: (sessionId) => {
    const ms = get().multiSession;
    const s = ms.sessions[sessionId];
    if (!s) return;
    set({ multiSession: { ...ms, sessions: { ...ms.sessions, [sessionId]: { ...s, unread: 0 } } } });
  },
  removeSession: (sessionId) => {
    const ms = get().multiSession;
    const { [sessionId]: _, ...rest } = ms.sessions;
    set({
      multiSession: {
        activeSessionId: ms.activeSessionId === sessionId ? null : ms.activeSessionId,
        sessions: rest,
      },
    });
  },
  pushUserMessage: (text) => {
    const hist = get().userMessageHistory;
    const next = [...hist, text];
    if (next.length > 50) next.splice(0, next.length - 50);
    set({ userMessageHistory: next });
  },
  recallUserMessage: (index) => {
    const hist = get().userMessageHistory;
    return hist[index];
  },
  setPRStatus: (sessionId, status) => {
    set({ prStatus: { ...get().prStatus, [sessionId]: status } });
  },
  clearPRStatus: (sessionId) => {
    const { [sessionId]: _, ...rest } = get().prStatus;
    set({ prStatus: rest });
  },
  addAttachment: (sessionId, attachment) => {
    const cur = get().attachments;
    const list = cur[sessionId] ?? [];
    set({ attachments: { ...cur, [sessionId]: [...list, attachment] } });
  },
  removeAttachment: (sessionId, attachmentId) => {
    const cur = get().attachments;
    const list = (cur[sessionId] ?? []).filter((a) => a.attachmentId !== attachmentId);
    set({ attachments: { ...cur, [sessionId]: list } });
  },

  reset: () => set({ ...initialState, deltaBuffers: {} }),

  messages: () =>
    get().timeline.filter(
      (t): t is AgentMessage & { type: 'message' } => t.type === 'message',
    ),
  isStreaming: () => {
    const { streamingMessageId, timeline } = get();
    if (streamingMessageId != null) return true;
    return timeline.some((t) => t.type === 'tool_call' && t.status === 'running');
  },
}));

if (typeof window !== 'undefined') {
  (window as unknown as { __AGENT_STORE__: typeof useAgentStore }).__AGENT_STORE__ = useAgentStore;
}
