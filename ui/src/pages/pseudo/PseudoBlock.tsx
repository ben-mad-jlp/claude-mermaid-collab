/**
 * PseudoBlock Component
 *
 * Renders a single FUNCTION block from parsed pseudo-code.
 * Features:
 * - Color-coded keywords (FUNCTION in purple, IF/ELSE in bold)
 * - EXPORT badge for exported functions
 * - CALLS section with navigable links
 * - Indented body rendering
 * - Full type annotations for params and return types
 */

import React from 'react';
import { ParsedFunction } from './parsePseudo';
import CallsLink from './CallsLink';

export type PseudoBlockProps = {
  func: ParsedFunction;
  project: string;
  onNavigate: (stem: string) => void;
};

/**
 * Helper to render body text with IF/ELSE keyword formatting
 */
function renderBodyLine(line: string, index: number) {
  const trimmed = line.trim();

  // Check if line starts with IF or ELSE
  if (trimmed.startsWith('IF ')) {
    const rest = trimmed.slice(3);
    return (
      <p key={index}>
        <span data-testid="keyword-if" style={{ fontWeight: 600 }}>
          IF
        </span>{' '}
        {rest}
      </p>
    );
  }

  if (trimmed === 'ELSE' || trimmed.startsWith('ELSE ')) {
    const rest = trimmed.slice(4);
    return (
      <p key={index}>
        <span data-testid="keyword-else" style={{ fontWeight: 600 }}>
          ELSE
        </span>{' '}
        {rest}
      </p>
    );
  }

  return <p key={index}>{line}</p>;
}

export default function PseudoBlock({
  func,
  project,
  onNavigate,
}: PseudoBlockProps): JSX.Element {
  return (
    <div className="mb-6" data-function={func.name}>
      {/* Header: FUNCTION keyword, name, params, return type, and EXPORT badge */}
      <div
        data-testid="pseudo-block-header"
        className="flex justify-between items-baseline mb-2"
      >
        <div className="flex-1">
          <span style={{ color: '#7c3aed', fontWeight: 'bold' }}>FUNCTION</span>
          {' '}
          <span style={{ color: '#1c1917', fontWeight: 'bold' }}>
            {func.name}
          </span>
          <span style={{ color: '#44403c' }}>({func.params})</span>
          {func.returnType && (
            <span style={{ color: '#44403c' }}> -&gt; {func.returnType}</span>
          )}
        </div>

        {/* EXPORT badge (right-aligned) */}
        {func.isExport && (
          <span className="bg-green-100 text-green-700 text-xs rounded px-1 ml-2 flex-shrink-0">
            EXPORT
          </span>
        )}
      </div>

      {/* CALLS section */}
      {func.calls.length > 0 && (
        <div className="mb-2">
          <div className="text-xs" style={{ color: '#78716c' }}>
            <span className="font-medium mr-1">CALLS</span>
            {func.calls.map((call, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && ', '}
                <CallsLink
                  name={call.name}
                  fileStem={call.fileStem}
                  project={project}
                  onNavigate={onNavigate}
                />
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Separator */}
      <hr className="border-stone-200 mb-2" />

      {/* Body */}
      {func.body.length > 0 && (
        <div
          data-testid="pseudo-block-body"
          className="pl-5 text-sm"
          style={{ color: '#44403c' }}
        >
          {func.body.map((line, idx) => renderBodyLine(line, idx))}
        </div>
      )}
    </div>
  );
}
