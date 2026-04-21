import { useState } from 'react';
import { useIdleDetector } from '../../hooks/useIdleDetector';
import { useAgentStore } from '../../stores/agentStore';
import type { AgentTimelineItem, AgentToolCallItem, AgentMessage } from '../../stores/agentStore';

interface IdleRecapBannerProps {
  sessionId: string;
}

function deriveRecap(timeline: AgentTimelineItem[]): string {
  try {
    // Find last tool_call item and last assistant message
    let toolName: string | undefined;
    let textSnippet = '';

    for (let i = timeline.length - 1; i >= 0; i--) {
      const item = timeline[i];

      if (!toolName && item.type === 'tool_call') {
        toolName = (item as AgentToolCallItem).name;
      }

      if (!textSnippet && item.type === 'message' && (item as AgentMessage & { type: 'message' }).role === 'assistant') {
        const raw = (item as AgentMessage & { type: 'message' }).text ?? '';
        textSnippet = String(raw).replace(/[#*_`>[\]]/g, '').trim().slice(0, 120);
      }

      if (toolName && textSnippet) break;
    }

    if (toolName && textSnippet) return `${toolName}(…) → ${textSnippet}`;
    if (toolName) return `${toolName}(…)`;
    return textSnippet || 'No recent activity.';
  } catch {
    return 'Summary unavailable.';
  }
}

export function IdleRecapBanner({ sessionId: _sessionId }: IdleRecapBannerProps) {
  const [visible, setVisible] = useState(false);
  const [recap, setRecap] = useState('');

  useIdleDetector({
    thresholdMs: 3 * 60 * 1000,
    onIdleReturn: () => {
      const timeline = useAgentStore.getState().timeline;
      setRecap(deriveRecap(timeline));
      setVisible(true);
    },
  });

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 px-3 py-2 text-xs
        bg-amber-50 dark:bg-amber-950/40
        text-amber-900 dark:text-amber-100
        border-b border-amber-200 dark:border-amber-900"
    >
      <div className="flex-1 leading-snug">
        <span className="font-medium">Back already?</span>
        {' '}— {recap}
      </div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Resume session"
        className="shrink-0 px-2 py-0.5 rounded text-xs font-medium
          bg-amber-200 dark:bg-amber-800
          text-amber-900 dark:text-amber-100
          hover:bg-amber-300 dark:hover:bg-amber-700"
      >
        Resume
      </button>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Dismiss idle recap"
        className="shrink-0 px-1.5 py-0.5 rounded
          text-amber-700 dark:text-amber-200
          hover:bg-amber-100 dark:hover:bg-amber-900/60"
      >
        &times;
      </button>
    </div>
  );
}
