import React from 'react';
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  wrapInBlockquoteCommand,
  toggleLinkCommand,
  turnIntoTextCommand,
} from '@milkdown/preset-commonmark';
import { toggleStrikethroughCommand } from '@milkdown/preset-gfm';
import { wrapInList } from '@milkdown/prose/schema-list';
import type { MilkdownEditorHandle } from './milkdown/MilkdownEditor';

export interface FormattingToolbarProps {
  editorRef: React.MutableRefObject<MilkdownEditorHandle | null>;
}

const btnCls =
  'inline-flex items-center justify-center w-8 h-8 text-sm font-medium rounded-md transition-colors bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700';

const sepCls = 'w-px h-5 bg-gray-300 dark:bg-gray-600 mx-0.5';

export const FormattingToolbar: React.FC<FormattingToolbarProps> = ({ editorRef }) => {
  const run = React.useCallback(
    (key: unknown, payload?: unknown) => (e: React.MouseEvent) => {
      e.preventDefault();
      const handle = editorRef.current;
      if (!handle) return;
      handle.getView()?.focus();
      handle.runCommand(key as never, payload as never);
    },
    [editorRef],
  );

  const wrapList = React.useCallback(
    (nodeName: 'bullet_list' | 'ordered_list') => (e: React.MouseEvent) => {
      e.preventDefault();
      const handle = editorRef.current;
      if (!handle) return;
      const view = handle.getView();
      if (!view) return;
      const type = view.state.schema.nodes[nodeName];
      if (!type) return;
      wrapInList(type)(view.state, view.dispatch);
      view.focus();
    },
    [editorRef],
  );

  return (
    <div
      className="flex items-center gap-1 px-2 py-1 bg-white/90 dark:bg-gray-800/90 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm"
      role="toolbar"
      aria-label="Formatting"
      data-testid="document-formatting-toolbar"
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" className={btnCls} title="Heading 1" aria-label="Heading 1" onClick={run(wrapInHeadingCommand.key, 1)}>H1</button>
      <button type="button" className={btnCls} title="Heading 2" aria-label="Heading 2" onClick={run(wrapInHeadingCommand.key, 2)}>H2</button>
      <button type="button" className={btnCls} title="Heading 3" aria-label="Heading 3" onClick={run(wrapInHeadingCommand.key, 3)}>H3</button>
      <button type="button" className={btnCls} title="Body text" aria-label="Body text" onClick={run(turnIntoTextCommand.key)}>P</button>
      <span className={sepCls} aria-hidden="true" />
      <button type="button" className={`${btnCls} font-bold`} title="Bold (Ctrl+B)" aria-label="Bold" onClick={run(toggleStrongCommand.key)}>B</button>
      <button type="button" className={`${btnCls} italic`} title="Italic (Ctrl+I)" aria-label="Italic" onClick={run(toggleEmphasisCommand.key)}>I</button>
      <button type="button" className={`${btnCls} line-through`} title="Strikethrough" aria-label="Strikethrough" onClick={run(toggleStrikethroughCommand.key)}>S</button>
      <button type="button" className={`${btnCls} font-mono`} title="Inline code" aria-label="Inline code" onClick={run(toggleInlineCodeCommand.key)}>{'<>'}</button>
      <span className={sepCls} aria-hidden="true" />
      <button type="button" className={btnCls} title="Bulleted list" aria-label="Bulleted list" onClick={wrapList('bullet_list')}>•</button>
      <button type="button" className={btnCls} title="Numbered list" aria-label="Numbered list" onClick={wrapList('ordered_list')}>1.</button>
      <button type="button" className={btnCls} title="Blockquote" aria-label="Blockquote" onClick={run(wrapInBlockquoteCommand.key)}>&gt;</button>
      <span className={sepCls} aria-hidden="true" />
      <button
        type="button"
        className={btnCls}
        title="Link"
        aria-label="Link"
        onClick={(e) => {
          e.preventDefault();
          const handle = editorRef.current;
          if (!handle) return;
          const href = window.prompt('Link URL');
          if (!href) return;
          handle.getView()?.focus();
          handle.runCommand(toggleLinkCommand.key, { href });
        }}
      >
        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 11a4 4 0 005.657 0l3-3a4 4 0 10-5.657-5.657l-1.1 1.1M12 9a4 4 0 00-5.657 0l-3 3a4 4 0 105.657 5.657l1.1-1.1" />
        </svg>
      </button>
    </div>
  );
};

export default FormattingToolbar;
