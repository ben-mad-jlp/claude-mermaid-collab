import React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';

interface WebSearchResult {
  title?: string;
  url?: string;
  snippet?: string;
}

interface WebSearchViewProps {
  item: AgentToolCallItem;
}

const WebSearchView: React.FC<WebSearchViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as { query?: string };
  const rawOutput = item.output;
  let results: WebSearchResult[] = [];
  if (Array.isArray(rawOutput)) {
    results = rawOutput as WebSearchResult[];
  } else if (rawOutput && typeof rawOutput === 'object' && Array.isArray((rawOutput as { results?: unknown }).results)) {
    results = (rawOutput as { results: WebSearchResult[] }).results;
  }

  return (
    <div className="text-sm">
      <div className="mb-2">
        {input.query && (
          <code
            data-testid="websearch-query"
            className="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded"
          >
            {input.query}
          </code>
        )}
      </div>

      {results.length > 0 && (
        <>
          <div className="text-xs text-gray-500 mb-1">
            {results.length} result{results.length === 1 ? '' : 's'}
          </div>
          <div className="flex flex-col gap-2">
            {results.map((r, i) => (
              <div
                key={i}
                data-testid="websearch-result"
                className="bg-gray-50 dark:bg-gray-900 rounded p-2 border border-gray-200 dark:border-gray-700"
              >
                {r.title && (
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {r.title}
                  </div>
                )}
                {r.url && (
                  <div className="text-xs text-blue-600 dark:text-blue-400 font-mono break-all">
                    {r.url}
                  </div>
                )}
                {r.snippet && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {r.snippet}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {item.error && (
        <div className="text-red-600 dark:text-red-400 text-xs mt-2">{item.error}</div>
      )}
    </div>
  );
};

export default WebSearchView;
