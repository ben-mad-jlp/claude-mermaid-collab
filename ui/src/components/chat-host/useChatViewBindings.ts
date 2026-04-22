import * as React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore, type AgentTimelineItem, type PendingUserInputItem } from '@/stores/agentStore';
import type { UserInputValue } from '@/types/agent';
import { useComposerDraftStore } from '@/stores/composerDraftStore';
import { useAgentSession } from '@/hooks/useAgentSession';
import type { ChatViewProps } from '@/vendored/t3chat/ChatView';
import type { TimelineItem } from '@/vendored/t3chat/chat/MessagesTimeline.logic';
import type { PendingApproval } from '@/vendored/t3chat/chat/ComposerPendingApprovalPanel';
import type { ComposerSerialized } from '@/vendored/t3chat/chat/composer-editor-serialize';
import type { ChatMessageAttachment } from '@/types/agent';

const DEFAULT_CONTEXT_TOTAL = 200_000;

function mapToTimelineItem(it: AgentTimelineItem): TimelineItem {
  if (it.type === 'tool_call') {
    return { id: it.id, kind: 'tool_call', turnId: it.turnId };
  }
  if (it.type === 'permission') {
    return { id: it.id, kind: 'permission', turnId: it.turnId };
  }
  return { id: it.id, kind: 'message', turnId: it.turnId, role: it.role };
}

function summarizeArgs(name: string, input: unknown): string | undefined {
  if (input == null || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  const pickString = (key: string): string | undefined => {
    const v = obj[key];
    return typeof v === 'string' ? v : undefined;
  };
  // Per-tool hints for the most common / loudest tools.
  switch (name) {
    case 'Bash': {
      const cmd = pickString('command');
      if (cmd) return cmd.length > 80 ? cmd.slice(0, 80) + '…' : cmd;
      return undefined;
    }
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit': {
      const p = pickString('file_path') ?? pickString('path');
      return p;
    }
    case 'Grep':
    case 'Glob': {
      return pickString('pattern');
    }
    case 'WebFetch':
    case 'WebSearch': {
      return pickString('url') ?? pickString('query');
    }
    case 'Task': {
      return pickString('description') ?? pickString('subagent_type');
    }
    case 'TodoWrite':
      return undefined;
  }
  // Generic: show the first string-valued field.
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.length > 0) {
      const text = `${k}: ${v}`;
      return text.length > 80 ? text.slice(0, 80) + '…' : text;
    }
  }
  return undefined;
}

function findPending(items: readonly AgentTimelineItem[]): PendingApproval | null {
  let count = 0;
  let first: PendingApproval | null = null;
  for (const it of items) {
    if (it.type === 'permission' && it.status === 'pending') {
      count++;
      if (!first) {
        const summary = summarizeArgs(it.name, it.input);
        first = {
          promptId: it.id,
          toolName: it.name,
          input: it.input,
          ...(summary ? { summary } : {}),
        };
      }
    }
  }
  if (!first) return null;
  if (count > 1) {
    const extra = ` (+${count - 1} more pending)`;
    return {
      ...first,
      summary: (first.summary ?? '') + extra,
    };
  }
  return first;
}

export interface ChatViewBindingsArgs {
  sessionId: string;
  renderItem: (item: AgentTimelineItem) => React.ReactNode;
  renderTurnSeparator?: (turnId: string, isFirst: boolean) => React.ReactNode;
  header?: React.ReactNode;
  banner?: React.ReactNode;
  rail?: React.ReactNode;
}

