import React, { useState, useCallback } from 'react';

interface CopyIdProps {
  /** The full id (UUID). The full value is copied; only the leading `length` chars show. */
  id: string;
  /** Leading chars to display (default 8 — matches the leading-8 short-id convention). */
  length?: number;
  /** Extra classes for the wrapper (color/size — defaults to the muted chip look). */
  className?: string;
  /** Prefix the short id with '#'. Default true. */
  hash?: boolean;
}

/**
 * `#<leading-8>` with a one-click copy button that copies the FULL id. Used
 * everywhere a todo/epic/leaf id is surfaced so the value can be pasted into a
 * tool that resolves by leading prefix. Clicking copy stops propagation so it
 * never triggers the surrounding row/card selection.
 */
export const CopyId: React.FC<CopyIdProps> = ({ id, length = 8, className = 'text-gray-400 dark:text-gray-500', hash = true }) => {
  const [copied, setCopied] = useState(false);
  const short = String(id).slice(0, length);

  const copy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      void navigator.clipboard
        ?.writeText(id)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        })
        .catch(() => { /* clipboard blocked — no-op */ });
    },
    [id],
  );

  return (
    <span className={`inline-flex items-center gap-0.5 font-mono ${className}`} title={id}>
      <span className="select-all">{hash ? '#' : ''}{short}</span>
      <button
        type="button"
        data-testid="copy-id"
        onClick={copy}
        title={copied ? 'Copied!' : `Copy full id: ${id}`}
        aria-label="Copy id to clipboard"
        className={`cursor-pointer leading-none transition-opacity ${copied ? 'opacity-100 text-success-600 dark:text-success-400' : 'opacity-50 hover:opacity-100'}`}
      >
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  );
};

export default CopyId;
