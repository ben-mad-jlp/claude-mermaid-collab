import React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import OutputPanel from './OutputPanel';

interface GlobViewProps {
  item: AgentToolCallItem;
}

const GlobView: React.FC<GlobViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as { pattern?: string; path?: string };
  const output = typeof item.output === 'string' ? item.output : '';
  const lineCount = output ? output.split('\n').filter((l) => l.length > 0).length : 0;
  const status: 'running' | 'ok' | 'error' | 'canceled' = item.error
    ? 'error'
    : (item.status as 'running' | 'ok' | 'error' | 'canceled' | undefined) ?? 'ok';

  return (
    <div className="text-sm">
      <div className="mb-2">
        {input.pattern && (
          <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
            {input.pattern}
          </code>
        )}
        {input.path && (
          <div className="text-xs text-gray-500 mt-1 font-mono">{input.path}</div>
        )}
        {output && (
          <div className="text-xs text-gray-500 mt-1">{lineCount} files</div>
        )}
      </div>

      <OutputPanel
        toolUseId={item.id}
        status={status}
        stdout={output}
        error={item.error}
        format="lines"
      />
    </div>
  );
};

export default GlobView;
