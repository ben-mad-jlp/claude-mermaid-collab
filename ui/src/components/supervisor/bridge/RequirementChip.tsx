/**
 * RequirementChip — the shared promise atom (design-system-object-ui §3/§7).
 *
 * A requirement is a *promise*: a chip `{metric · op · target}`. This is the one
 * place that shape is rendered, so it looks identical wherever a promise appears
 * (RequirementsInbox now; SpecSheet chips, BOM rollup and planner peer-chip in
 * later phases). Falls back to the requirement title when no machine spec exists.
 */

import React from 'react';
import type { RequirementSpec } from '@/stores/supervisorStore';

export interface RequirementChipProps {
  spec: RequirementSpec | null;
  /** Shown when there is no machine-checkable spec. */
  fallback?: string;
  className?: string;
}

export function formatRequirementSpec(spec: RequirementSpec): string {
  return `${spec.metric} · ${spec.op} · ${spec.target}`;
}

export const RequirementChip: React.FC<RequirementChipProps> = ({ spec, fallback, className }) => {
  const text = spec ? formatRequirementSpec(spec) : (fallback ?? '—');
  return (
    <span
      data-testid="requirement-chip"
      title={text}
      className={`inline-flex items-center rounded-md border border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/30 px-1.5 py-0.5 font-mono text-2xs text-warning-800 dark:text-warning-200 leading-none ${className ?? ''}`}
    >
      {text}
    </span>
  );
};

export default RequirementChip;
