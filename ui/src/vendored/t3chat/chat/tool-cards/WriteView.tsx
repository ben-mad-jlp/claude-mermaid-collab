import * as React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import { OutputPanel } from './OutputPanel';

export interface WriteViewProps {
  item: AgentToolCallItem;
}

const PREVIEW_LIMIT = 30;

export const WriteView: React.FC<WriteViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as { file_path?: string; content?: string };
  const filePath = input.file_path ?? '';
  const content = input.content ?? '';
  const lines = content.split('\n');
  const lineCount = lines.length;
  const charCount = content.length;
  const previewLines = lines.slice(0, PREVIEW_LIMIT);
  const truncated = lineCount > PREVIEW_LIMIT;
  const remaining = lineCount - PREVIEW_LIMIT;

  return (
    <div data-testid="write-view">
      {filePath && <div className="font-mono text-xs break-all">{filePath}</div>}
      <div className="text-xs text-muted-foreground mt-1">
        {lineCount} lines, {charCount} chars
      </div>
      {content && (
        <pre className="mt-2 p-2 bg-muted rounded text-[11px] leading-4 font-mono whitespace-pre overflow-x-auto max-h-64 overflow-y-auto">
          {previewLines.join('\n')}
          {truncated ? `\n…${remaining} more lines` : ''}
        </pre>
      )}
      <div className="mt-2">
        <OutputPanel
          toolUseId={item.id}
          status={item.status}
          output={item.output}
          error={item.error}
        />
      </div>
    </div>
  );
};

export default WriteView;
