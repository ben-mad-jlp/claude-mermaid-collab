import React, { useEffect, useRef, useState } from 'react';

export interface ModelIndicatorProps {
  model: string;
  onChange?: (model: string) => void;
  models?: string[];
}

const DEFAULT_MODELS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
];

/**
 * Compact pill button showing the active model. Click to open a dropdown
 * of available models; selecting one invokes `onChange`.
 */
export const ModelIndicator: React.FC<ModelIndicatorProps> = ({
  model,
  onChange,
  models,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const choices = models && models.length > 0 ? models : DEFAULT_MODELS;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const handlePick = (m: string) => {
    setOpen(false);
    if (m !== model) onChange?.(m);
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-0.5 text-[11px] font-medium rounded-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-mono"
      >
        {model}
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-20 mt-1 min-w-[14rem] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1 text-xs"
        >
          {choices.map((m) => {
            const active = m === model;
            return (
              <li key={m} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => handlePick(m)}
                  className={
                    'block w-full text-left px-3 py-1.5 font-mono ' +
                    (active
                      ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                      : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700')
                  }
                >
                  {m}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

ModelIndicator.displayName = 'ModelIndicator';

export default ModelIndicator;
