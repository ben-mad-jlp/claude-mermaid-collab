import { useState } from 'react';

interface RenameWarning {
  method_row_id: string;
  file_path: string;
  method_name: string;
  enclosing_class: string | null;
  quality: 'fuzzy_rename' | 'fuzzy_move' | 'param_mismatch' | 'class_mismatch';
  warning: string | null;
  suggested_name?: string;
  suggested_class?: string | null;
  suggested_params?: string;
}

interface RenameWarningsListProps {
  warnings: RenameWarning[];
  onApprove: (warning: RenameWarning) => Promise<void>;
  onDismiss: (warning: RenameWarning) => Promise<void>;
  onApproveAll: (warnings: RenameWarning[]) => Promise<void>;
}

export function RenameWarningsList({ warnings, onApprove, onDismiss, onApproveAll }: RenameWarningsListProps) {
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const handleAction = async (w: RenameWarning, fn: (w: RenameWarning) => Promise<void>) => {
    setBusy((prev) => new Set(prev).add(w.method_row_id));
    try {
      await fn(w);
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(w.method_row_id);
        return next;
      });
    }
  };

  const handleBulk = async () => {
    setBulkBusy(true);
    try {
      await onApproveAll(warnings);
    } finally {
      setBulkBusy(false);
    }
  };

  if (warnings.length === 0) {
    return <div className="rename-warnings-empty">No rename warnings.</div>;
  }

  return (
    <div className="rename-warnings-list">
      <div className="rename-warnings-header">
        <span>{warnings.length} warnings</span>
        <button
          type="button"
          onClick={handleBulk}
          disabled={bulkBusy}
          className="rename-warnings-bulk"
        >
          {bulkBusy ? 'Approving…' : 'Approve all'}
        </button>
      </div>
      <ul className="rename-warnings-items">
        {warnings.map((w) => (
          <li key={w.method_row_id} className="rename-warning-item" data-quality={w.quality}>
            <div className="rename-warning-meta">
              <code>{w.file_path}</code>
              <span className="method">{w.enclosing_class ? `${w.enclosing_class}.` : ''}{w.method_name}</span>
              <span className="quality-chip">{w.quality}</span>
            </div>
            {w.warning && <div className="rename-warning-message">{w.warning}</div>}
            {w.suggested_name && (
              <div className="rename-warning-suggestion">
                Suggested: {w.suggested_class ? `${w.suggested_class}.` : ''}{w.suggested_name}({w.suggested_params ?? ''})
              </div>
            )}
            <div className="rename-warning-actions">
              <button
                type="button"
                onClick={() => handleAction(w, onApprove)}
                disabled={busy.has(w.method_row_id)}
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => handleAction(w, onDismiss)}
                disabled={busy.has(w.method_row_id)}
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
