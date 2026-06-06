/**
 * RequirementCard — one promise awaiting a signature (design-system-object-ui §3).
 *
 * Renders the promise chip `{metric·op·target}` + source + state
 * (proposed/changed). A `changed` card shows the was→now DIFF (the superseded
 * predecessor's spec → the new one) and demands a fresh signature. The `e` edit
 * path opens an inline metric/op/target composer that commits a re-sign.
 *
 * Presentational only: the parent RequirementsInbox owns the keyboard drain and
 * wires approve/edit/reject to `decideRequirement`.
 */

import React, { useState } from 'react';
import type { Requirement, RequirementSpec } from '@/stores/supervisorStore';
import { RequirementChip, formatRequirementSpec } from './RequirementChip';

export interface RequirementCardProps {
  requirement: Requirement;
  /** The predecessor this requirement supersedes (for the was→now DIFF). */
  priorSpec?: RequirementSpec | null;
  active: boolean;
  editing: boolean;
  onApprove: () => void;
  onReject: () => void;
  onStartEdit: () => void;
  onCommitEdit: (spec: RequirementSpec) => void;
  onCancelEdit: () => void;
  onHover: () => void;
}

export const RequirementCard: React.FC<RequirementCardProps> = ({
  requirement: r,
  priorSpec,
  active,
  editing,
  onApprove,
  onReject,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onHover,
}) => {
  const changed = r.status === 'changed';

  return (
    <div
      data-testid="requirement-card"
      data-requirement-id={r.id}
      data-active={active || undefined}
      onMouseEnter={onHover}
      className={`px-2 py-1.5 rounded border bg-white dark:bg-gray-800/60 space-y-1 ${
        active
          ? 'border-warning-400 dark:border-warning-600 ring-1 ring-warning-300 dark:ring-warning-700'
          : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      <div className="flex items-center gap-1.5">
        {changed && (
          <span className="text-3xs font-bold text-warning-700 dark:text-warning-300" title="Changed — re-sign required">
            ⟳ CHANGED · re-sign
          </span>
        )}
        <span className="text-3xs font-medium text-gray-700 dark:text-gray-200 truncate" title={r.title}>
          {r.title}
        </span>
        <span className="ml-auto text-3xs text-gray-400 dark:text-gray-500">{r.kind}</span>
      </div>

      {changed && priorSpec ? (
        <div className="text-2xs leading-snug text-gray-700 dark:text-gray-200">
          <span className="text-gray-400 dark:text-gray-500">was</span>{' '}
          <span className="font-mono line-through opacity-70">{formatRequirementSpec(priorSpec)}</span>
          {' → '}
          <span className="text-gray-400 dark:text-gray-500">now</span>{' '}
          <RequirementChip spec={r.spec} fallback={r.title} />
        </div>
      ) : (
        <div className="pt-0.5">
          <RequirementChip spec={r.spec} fallback={r.title} />
        </div>
      )}

      {r.rationale && (
        <div className="text-3xs text-gray-500 dark:text-gray-400 leading-tight whitespace-pre-wrap break-words">
          {r.rationale}
        </div>
      )}

      {editing ? (
        <EditComposer
          initial={r.spec}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      ) : (
        <div className="flex items-center gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={onApprove}
            className="flex items-center gap-1 px-1.5 py-0.5 text-3xs font-medium rounded border border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/30 text-warning-800 dark:text-warning-200 hover:bg-warning-100 dark:hover:bg-warning-900/50 transition-colors"
            title="Approve (sign) this promise"
          >
            {active && <kbd className="font-mono text-3xs">1</kbd>}
            approve
          </button>
          <button
            type="button"
            onClick={onStartEdit}
            className="flex items-center gap-1 px-1.5 py-0.5 text-3xs font-medium rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Edit → re-sign (emits a changed DIFF)"
          >
            {active && <kbd className="font-mono text-3xs">e</kbd>}
            edit
          </button>
          <button
            type="button"
            onClick={onReject}
            className="flex items-center gap-1 px-1.5 py-0.5 text-3xs font-medium rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Reject this promise"
          >
            {active && <kbd className="font-mono text-3xs">3</kbd>}
            ✕
          </button>
        </div>
      )}
    </div>
  );
};

/** Inline metric/op/target composer for the `e` re-sign path. */
const EditComposer: React.FC<{
  initial: RequirementSpec | null;
  onCommit: (spec: RequirementSpec) => void;
  onCancel: () => void;
}> = ({ initial, onCommit, onCancel }) => {
  const [metric, setMetric] = useState(initial?.metric ?? '');
  const [op, setOp] = useState(initial?.op ?? '');
  const [target, setTarget] = useState(initial ? String(initial.target) : '');

  const commit = () => {
    if (!metric.trim() || !op.trim() || !target.trim()) return;
    const num = Number(target);
    onCommit({ metric: metric.trim(), op: op.trim(), target: Number.isNaN(num) ? target.trim() : num });
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commit();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      onCancel();
    }
  };

  const field = 'flex-1 min-w-0 px-1 py-0.5 text-2xs font-mono rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100';

  return (
    <div data-testid="requirement-edit-composer" className="flex items-center gap-1 pt-0.5" onKeyDown={onKeyDown}>
      <input aria-label="metric" placeholder="metric" value={metric} onChange={(e) => setMetric(e.target.value)} className={field} autoFocus />
      <input aria-label="op" placeholder="op" value={op} onChange={(e) => setOp(e.target.value)} className={`${field} max-w-[3rem]`} />
      <input aria-label="target" placeholder="target" value={target} onChange={(e) => setTarget(e.target.value)} className={field} />
      <button type="button" onClick={commit} title="Commit re-sign (↵)" className="px-1.5 py-0.5 text-3xs font-medium rounded bg-warning-500 text-white hover:bg-warning-600 transition-colors">↵</button>
      <button type="button" onClick={onCancel} title="Cancel (esc)" className="px-1 py-0.5 text-3xs rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">✕</button>
    </div>
  );
};

export default RequirementCard;
