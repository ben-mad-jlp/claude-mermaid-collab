import React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import OutputPanel from './OutputPanel';

interface WriteViewProps {
  item: AgentToolCallItem;
}

const WriteView: React.FC<WriteViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as { file_path?: string; content?: string };
  const filePath = input.file_path ?? '';
  const content = input.content ?? '';
  const lines = content.split('\n');
  const lineCount = lines.length;
  const charCount = content.length;
  const previewLimit = 30;
  const previewLines = lines.slice(0, previewLimit);
  const truncated = lineCount > previewLimit;
  const remaining = lineCount - previewLimit;
  const raw = item as unknown as {
    error?: string;
    status?: 'running' | 'ok' | 'error' | 'canceled';
    stdout?: string;
    stderr?: string;
    output?: unknown;
    toolUseId?: string;
    id?: string;
  };
  const status: 'running' | 'ok' | 'error' | 'canceled' =
    raw.status ?? (raw.error ? 'error' : 'ok');
  const toolUseId = raw.toolUseId ?? raw.id ?? '';

  return (
    <div>
      {filePath && (
        <div className="font-mono text-xs break-all">{filePath}</div>
      )}
      <div className="text-xs text-gray-500 mt-1">
        {lineCount} lines, {charCount} chars
      </div>
      {content && (
        <pre className="mt-2 p-2 bg-gray-900 text-gray-100 rounded text-[11px] leading-4 font-mono whitespace-pre overflow-x-auto max-h-64 overflow-y-auto">
          {previewLines.join('\n')}
          {truncated ? `\n…${remaining} more lines` : ''}
        </pre>
      )}
      <div className="mt-2">
        <OutputPanel
          toolUseId={toolUseId}
          status={status}
          stdout={raw.stdout}
          stderr={raw.stderr}
          output={raw.output}
          error={raw.error}
        />
      </div>
    </div>
  );
};

export default WriteView;
