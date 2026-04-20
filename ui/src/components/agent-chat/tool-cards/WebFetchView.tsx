import React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import OutputPanel from './OutputPanel';

interface WebFetchViewProps {
  item: AgentToolCallItem;
}

const MAX_EXCERPT = 400;

const WebFetchView: React.FC<WebFetchViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as { url?: string; prompt?: string };

  let excerpt: string | undefined;
  if (item.output !== undefined && item.output !== null) {
    const text =
      typeof item.output === 'string'
        ? item.output
        : (() => {
            try {
              return JSON.stringify(item.output, null, 2);
            } catch {
              return String(item.output);
            }
          })();
    excerpt =
      text.length > MAX_EXCERPT ? text.slice(0, MAX_EXCERPT) + '…' : text;
  }

  return (
    <div className="text-sm">
      {input.url && (
        <div className="mb-2">
          <a
            href={input.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline break-all"
          >
            {input.url}
          </a>
        </div>
      )}
      {input.prompt && (
        <blockquote className="text-xs italic text-gray-600 dark:text-gray-400 border-l-2 border-gray-300 dark:border-gray-600 pl-2 mb-2">
          {input.prompt}
        </blockquote>
      )}
      {excerpt !== undefined && (
        <OutputPanel
          toolUseId={item.id}
          status={item.status}
          stdout={excerpt}
          error={item.error}
        />
      )}
      {item.status === 'error' && excerpt === undefined && (
        <OutputPanel
          toolUseId={item.id}
          status="error"
          error={item.error}
        />
      )}
    </div>
  );
};

export default WebFetchView;
