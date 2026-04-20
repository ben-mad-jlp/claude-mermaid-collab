import React from 'react';

export interface TurnFooterProps {
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
  };
  stopReason?: string;
  canceled?: boolean;
  elapsedMs?: number;
}

/**
 * Per-turn footer rendering tokens / cost / stop-reason / elapsed time.
 * Format: `{in} in · {out} out · ${cost} · {elapsed}s · {stopReason}`
 */
export const TurnFooter: React.FC<TurnFooterProps> = ({ usage, stopReason, canceled, elapsedMs }) => {
  const parts: React.ReactNode[] = [];

  if (usage) {
    parts.push(<span key="in">{usage.inputTokens} in</span>);
    parts.push(<span key="out">{usage.outputTokens} out</span>);
    if (typeof usage.costUsd === 'number') {
      parts.push(<span key="cost">${usage.costUsd.toFixed(4)}</span>);
    }
  }

  if (typeof elapsedMs === 'number') {
    const seconds = (elapsedMs / 1000).toFixed(1);
    parts.push(<span key="elapsed">{seconds}s</span>);
  }

  if (stopReason) {
    parts.push(<span key="stop">{stopReason}</span>);
  }

  if (parts.length === 0 && !canceled) return null;

  return (
    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex flex-wrap gap-x-1">
      {parts.map((part, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && <span aria-hidden="true">·</span>}
          {part}
        </React.Fragment>
      ))}
      {canceled && (
        <>
          {parts.length > 0 && <span aria-hidden="true">·</span>}
          <span className="text-red-600 dark:text-red-400">canceled</span>
        </>
      )}
    </div>
  );
};

export default TurnFooter;
