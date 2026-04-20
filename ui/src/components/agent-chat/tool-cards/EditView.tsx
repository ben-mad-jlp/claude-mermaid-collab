import React, { useMemo } from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import { computeLineDiff } from './diff';
import OutputPanel from './OutputPanel';

interface EditViewProps {
  item: AgentToolCallItem;
}

interface EditInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}

const EditView: React.FC<EditViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as EditInput;
  const { file_path, old_string, new_string, replace_all } = input;

  const diff = useMemo(
    () => computeLineDiff(old_string ?? '', new_string ?? ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item.id],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {file_path && (
          <span
            className="font-mono text-xs text-gray-300 truncate"
            title={file_path}
          >
            {file_path}
          </span>
        )}
        {replace_all && (
          <span className="text-[10px] uppercase tracking-wide bg-amber-900/50 text-amber-300 px-1.5 py-0.5 rounded">
            replace_all
          </span>
        )}
      </div>
      <pre className="font-mono text-[11px] leading-4 bg-gray-900 rounded p-2 overflow-x-auto max-h-80 overflow-y-auto">
        {diff.map((line, idx) => {
          if (line.kind === 'add') {
            return (
              <div key={idx} className="bg-green-900/40 text-green-300">
                {`+ ${line.text}`}
              </div>
            );
          }
          if (line.kind === 'del') {
            return (
              <div key={idx} className="bg-red-900/40 text-red-300">
                {`- ${line.text}`}
              </div>
            );
          }
          return (
            <div key={idx} className="text-gray-300">
              {`  ${line.text}`}
            </div>
          );
        })}
      </pre>
      <OutputPanel
        toolUseId={item.id}
        status={item.status}
        output={item.output}
        error={item.error}
      />
    </div>
  );
};

export default EditView;
