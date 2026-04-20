import React, { useState } from 'react';

interface Props {
  text: string;
  streaming?: boolean;
}

const ThinkingBlock: React.FC<Props> = ({ text, streaming = false }) => {
  const [expanded, setExpanded] = useState(false);

  if (streaming) {
    return (
      <div
        className="max-w-[85%] rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20 text-xs"
        data-testid="thinking-block"
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <span
            className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse"
            data-testid="thinking-pulse"
            aria-hidden="true"
          />
          <span className="font-medium text-gray-700 dark:text-gray-300">Thinking…</span>
        </div>
        {text && (
          <div className="px-3 pb-2 text-[11px] italic text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words">
            {text}
          </div>
        )}
      </div>
    );
  }

  const charCount = text.length;

  return (
    <div
      className="max-w-[85%] rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20 text-xs"
      data-testid="thinking-block"
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800/40 rounded-lg"
        aria-expanded={expanded}
        data-testid="thinking-toggle"
      >
        <span className="text-gray-500" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="font-medium text-gray-700 dark:text-gray-300">
          Thinking ({charCount} chars)
        </span>
      </button>
      {expanded && (
        <div
          className="px-3 pb-3 text-[11px] italic text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words"
          data-testid="thinking-content"
        >
          {text}
        </div>
      )}
    </div>
  );
};

ThinkingBlock.displayName = 'ThinkingBlock';

export default ThinkingBlock;