export function useChatViewBindings(args: ChatViewBindingsArgs): ChatViewProps {
  const { sessionId, renderItem, renderTurnSeparator, header, banner, rail } = args;

  const store = useAgentStore(
    useShallow((s) => ({
      timeline: s.timeline,
      streamingMessageId: s.streamingMessageId,
      usage: s.usage,
      pendingUserInputs: s.pendingUserInputs,
      checkpointsByTurn: s.checkpointsByTurn,
      currentTurnId: s.currentTurnId,
      compactions: s.compactions,
      thinkingByTurn: s.thinkingByTurn,
      modelByTurn: s.modelByTurn,
    }))
  );

  const draft = useComposerDraftStore((s) => s.drafts[sessionId]) ?? {
    editorStateJson: null,
    plain: '',
    attachments: [],
  };
  const setDraft = useComposerDraftStore((s) => s.setDraft);
  const clearDraft = useComposerDraftStore((s) => s.clearDraft);

  const session = useAgentSession(sessionId);

  const items: TimelineItem[] = React.useMemo(
    () => store.timeline.map(mapToTimelineItem),
    [store.timeline]
  );

  const renderMapped = React.useCallback(
    (mapped: TimelineItem) => {
      const original = store.timeline.find((t) => t.id === mapped.id);
      return original ? renderItem(original) : null;
    },
    [store.timeline, renderItem]
  );

  const pending = React.useMemo(() => findPending(store.timeline), [store.timeline]);

  const isStreaming = store.streamingMessageId !== null;

  const onSend = React.useCallback(
    (text: string) => {
      if (!text.trim()) return;
      session.send(text);
      clearDraft(sessionId);
    },
    [session, clearDraft, sessionId]
  );

  const onSendSerialized = React.useCallback(
    (serialized: ComposerSerialized) => {
      const { text, attachments } = serialized;
      const typedAttachments: ChatMessageAttachment[] | undefined =
        attachments && attachments.length > 0
          ? attachments.map((a) => ({ attachmentId: a.attachmentId, mimeType: a.mimeType }))
          : undefined;
      session.send(text, typedAttachments);
      clearDraft(sessionId);
    },
    [session, clearDraft, sessionId]
  );

  const onChange = React.useCallback(
    (v: string) => setDraft(sessionId, { plain: v }),
    [setDraft, sessionId]
  );

  const onCancel = React.useCallback(() => session.cancel(), [session]);

  const onApprovalAllow = React.useCallback(
    (promptId: string) => session.resolvePermission(promptId, 'allow_once'),
    [session]
  );
  const onApprovalDeny = React.useCallback(
    (promptId: string) => session.resolvePermission(promptId, 'deny'),
    [session]
  );

  const contextUsed =
    store.usage != null ? store.usage.inputTokens + store.usage.outputTokens : undefined;

  const pendingUserInput: PendingUserInputItem | null = React.useMemo(() => {
    const entries = Object.values(store.pendingUserInputs);
    if (entries.length === 0) return null;
    // First pending (oldest by ts).
    return entries.reduce((a, b) => (a.ts <= b.ts ? a : b));
  }, [store.pendingUserInputs]);

  const onRespondUserInput = React.useCallback(
    (promptId: string, value: UserInputValue) => session.respondUserInput(promptId, value),
    [session],
  );

  const onRevertToCheckpoint = React.useCallback(
    (turnId: string) => session.revertToCheckpoint(turnId),
    [session],
  );

  const onRewindToMessage = React.useCallback(
    (messageId: string) => session.rewindToMessage(messageId),
    [session],
  );

  return {
    items,
    renderItem: renderMapped,
    renderTurnSeparator,
    header,
    banner,
    rail,
    pendingUserInput,
    onRespondUserInput,
    checkpointsByTurn: store.checkpointsByTurn,
    onRevertToCheckpoint,
    onRewindToMessage,
    currentTurnId: store.currentTurnId,
    compactions: store.compactions,
    thinkingByTurn: store.thinkingByTurn,
    modelByTurn: store.modelByTurn,
    composer: {
      value: draft.plain,
      onChange,
      onSend,
      onSendSerialized,
      onCancel,
      isStreaming,
      pending,
      onApprovalAllow,
      onApprovalDeny,
      contextUsed,
      contextTotal: contextUsed != null ? DEFAULT_CONTEXT_TOTAL : undefined,
      sessionId,
    },
  };
}
