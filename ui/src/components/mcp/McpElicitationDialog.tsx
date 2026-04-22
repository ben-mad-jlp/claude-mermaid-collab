import { useState, useEffect, useId } from 'react';
import type { McpElicitationRequest, McpElicitationField } from '../../hooks/usePendingMcpElicitation';

export interface McpElicitationDialogProps {
  request: McpElicitationRequest | null;
  onSubmit: (elicitationId: string, values: Record<string, string | number | boolean>) => void;
  onDismiss: () => void;
}

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none';

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: McpElicitationField;
  value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
}) {
  const id = useId();
  const label = field.label ?? field.name;

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {field.required && <span className="text-red-500 ml-1" aria-hidden>*</span>}
      </label>
      {field.type === 'boolean' ? (
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={e => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
      ) : field.type === 'enum' ? (
        <select
          id={id}
          value={String(value)}
          onChange={e => onChange(e.target.value)}
          className={inputClass}
        >
          {(field.options ?? []).map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={field.type === 'number' ? 'number' : 'text'}
          value={String(value)}
          onChange={e => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
          className={inputClass}
          required={field.required}
        />
      )}
    </div>
  );
}

function initValues(fields: McpElicitationField[]): Record<string, string | number | boolean> {
  const init: Record<string, string | number | boolean> = {};
  for (const f of fields) {
    switch (f.type) {
      case 'boolean': init[f.name] = false; break;
      case 'number':  init[f.name] = 0; break;
      case 'enum':    init[f.name] = f.options?.[0] ?? ''; break;
      default:        init[f.name] = ''; break;
    }
  }
  return init;
}

export function McpElicitationDialog({ request, onSubmit, onDismiss }: McpElicitationDialogProps) {
  const titleId = useId();
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});

  useEffect(() => {
    if (request) setValues(initValues(request.fields));
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [request, onDismiss]);

  if (!request) return null;

  function handleChange(name: string, val: string | number | boolean) {
    setValues(v => ({ ...v, [name]: val }));
  }

  function handleSubmit() {
    onSubmit(request!.elicitationId, values);
  }

  return (
    <>
      <div
        data-testid="mcp-elicitation-dialog-backdrop"
        className="fixed inset-0 z-50 bg-black bg-opacity-50"
        onClick={onDismiss}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
      >
        <div
          data-testid="mcp-elicitation-dialog"
          className="pointer-events-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-w-lg w-full mx-4 p-6"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 id={titleId} className="text-base font-semibold text-gray-900 dark:text-white">
              {request.server} is requesting information
            </h2>
            <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M15 5L5 15M5 5l10 10" />
              </svg>
            </button>
          </div>

          {/* Prompt */}
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-5">{request.prompt}</p>

          {/* Fields */}
          <div className="space-y-4">
            {request.fields.map(field => (
              <FieldInput
                key={field.name}
                field={field}
                value={values[field.name] ?? ''}
                onChange={val => handleChange(field.name, val)}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="mt-6 flex justify-end gap-3 border-t border-gray-200 dark:border-gray-700 pt-4">
            <button
              type="button"
              onClick={onDismiss}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default McpElicitationDialog;
