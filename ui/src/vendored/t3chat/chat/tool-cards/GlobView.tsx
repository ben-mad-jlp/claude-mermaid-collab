import * as React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import { OutputPanel } from './OutputPanel';

export interface GlobViewProps {
  item: AgentToolCallItem;
}

export const GlobView: React.FC<GlobViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as { pattern?: string; path?: string };
  const output = typeof item.output === 'string' ? item.output : '';
  const lineCount = output ? output.split('\n').filter((l) => l.length > 0).length : 0;

  return (
    <div className="text-sm" data-testid="glob-view">
      <div className="mb-2">
        {input.pattern && (
          <code className="font-mono bg-muted px-1.5 py-0.5 rounded">{input.pattern}</code>
        )}
        {input.path && (
          <div className="text-xs text-muted-foreground mt-1 font-mono">{input.path}</div>
        )}
        {output && (
          <div className="text-xs text-muted-foreground mt-1" data-testid="glob-count">
            {lineCount} files
          </div>
        )}
      </div>
      <OutputPanel
        toolUseId={item.id}
        status={item.status}
        stdout={output}
        error={item.error}
        format="lines"
      />
    </div>
  );
};

export default GlobView;
