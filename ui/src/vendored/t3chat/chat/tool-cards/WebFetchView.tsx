import * as React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import { OutputPanel } from './OutputPanel';

export interface WebFetchViewProps {
  item: AgentToolCallItem;
}

const MAX_EXCERPT = 400;

export const WebFetchView: React.FC<WebFetchViewProps> = ({ item }) => {
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
    excerpt = text.length > MAX_EXCERPT ? text.slice(0, MAX_EXCERPT) + '…' : text;
  }

  return (
    <div className="text-sm" data-testid="webfetch-view">
      {input.url && (
        <div className="mb-2">
          <a
            href={input.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-primary hover:underline break-all"
          >
            {input.url}
          </a>
        </div>
      )}
      {input.prompt && (
        <blockquote className="text-xs italic text-muted-foreground border-l-2 border-border pl-2 mb-2">
          {input.prompt}
        </blockquote>
      )}
      {excerpt !== undefined && (
        <OutputPanel toolUseId={item.id} status={item.status} stdout={excerpt} error={item.error} />
      )}
      {item.status === 'error' && excerpt === undefined && (
        <OutputPanel toolUseId={item.id} status="error" error={item.error} />
      )}
    </div>
  );
};

export default WebFetchView;
