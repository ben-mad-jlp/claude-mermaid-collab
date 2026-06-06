/**
 * SpecCoverageCard — the one read-only coverage glance (design §5, P1).
 *
 * Answers "is the system covered?" without a second fleet map: a number on a card,
 * tinted by the same one-red palette the funnel uses (covered=success,
 * partial=info, uncovered=AMBER — never red). Derived inline from the
 * `Todo.objectRef → requirement` rollup (loadCoverage); renders nothing when there
 * are no spec objects yet, so it never adds noise to a project without a Spec Sheet.
 */

import React from 'react';
import type { CoverageRollup } from '@/stores/supervisorStore';
import { COVERAGE_TINTS, STALE_GLYPH } from '@/components/supervisor/spec/objectTreeModel';

export interface SpecCoverageCardProps {
  coverage: CoverageRollup | undefined;
}

const SEGMENTS: Array<{ key: 'covered' | 'partial' | 'uncovered' }> = [
  { key: 'covered' },
  { key: 'partial' },
  { key: 'uncovered' },
];

export const SpecCoverageCard: React.FC<SpecCoverageCardProps> = ({ coverage }) => {
  if (!coverage || coverage.total === 0) return null;

  return (
    <div data-testid="spec-coverage-card" className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-semibold uppercase tracking-wide">Spec coverage</span>
        <span>{coverage.covered}/{coverage.total} covered</span>
        {coverage.stale > 0 && (
          <span
            data-testid="spec-coverage-stale"
            title={`${coverage.stale} object(s) drifted since their proof — re-author to clear`}
            className={`ml-auto inline-flex items-center gap-0.5 font-semibold ${STALE_GLYPH.className}`}
          >
            {STALE_GLYPH.mark} {coverage.stale} {STALE_GLYPH.label}
          </span>
        )}
      </div>
      <div className="flex items-stretch gap-0.5 h-7 rounded overflow-hidden">
        {SEGMENTS.map(({ key }) => {
          const n = coverage[key];
          const tint = COVERAGE_TINTS[key];
          const flex = Math.max(n, 0.4);
          return (
            <div
              key={key}
              style={{ flexGrow: flex, flexBasis: 0 }}
              title={`${tint.label}: ${n}`}
              data-testid={`spec-coverage-${key}`}
              className={`min-w-[3.5rem] flex flex-col items-center justify-center px-1 text-xs font-semibold ${tint.bg}`}
            >
              <span className="tabular-nums leading-none">{n}</span>
              <span className="leading-none mt-0.5 whitespace-nowrap text-center text-[0.625rem]">{tint.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SpecCoverageCard;
