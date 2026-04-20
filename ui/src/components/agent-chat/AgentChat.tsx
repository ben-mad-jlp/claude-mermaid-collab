import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useAgentSession } from '@/hooks/useAgentSession';
import { MessageList } from './MessageList';
import { TurnInput } from './TurnInput';
import { WorktreeHeader } from './WorktreeHeader';
// Chat-parity blueprint sub-components
import { LiveRegion } from './LiveRegion';
import { ErrorRecoveryBanner } from './ErrorRecoveryBanner';
import { ResumedBanner } from './ResumedBanner';
import { SessionTabs } from './SessionTabs';
import { ModelIndicator } from './ModelIndicator';
import ContextMeter from './ContextMeter';
import { TrustedToolsDrawer } from './TrustedToolsDrawer';
import { TranscriptPicker } from './TranscriptPicker';
import { TurnRail } from './TurnRail';
import { ExportMenu } from './ExportMenu';
import { TypingIndicator } from './TypingIndicator';
// Hooks
import { useScrollAnchor } from '../../hooks/useScrollAnchor';

export interface AgentChatProps {
  sessionId: string | null;
  className?: string;
}

export const AgentChat: React.FC<AgentChatProps> = ({ sessionId, className }) => {
  const { send, cancel, resolvePermission, setPermissionMode } = useAgentSession(sessionId);
  const timeline = useAgentStore((s) => s.timeline);
  const streamingMessageId = useAgentStore((s) => s.streamingMessageId);
  const currentTurnId = useAgentStore((s) => s.currentTurnId);
  const ready = useAgentStore((s) => s.ready);
  const lastError = useAgentStore((s) => s.lastError);
  const pendingPromptCount = useAgentStore((s) => s.pendingPromptCount);
  const permissionMode = useAgentStore((s) => s.permissionMode);
  const resumed = useAgentStore((s) => s.resumed);
  const usage = useAgentStore((s) => s.usage);
  // TODO(chat-parity): fatalError slice not yet present in agentStore — fall back
  // to lastError heuristic for now. Replace once the store exposes a dedicated
  // `fatalError` field.
  const fatalError = useAgentStore((s) => (s as unknown as { fatalError?: string }).fatalError) ?? null;
  const revokeTrusted = useAgentStore((s) => s.revokeTrusted);

  const hasPending = pendingPromptCount > 0;

  const isStreaming =
    streamingMessageId !== null ||
    currentTurnId !== null ||
    timeline.some((t) => t.type === 'tool_call' && t.status === 'running' && !t.historical);

  // Scroll anchor — attach to scrollable message container
  const { containerRef: scrollRef, isNearBottom, scrollToBottom } = useScrollAnchor<HTMLDivElement>();

  // Fallback scroll behavior if hook didn't fire auto-follow
  useEffect(() => {
    if (scrollRef.current && isNearBottom) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [timeline, streamingMessageId, isNearBottom, scrollRef]);

  // TurnInput container ref — used for misc layout only. Shortcuts are
  // installed by TurnInput itself (it owns the textarea ref).
  const inputContainerRef = useRef<HTMLDivElement>(null);

  // Local UI state for mountable drawers / modals
  const [trustedOpen, setTrustedOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const pushLocalAssistantMessage = (text: string) => {
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    useAgentStore.setState((s) => ({
      timeline: [...s.timeline, { type: 'message', id, role: 'assistant', text }],
    }));
  };

  const handleSend = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.startsWith('/')) {
      const [cmd, ...rest] = trimmed.split(/\s+/);
      const args = rest.join(' ');
      switch (cmd) {
        case '/help':
          useAgentStore.getState().send(trimmed);
          pushLocalAssistantMessage(
            [
              'Available slash commands:',
              '',
              '- `/help` — show this help',
              '- `/clear` — clear the conversation (UI timeline)',
              '- `/compact` — ask Claude to summarize the conversation so far',
              '- `/model` — show the current model',
              '- `/resume` — open the transcript picker',
              '- `/cost` — show token usage for this session',
            ].join('\n'),
          );
          return;
        case '/clear':
          useAgentStore.setState({
            timeline: [],
            thinkingBlocks: {},
            deltaBuffers: {},
            streamingMessageId: null,
            currentTurnId: null,
            nestedTimelines: {},
            lastError: null,
          });
          return;
        case '/model': {
          const used = usage ? `${usage.inputTokens + usage.outputTokens} tokens used` : 'no usage yet';
          useAgentStore.getState().send(trimmed);
          pushLocalAssistantMessage(
            `Current model: **claude-opus-4-7**\n\nSession: ${used}.\n\n_Model switching via \`/model\` is not yet wired up — set the model in backend config for now._`,
          );
          return;
        }
        case '/cost': {
          useAgentStore.getState().send(trimmed);
          if (!usage) {
            pushLocalAssistantMessage('No usage data yet.');
          } else {
            const lines = [
              `**Input tokens:** ${usage.inputTokens.toLocaleString()}`,
              `**Output tokens:** ${usage.outputTokens.toLocaleString()}`,
              `**Total:** ${(usage.inputTokens + usage.outputTokens).toLocaleString()}`,
            ];
            const anyUsage = usage as typeof usage & { cacheReadTokens?: number; cacheCreationTokens?: number };
            if (anyUsage.cacheReadTokens) lines.push(`**Cache reads:** ${anyUsage.cacheReadTokens.toLocaleString()}`);
            if (anyUsage.cacheCreationTokens) lines.push(`**Cache writes:** ${anyUsage.cacheCreationTokens.toLocaleString()}`);
            pushLocalAssistantMessage(lines.join('\n'));
          }
          return;
        }
        case '/resume':
          useAgentStore.getState().send(trimmed);
          setTranscriptOpen(true);
          pushLocalAssistantMessage('_Opened the transcript picker — pick a session to resume from._');
          return;
        case '/compact': {
          const prompt = args
            ? `Please compact our conversation so far, focusing on: ${args}. Summarize key decisions, context, and open threads in a concise form that can replace the prior turns.`
            : 'Please compact our conversation so far. Summarize key decisions, context, and open threads in a concise form that can replace the prior turns.';
          send(prompt);
          return;
        }
        default:
          break;
      }
    }
    send(text);
  };
  const handleCancel = () => cancel(currentTurnId ?? undefined);

  // Latest assistant text for LiveRegion announcements
  const liveMessage = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const item = timeline[i];
      if (item.type === 'permission' && item.status === 'pending') {
        return `Permission requested for ${item.name}`;
      }
      if (item.type === 'tool_call' && item.status === 'running') {
        return `Running tool: ${item.name}`;
      }
      if (item.type === 'message' && item.role === 'assistant') {
        return item.text.slice(-200);
      }
    }
    return '';
  }, [timeline]);

  // Typing indicator state
  const typingState: 'thinking' | 'streaming' | 'running_tools' | 'idle' = useMemo(() => {
    const toolRunning = timeline.some((t) => t.type === 'tool_call' && t.status === 'running' && !t.historical);
    if (toolRunning) return 'running_tools';
    if (streamingMessageId) return 'streaming';
    if (currentTurnId) return 'thinking';
    return 'idle';
  }, [timeline, streamingMessageId, currentTurnId]);

  // Derive turn ids for the TurnRail from timeline
  const turnRailItems = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string }> = [];
    for (const item of timeline) {
      const tid =
        (item.type === 'message' && item.turnId) ||
        (item.type === 'tool_call' && item.turnId) ||
        (item.type === 'permission' && item.turnId) ||
        undefined;
      if (tid && !seen.has(tid)) {
        seen.add(tid);
        out.push({ id: tid });
      }
    }
    return out;
  }, [timeline]);

  return (
    <div className={`flex flex-col h-full bg-white dark:bg-gray-900 relative ${className || ''}`}>
      {!sessionId ? (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
          No agent session selected
        </div>
      ) : (
        <>
          {/* Live region for assistive tech */}
          <LiveRegion message={liveMessage} />

          {/* Header row */}
          <div className="flex flex-col border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 px-3 py-1 overflow-x-auto">
              <SessionTabs />
              <div className="flex-1" />
              <ModelIndicator model="claude-opus-4-7" />
              <ContextMeter
                used={usage ? usage.inputTokens + usage.outputTokens : 0}
                max={200000}
              />
              <ExportMenu />
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => setTrustedOpen(true)}
              >
                Trusted tools
              </button>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => setTranscriptOpen(true)}
              >
                Resume transcript
              </button>
            </div>
            {resumed && <ResumedBanner sessionId={sessionId} />}
            <WorktreeHeader sessionId={sessionId} />
          </div>

          {lastError && !fatalError && (
            <div className="px-3 py-2 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-b border-red-200 dark:border-red-800">
              {lastError}
            </div>
          )}
          {hasPending && (
            <div className="px-3 py-2 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border-b border-amber-200 dark:border-amber-800">
              {pendingPromptCount} permission request{pendingPromptCount === 1 ? '' : 's'} pending
            </div>
          )}

          {/* Main: TurnRail + MessageList */}
          <div className="flex-1 flex min-h-0">
            <TurnRail turns={turnRailItems} onJump={() => {}} />
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 relative">
              <MessageList
                timeline={timeline}
                streamingMessageId={streamingMessageId}
                onResolvePermission={resolvePermission}
              />
              {!isNearBottom && (
                <button
                  type="button"
                  onClick={() => scrollToBottom()}
                  className="sticky bottom-2 left-1/2 -translate-x-1/2 text-xs px-3 py-1 rounded-full bg-blue-600 text-white shadow hover:bg-blue-700"
                >
                  ↓ Jump to latest
                </button>
              )}
            </div>
          </div>

          {/* Typing indicator above the input */}
          <TypingIndicator state={typingState} />

          <div
            ref={inputContainerRef}
            className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
          >
            <TurnInput
              onSend={handleSend}
              onCancel={isStreaming ? handleCancel : undefined}
              disabled={!ready || isStreaming || hasPending}
              permissionMode={permissionMode}
              onModeChange={setPermissionMode}
              sessionId={sessionId ?? undefined}
            />
          </div>

          {/* Floating fatal-error overlay */}
          {fatalError && (
            <div className="absolute inset-x-0 top-0 z-20 p-2">
              <ErrorRecoveryBanner error={fatalError} />
            </div>
          )}

          {/* Drawer + modal mounts */}
          <TrustedToolsDrawer
            open={trustedOpen}
            onClose={() => setTrustedOpen(false)}
            onRevoke={revokeTrusted}
          />
          {transcriptOpen && (
            <TranscriptPicker
              project={sessionId}
              onSelect={() => setTranscriptOpen(false)}
              onDismiss={() => setTranscriptOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
};

AgentChat.displayName = 'AgentChat';
