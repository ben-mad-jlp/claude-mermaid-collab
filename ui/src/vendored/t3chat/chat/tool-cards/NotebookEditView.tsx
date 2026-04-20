import * as React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import { computeLineDiff } from './diff';

export interface NotebookEditViewProps {
  item: AgentToolCallItem;
}

interface NotebookEditInput {
  notebook_path?: string;
  cell_id?: string;
  new_source?: string;
  cell_type?: 'code' | 'markdown';
  edit_mode?: 'replace' | 'insert' | 'delete';
}

const EDIT_MODE_STYLES: Record<string, string> = {
  replace: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  insert: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  delete: 'bg-destructive/20 text-destructive',
};

export const NotebookEditView: React.FC<NotebookEditViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as NotebookEditInput;
  const { notebook_path, cell_id, new_source, cell_type, edit_mode } = input;
  const mode = edit_mode ?? 'replace';

  const diff = React.useMemo(
    () => {
      if (mode === 'insert') return computeLineDiff('', new_source ?? '');
      if (mode === 'delete') return computeLineDiff(new_source ?? '', '');
      return computeLineDiff('', new_source ?? '');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item.id],
  );

  return (
    <div className="space-y-2" data-testid="notebook-edit-view">
      <div className="flex flex-wrap items-center gap-2">
        {notebook_path && (
          <span
            className="font-mono text-xs text-muted-foreground break-all"
            title={notebook_path}
          >
            {notebook_path}
          </span>
        )}
        {cell_id && (
          <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded">
            cell: {cell_id}
          </span>
        )}
        <span
          className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${EDIT_MODE_STYLES[mode] ?? EDIT_MODE_STYLES.replace}`}
        >
          {mode}
        </span>
        {cell_type && (
          <span className="text-[10px] uppercase tracking-wide bg-muted px-1.5 py-0.5 rounded">
            {cell_type}
          </span>
        )}
      </div>
      <pre className="font-mono text-[11px] leading-4 rounded bg-muted p-2 overflow-x-auto max-h-80 overflow-y-auto">
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
      {item.error && <div className="text-xs text-destructive font-mono">{item.error}</div>}
    </div>
  );
};

export default NotebookEditView;
