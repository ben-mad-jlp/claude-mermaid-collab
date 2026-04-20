import * as React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import { computeLineDiff } from './diff';
import { OutputPanel } from './OutputPanel';

export interface EditViewProps {
  item: AgentToolCallItem;
}

interface EditInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}

export const EditView: React.FC<EditViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as EditInput;
  const { file_path, old_string, new_string, replace_all } = input;

  const diff = React.useMemo(
    () => computeLineDiff(old_string ?? '', new_string ?? ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item.id],
  );

  return (
    <div className="space-y-2" data-testid="edit-view">
      <div className="flex items-center gap-2">
        {file_path && (
          <span className="font-mono text-xs text-muted-foreground break-all" title={file_path}>
            {file_path}
          </span>
        )}
        {replace_all && (
          <span className="text-[10px] uppercase tracking-wide rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 px-1.5 py-0.5">
            replace_all
          </span>
        )}
      </div>
      <pre
        data-testid="edit-diff"
        className="font-mono text-[11px] leading-4 rounded bg-muted p-2 overflow-x-auto max-h-80 overflow-y-auto"
      >
        {diff.map((line, idx) => {
          if (line.kind === 'add') {
            return (
              <div key={idx} className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                {`+ ${line.text}`}
              </div>
            );
          }
          if (line.kind === 'del') {
            return (
              <div key={idx} className="bg-destructive/15 text-destructive">
                {`- ${line.text}`}
              </div>
            );
          }
          return (
            <div key={idx} className="text-muted-foreground">
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
