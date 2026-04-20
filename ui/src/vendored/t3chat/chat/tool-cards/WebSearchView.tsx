import * as React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';

interface WebSearchResult {
  title?: string;
  url?: string;
  snippet?: string;
}

export interface WebSearchViewProps {
  item: AgentToolCallItem;
}

export const WebSearchView: React.FC<WebSearchViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as { query?: string };
  const rawOutput = item.output;
  let results: WebSearchResult[] = [];
  if (Array.isArray(rawOutput)) {
    results = rawOutput as WebSearchResult[];
  } else if (
    rawOutput &&
    typeof rawOutput === 'object' &&
    Array.isArray((rawOutput as { results?: unknown }).results)
  ) {
    results = (rawOutput as { results: WebSearchResult[] }).results;
  }

  return (
    <div className="text-sm" data-testid="websearch-view">
      <div className="mb-2">
        {input.query && (
          <code
            data-testid="websearch-query"
            className="font-mono bg-muted px-1.5 py-0.5 rounded"
          >
            {input.query}
          </code>
        )}
      </div>

      {results.length > 0 && (
        <>
          <div className="text-xs text-muted-foreground mb-1">
            {results.length} result{results.length === 1 ? '' : 's'}
          </div>
          <div className="flex flex-col gap-2">
            {results.map((r, i) => (
              <div
                key={i}
                data-testid="websearch-result"
                className="rounded border border-border bg-muted/30 p-2"
              >
                {r.title && <div className="text-sm font-medium text-foreground">{r.title}</div>}
                {r.url && (
                  <div className="text-xs text-primary font-mono break-all">{r.url}</div>
                )}
                {r.snippet && (
                  <div className="text-xs text-muted-foreground mt-1">{r.snippet}</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {item.error && <div className="text-destructive text-xs mt-2">{item.error}</div>}
    </div>
  );
};

export default WebSearchView;
