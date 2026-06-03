/**
 * Renderer — the in-house walker for a validated escalation `ui` spec
 * (BR-4, design §4/§6). It maps each closed-catalog element to a presentational
 * component; the only interactive elements (OptionButton, Form, SubmitButton)
 * resolve to the two existing actions passed in (decide / submit). No element
 * renders raw HTML and no prop is executable — CodeBlock and DiffView render as
 * plain text.
 *
 * (The 404'd `@vercel-labs/json-render` package is replaced by this ~closed
 * walker, which better fits the closed-catalog security posture: it can only
 * ever render the ten catalog components.)
 */

import React, { useState } from 'react';
import type { JsonRenderSpec, UiElement } from './catalog';

export interface RendererProps {
  spec: JsonRenderSpec;
  onDecide: (optionId: string) => void;
  onSubmit: (payload: Record<string, string>) => void;
}

const CALLOUT_TONE: Record<'info' | 'success' | 'warning' | 'danger', string> = {
  info: 'border-info-300 bg-info-50 text-info-800 dark:border-info-700 dark:bg-info-900/30 dark:text-info-200',
  success: 'border-success-300 bg-success-50 text-success-800 dark:border-success-700 dark:bg-success-900/30 dark:text-success-200',
  warning: 'border-warning-300 bg-warning-50 text-warning-800 dark:border-warning-700 dark:bg-warning-900/30 dark:text-warning-200',
  danger: 'border-danger-300 bg-danger-50 text-danger-800 dark:border-danger-700 dark:bg-danger-900/30 dark:text-danger-200',
};

const FormBlock: React.FC<{
  element: Extract<UiElement, { type: 'Form' }>;
  onSubmit: (payload: Record<string, string>) => void;
}> = ({ element, onSubmit }) => {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      {element.fields.map((f) => (
        <label key={f.name} className="block">
          <span className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-0.5">{f.label}</span>
          {f.kind === 'textarea' ? (
            <textarea
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm outline-none"
              value={values[f.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
          ) : (
            <input
              type="text"
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm outline-none"
              value={values[f.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
          )}
        </label>
      ))}
      <button
        type="submit"
        className="px-3 py-1.5 text-sm font-medium rounded bg-accent-600 text-white hover:bg-accent-700 transition-colors"
      >
        {element.submitLabel ?? 'Submit'}
      </button>
    </form>
  );
};

function renderElement(
  element: UiElement,
  idx: number,
  onDecide: (optionId: string) => void,
  onSubmit: (payload: Record<string, string>) => void,
): React.ReactNode {
  switch (element.type) {
    case 'Heading': {
      const size = element.level === 1 ? 'text-lg' : element.level === 2 ? 'text-base' : 'text-sm';
      return <div key={idx} className={`${size} font-semibold text-gray-900 dark:text-gray-100`}>{element.text}</div>;
    }
    case 'Text':
      return <p key={idx} className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{element.text}</p>;
    case 'Callout':
      return (
        <div key={idx} className={`rounded-md border px-3 py-2 text-sm ${CALLOUT_TONE[element.tone]}`}>
          {element.text}
        </div>
      );
    case 'CodeBlock':
      return (
        <pre key={idx} className="rounded-md bg-gray-900 text-gray-100 text-xs font-mono p-3 overflow-x-auto">
          <code>{element.code}</code>
        </pre>
      );
    case 'DiffView':
      return (
        <div key={idx} className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-2 py-1 text-xs font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">{element.filename}</div>
          <pre className="text-xs font-mono p-2 bg-danger-50 dark:bg-danger-900/20 text-danger-800 dark:text-danger-200 overflow-x-auto whitespace-pre-wrap">- {element.before}</pre>
          <pre className="text-xs font-mono p-2 bg-success-50 dark:bg-success-900/20 text-success-800 dark:text-success-200 overflow-x-auto whitespace-pre-wrap">+ {element.after}</pre>
        </div>
      );
    case 'CompareTable':
      return (
        <table key={idx} className="w-full text-xs border border-gray-200 dark:border-gray-700">
          <thead>
            <tr>
              {element.columns.map((c, i) => (
                <th key={i} className="border border-gray-200 dark:border-gray-700 px-2 py-1 text-left font-semibold bg-gray-50 dark:bg-gray-800">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {element.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className="border border-gray-200 dark:border-gray-700 px-2 py-1">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'KeyValue':
      return (
        <dl key={idx} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {element.pairs.map((p, i) => (
            <React.Fragment key={i}>
              <dt className="text-gray-500 dark:text-gray-400">{p.key}</dt>
              <dd className="text-gray-800 dark:text-gray-200">{p.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      );
    case 'OptionButton':
      return (
        <button
          key={idx}
          type="button"
          onClick={() => onDecide(element.optionId)}
          className={`w-full text-left px-3 py-2 rounded-md border text-sm transition-colors ${
            element.recommended
              ? 'border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/30 text-accent-800 dark:text-accent-200 hover:bg-accent-100'
              : 'border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          <span className="font-medium">{element.label}</span>
          {element.recommended && <span className="ml-1.5 text-xs font-semibold text-accent-600 dark:text-accent-400">★ recommended</span>}
        </button>
      );
    case 'Form':
      return <FormBlock key={idx} element={element} onSubmit={onSubmit} />;
    case 'SubmitButton':
      return (
        <button
          key={idx}
          type="button"
          onClick={() => onSubmit(element.payload ?? {})}
          className="px-3 py-1.5 text-sm font-medium rounded bg-accent-600 text-white hover:bg-accent-700 transition-colors"
        >
          {element.label}
        </button>
      );
    default:
      return null;
  }
}

export const Renderer: React.FC<RendererProps> = ({ spec, onDecide, onSubmit }) => (
  <div data-testid="focal-renderer" className="space-y-3">
    {spec.elements.map((el, i) => renderElement(el, i, onDecide, onSubmit))}
  </div>
);

export default Renderer;
