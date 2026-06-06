/**
 * RequirementChip — the shared promise atom (design-system-object-ui §3/§7).
 *
 * A requirement is a *promise*: a chip `{metric · op · target}`. This is the one
 * place that shape is rendered, so it looks identical wherever a promise appears
 * (RequirementsInbox now; SpecSheet chips, BOM rollup and planner peer-chip in
 * later phases). Falls back to the requirement title when no machine spec exists.
 *
 * SATISFY-DRAG (decision 8ee2469e): when given a `reqId` + `onSatisfyDrop`, the
 * chip is a drop target for the satisfy-drag — an object-linked todo dragged onto
 * it creates an OBJECT→REQUIREMENT satisfy edge, resolved via the dragged todo's
 * `objectRef`. A todo with NO objectRef is rejected gracefully (no todo→req edge
 * kind exists). The drag SOURCE is any element that writes the todo payload under
 * TODO_DRAG_MIME (see parseTodoDragPayload for the contract).
 */

import React from 'react';
import type { RequirementSpec } from '@/stores/supervisorStore';

/** The dataTransfer MIME the satisfy-drag uses to carry a todo (the todo↔object
 *  edge contract this todo defines). A drag source sets this; the chip reads it. */
export const TODO_DRAG_MIME = 'application/x-collab-todo';

/** The payload a draggable todo writes under TODO_DRAG_MIME. `objectRef` is the
 *  durable system-object the todo builds (null when the todo isn't object-linked,
 *  which makes it ineligible to satisfy a requirement). */
export interface TodoDragPayload {
  id: string;
  objectRef: string | null;
}

/** Parse a TODO_DRAG_MIME payload string. Returns null for empty/invalid/malformed
 *  input (so a foreign drag never throws), and only when it carries a string `id`.
 *  Pure — the drop handler's decision logic is testable without a DOM. */
export function parseTodoDragPayload(raw: string | null | undefined): TodoDragPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
      return { id: parsed.id, objectRef: typeof parsed.objectRef === 'string' ? parsed.objectRef : null };
    }
  } catch { /* not our payload */ }
  return null;
}

export interface RequirementChipProps {
  spec: RequirementSpec | null;
  /** Shown when there is no machine-checkable spec. */
  fallback?: string;
  className?: string;
  /** Requirement id — enables satisfy-drag drop when `onSatisfyDrop` is also given. */
  reqId?: string;
  /** An object-linked todo was dropped on this requirement: create an object→req
   *  satisfy edge. Receives (reqId, objectRef). */
  onSatisfyDrop?: (reqId: string, objectRef: string) => void;
  /** A todo with NO objectRef was dropped — surface a "link an object first" hint
   *  instead of silently doing nothing. Optional. */
  onSatisfyReject?: (reqId: string) => void;
}

export function formatRequirementSpec(spec: RequirementSpec): string {
  return `${spec.metric} · ${spec.op} · ${spec.target}`;
}

export const RequirementChip: React.FC<RequirementChipProps> = ({ spec, fallback, className, reqId, onSatisfyDrop, onSatisfyReject }) => {
  const text = spec ? formatRequirementSpec(spec) : (fallback ?? '—');
  const dropEnabled = Boolean(reqId && onSatisfyDrop);

  const handleDragOver = dropEnabled
    ? (e: React.DragEvent) => {
        // Accept the drop only when the drag carries our todo payload.
        if (e.dataTransfer.types.includes(TODO_DRAG_MIME)) e.preventDefault();
      }
    : undefined;

  const handleDrop = dropEnabled
    ? (e: React.DragEvent) => {
        const payload = parseTodoDragPayload(e.dataTransfer.getData(TODO_DRAG_MIME));
        if (!payload) return; // foreign drag — ignore
        e.preventDefault();
        if (payload.objectRef) onSatisfyDrop!(reqId!, payload.objectRef);
        else onSatisfyReject?.(reqId!); // object-less todo → graceful reject
      }
    : undefined;

  return (
    <span
      data-testid="requirement-chip"
      title={text}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`inline-flex items-center rounded-md border border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/30 px-1.5 py-0.5 font-mono text-2xs text-warning-800 dark:text-warning-200 leading-none ${className ?? ''}`}
    >
      {text}
    </span>
  );
};

export default RequirementChip;
