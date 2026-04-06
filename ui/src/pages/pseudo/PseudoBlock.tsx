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

import React, { useState, useCallback } from 'react';
import { fetchPseudoReferences, type Reference, type PseudoMethod } from '@/lib/pseudo-api';
import CallsLink from './CallsLink';

export type PseudoBlockProps = {
  func: PseudoMethod;
  project: string;
  currentFileStem: string;
  onNavigate: (stem: string) => void;
};

const KEYWORD_PATTERN = /\b(ELSE IF|IF|ELSE|FOREACH|FOR|WHILE|RETURN|END|TRY|CATCH|FINALLY|THROW|BREAK|CONTINUE|EACH|CALL|SET)\b/g;

/**
 * Splits a line of text into plain/keyword segments for bold rendering
 */
function tokenizeLine(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  KEYWORD_PATTERN.lastIndex = 0;
  while ((match = KEYWORD_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<strong key={match.index}>{match[0]}</strong>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

/**
 * Renders a single step with indentation, bullet, and keyword bolding
 */
function renderStep(step: { content: string; depth: number }, index: number) {
  const trimmed = step.content;

  if (!trimmed) return <div key={index} style={{ height: '0.5em' }} />;

  // data-testid markers for existing tests
  const firstWord = trimmed.split(' ')[0];
  const testId = firstWord === 'IF' ? 'keyword-if' : firstWord === 'ELSE' ? 'keyword-else' : undefined;

  const content = testId ? (
    <span data-testid={testId}>{tokenizeLine(trimmed)}</span>
  ) : (
    tokenizeLine(trimmed)
  );

  return (
    <div
      key={index}
      style={{ paddingLeft: `${step.depth * 16}px`, display: 'flex', gap: '6px', marginBottom: '3px' }}
    >
      <span style={{ flexShrink: 0, color: '#c4b5a8', userSelect: 'none', marginTop: '1px' }}>–</span>
      <span style={{ flex: 1 }}>{content}</span>
    </div>
  );
}

export default function PseudoBlock({
  func,
  project,
  currentFileStem,
  onNavigate,
}: PseudoBlockProps): JSX.Element {
  const [refsOpen, setRefsOpen] = useState(false);
  const [refs, setRefs] = useState<Reference[] | null>(null);
  const [loadingRefs, setLoadingRefs] = useState(false);

  const handleToggleRefs = useCallback(async () => {
    if (!refsOpen && refs === null) {
      setLoadingRefs(true);
      try {
        const result = await fetchPseudoReferences(project, func.name, currentFileStem);
        setRefs(result);
      } catch {
        setRefs([]);
      } finally {
        setLoadingRefs(false);
      }
    }
    setRefsOpen((prev) => !prev);
  }, [refsOpen, refs, project, func.name, currentFileStem]);

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

        {/* Right-side badges */}
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          {func.date && (
            <span className="text-xs" style={{ color: '#a8a29e' }}>
              {func.date}
            </span>
          )}
          {func.isExported && (
            <span className="bg-green-100 text-green-700 text-xs rounded px-1">
              EXPORT
            </span>
          )}
          <button
            onClick={handleToggleRefs}
            className="text-xs rounded px-1 py-0.5 transition-colors"
            style={{
              color: refsOpen ? '#7c3aed' : '#78716c',
              background: refsOpen ? '#ede9fe' : 'transparent',
            }}
            title="Show functions that call this"
          >
            {loadingRefs ? '…' : 'refs'}
          </button>
        </div>
      </div>

      {/* USED BY section (lazy-loaded references) */}
      {refsOpen && (
        <div className="mb-2">
          <div className="text-xs" style={{ color: '#78716c' }}>
            <span className="font-medium mr-1">USED BY</span>
            {loadingRefs ? (
              <span>loading…</span>
            ) : refs && refs.length > 0 ? (
              refs.map((ref, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && ', '}
                  <CallsLink
                    name={ref.callerMethod}
                    fileStem={ref.file}
                    project={project}
                    onNavigate={onNavigate}
                  />
                </React.Fragment>
              ))
            ) : (
              <span style={{ color: '#a8a29e' }}>no references found</span>
            )}
          </div>
        </div>
      )}

      {/* CALLS section */}
      {func.calls.length > 0 && (
        <div className="mb-2">
          <div data-testid="pseudo-calls-section" className="text-xs" style={{ color: '#78716c' }}>
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
      {func.steps.length > 0 && (
        <div
          data-testid="pseudo-block-body"
          className="text-sm"
          style={{ color: '#44403c' }}
        >
          {func.steps.map((step, idx) => renderStep(step, idx))}
        </div>
      )}
    </div>
  );
}
