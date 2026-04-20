import React from 'react';

export type TypingIndicatorState =
  | 'idle'
  | 'thinking'
  | 'streaming'
  | 'running_tools';

export interface TypingIndicatorProps {
  state: TypingIndicatorState;
}

export function TypingIndicator({ state }: TypingIndicatorProps) {
  if (state === 'idle') {
    return null;
  }

  if (state === 'thinking') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-sm text-accent"
      >
        <span
          aria-hidden="true"
          className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse"
        />
        <span>Thinking…</span>
      </div>
    );
  }

  if (state === 'streaming') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <span>Streaming…</span>
        <span aria-hidden="true" className="inline-flex gap-0.5">
          <span
            className="inline-block w-1 h-1 rounded-full bg-current animate-bounce"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="inline-block w-1 h-1 rounded-full bg-current animate-bounce"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="inline-block w-1 h-1 rounded-full bg-current animate-bounce"
            style={{ animationDelay: '300ms' }}
          />
        </span>
      </div>
    );
  }

  // running_tools
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      <span
        aria-hidden="true"
        data-testid="typing-indicator-spinner"
        className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin"
      />
      <span>Running tools…</span>
    </div>
  );
}

export default TypingIndicator;
