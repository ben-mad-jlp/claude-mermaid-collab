import * as React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import { JsonFallback } from './JsonFallback';

export interface McpGenericViewProps {
  item: AgentToolCallItem;
}

export const McpGenericView: React.FC<McpGenericViewProps> = ({ item }) => {
  // MCP tool names look like mcp__<server>__<tool>. Surface the
  // server/tool split so users can see which server handled the call.
  const parts = item.name.split('__');
  const server = parts[1];
  const tool = parts.slice(2).join('__');

  return (
    <div className="space-y-2" data-testid="mcp-generic-view">
      <div className="flex items-center gap-2 text-xs">
        {server && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
            {server}
          </span>
        )}
        {tool && <span className="font-mono text-foreground">{tool}</span>}
      </div>
      <JsonFallback item={item} />
    </div>
  );
};

export default McpGenericView;
