import React, { useMemo } from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import { computeLineDiff } from './diff';

interface NotebookEditViewProps {
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
  replace: 'bg-amber-900/50 text-amber-300',
  insert: 'bg-green-900/50 text-green-300',
  delete: 'bg-red-900/50 text-red-300',
};

const NotebookEditView: React.FC<NotebookEditViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as NotebookEditInput;
  const { notebook_path, cell_id, new_source, cell_type, edit_mode } = input;
  const mode = edit_mode ?? 'replace';

  // For notebook edits we don't have the "before" text in input; render
  // new_source as an additive diff when inserting, as a deletion when deleting,
  // and as plain content when replacing.
  const diff = useMemo(
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
            className="font-mono text-xs text-gray-300 truncate"
            title={notebook_path}
            data-testid="notebook-path"
          >
            {notebook_path}
          </span>
        )}
        {cell_id && (
          <span
            className="text-[10px] font-mono bg-gray-800 text-gray-200 px-1.5 py-0.5 rounded"
            data-testid="cell-id-badge"
          >
            cell: {cell_id}
          </span>
        )}
        <span
          className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${EDIT_MODE_STYLES[mode] ?? EDIT_MODE_STYLES.replace}`}
          data-testid="edit-mode-badge"
        >
          {mode}
        </span>
        {cell_type && (
          <span
            className="text-[10px] uppercase tracking-wide bg-gray-700 text-gray-200 px-1.5 py-0.5 rounded"
            data-testid="cell-type-badge"
          >
            {cell_type}
          </span>
        )}
      </div>
      <div
        className="grid grid-cols-2 gap-2 font-mono text-[11px] leading-4"
        data-testid="notebook-split-diff"
      >
        <div className="bg-gray-900 rounded p-2 overflow-auto max-h-80">
          <div className="text-[10px] uppercase text-gray-500 mb-1">Before</div>
          {mode === 'delete' ? (
            diff.map((line, idx) =>
              line.kind === 'del' ? (
                <div key={idx} className="bg-red-900/40 text-red-300">
                  {`- ${line.text}`}
                </div>
              ) : null,
            )
          ) : (
            <div className="text-gray-500 italic">(no prior source)</div>
          )}
        </div>
        <div className="bg-gray-900 rounded p-2 overflow-auto max-h-80">
          <div className="text-[10px] uppercase text-gray-500 mb-1">After</div>
          {mode === 'delete' ? (
            <div className="text-gray-500 italic">(cell deleted)</div>
          ) : (
            diff.map((line, idx) =>
              line.kind === 'add' ? (
                <div key={idx} className="bg-green-900/40 text-green-300">
                  {`+ ${line.text}`}
                </div>
              ) : (
                <div key={idx} className="text-gray-300">
                  {`  ${line.text}`}
                </div>
              ),
            )
          )}
        </div>
      </div>
      {item.error && (
        <div className="text-xs text-red-400 font-mono">{item.error}</div>
      )}
    </div>
  );
};

export default NotebookEditView;
