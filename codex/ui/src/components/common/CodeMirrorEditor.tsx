/**
 * CodeMirrorEditor Component
 *
 * Text editor component styled as a code editor.
 * Uses a textarea with monospace font and optional line numbers.
 * For production, consider integrating actual CodeMirror or Monaco.
 */

import React, { useCallback, useMemo } from 'react';

export interface CodeMirrorEditorProps {
  /** Current editor content */
  value: string;
  /** Callback when content changes */
  onChange: (value: string) => void;
  /** Language hint for syntax highlighting (placeholder for future) */
  language?: string;
  /** Placeholder text when empty */
  placeholder?: string;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Whether to show line numbers */
  showLineNumbers?: boolean;
  /** Minimum height in pixels */
  minHeight?: number;
  /** Optional additional class name */
  className?: string;
}

/**
 * CodeMirrorEditor component - Textarea styled as code editor
 */
export const CodeMirrorEditor: React.FC<CodeMirrorEditorProps> = ({
  value,
  onChange,
  language,
  placeholder = 'Enter content...',
  readOnly = false,
  showLineNumbers = true,
  minHeight = 300,
  className = '',
}) => {
  // Calculate line numbers
  const lineNumbers = useMemo(() => {
    const lines = value.split('\n');
    return lines.map((_, index) => index + 1);
  }, [value]);

  // Handle textarea change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!readOnly) {
        onChange(e.target.value);
      }
    },
    [onChange, readOnly]
  );

  // Handle tab key for indentation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (readOnly) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        // Insert tab at cursor position
        const newValue =
          value.substring(0, start) + '  ' + value.substring(end);
        onChange(newValue);

        // Move cursor after the inserted spaces
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        }, 0);
      }
    },
    [value, onChange, readOnly]
  );

  return (
    <div
      className={`
        flex
        bg-gray-50 dark:bg-gray-900
        border border-gray-300 dark:border-gray-600
        rounded-lg
        overflow-hidden
        ${className}
      `}
      style={{ minHeight }}
    >
      {/* Line numbers gutter */}
      {showLineNumbers && (
        <div
          className="
            flex-shrink-0
            py-3 px-2
            bg-gray-100 dark:bg-gray-800
            border-r border-gray-200 dark:border-gray-700
            text-right
            select-none
            overflow-hidden
          "
          aria-hidden="true"
        >
          {lineNumbers.map((num) => (
            <div
              key={num}
              className="
                text-xs
                font-mono
                leading-5
                text-gray-400 dark:text-gray-600
              "
            >
              {num}
            </div>
          ))}
        </div>
      )}

      {/* Editor content */}
      <div className="flex-1 relative">
        {/* Language badge */}
        {language && (
          <div
            className="
              absolute top-2 right-2
              px-2 py-0.5
              text-xs font-medium
              bg-gray-200 dark:bg-gray-700
              text-gray-600 dark:text-gray-400
              rounded
            "
          >
            {language}
          </div>
        )}

        <textarea
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          readOnly={readOnly}
          spellCheck={false}
          className={`
            w-full h-full
            py-3 px-4
            text-sm
            font-mono
            leading-5
            bg-transparent
            text-gray-900 dark:text-gray-100
            placeholder-gray-400 dark:placeholder-gray-600
            resize-none
            focus:outline-none
            ${readOnly ? 'cursor-default' : ''}
          `}
          style={{ minHeight: minHeight - 2 }}
        />
      </div>
    </div>
  );
};

export default CodeMirrorEditor;
