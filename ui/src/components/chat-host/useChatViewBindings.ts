import * as React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore, type AgentTimelineItem, type PendingUserInputItem } from '@/stores/agentStore';
import type { UserInputValue } from '@/types/agent';
import { useComposerDraftStore } from '@/stores/composerDraftStore';
import { useAgentSession } from '@/hooks/useAgentSession';
import type { ChatViewProps } from '@/vendored/t3chat/ChatView';
import type { TimelineItem } from '@/vendored/t3chat/chat/MessagesTimeline.logic';
import type { PendingApproval } from '@/vendored/t3chat/chat/ComposerPendingApprovalPanel';

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

function findPending(items: readonly AgentTimelineItem[]): PendingApproval | null {
  for (const it of items) {
    if (it.type === 'permission' && it.status === 'pending') {
      return { promptId: it.id, toolName: it.name };
    }
  }
  return null;
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
    currentTurnId: store.currentTurnId,
    compactions: store.compactions,
    thinkingByTurn: store.thinkingByTurn,
    modelByTurn: store.modelByTurn,
    composer: {
      value: draft.plain,
      onChange,
      onSend,
      onCancel,
      isStreaming,
      pending,
      onApprovalAllow,
      onApprovalDeny,
      contextUsed,
      contextTotal: contextUsed != null ? DEFAULT_CONTEXT_TOTAL : undefined,
    },
  };
}
