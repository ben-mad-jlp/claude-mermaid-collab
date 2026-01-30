import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Highlight from 'react-syntax-highlighter';
import { atomOneDark, atomOneLight } from 'react-syntax-highlighter/dist/cjs/styles/hljs';

export interface MarkdownProps {
  content: string;
  allowHtml?: boolean;
  strikethrough?: boolean;
  tables?: boolean;
  codeHighlight?: boolean;
  ariaLabel?: string;
}

export const Markdown: React.FC<MarkdownProps> = ({
  content,
  allowHtml = false,
  strikethrough = true,
  tables = true,
  codeHighlight = true,
  ariaLabel,
}) => {
  const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

  // Custom renderers for markdown elements
  const components = {
    h1: ({ node, ...props }: any) => (
      <h1
        className="text-3xl font-bold mt-6 mb-4 text-gray-900 dark:text-white"
        {...props}
      />
    ),
    h2: ({ node, ...props }: any) => (
      <h2
        className="text-2xl font-bold mt-5 mb-3 text-gray-900 dark:text-white"
        {...props}
      />
    ),
    h3: ({ node, ...props }: any) => (
      <h3
        className="text-xl font-bold mt-4 mb-2 text-gray-900 dark:text-white"
        {...props}
      />
    ),
    h4: ({ node, ...props }: any) => (
      <h4
        className="text-lg font-bold mt-3 mb-2 text-gray-900 dark:text-white"
        {...props}
      />
    ),
    h5: ({ node, ...props }: any) => (
      <h5 className="text-base font-bold mt-2 mb-1 text-gray-900 dark:text-white" {...props} />
    ),
    h6: ({ node, ...props }: any) => (
      <h6
        className="text-sm font-bold mt-2 mb-1 text-gray-900 dark:text-white"
        {...props}
      />
    ),
    p: ({ node, children, ...props }: any) => {
      // Check if children contain block-level elements (like code blocks wrapped in divs)
      // If so, render as div instead of p to avoid invalid nesting
      const hasBlockChildren = React.Children.toArray(children).some((child: any) => {
        if (!React.isValidElement(child)) return false;

        // Check for block-level native elements
        if (child.type === 'div' || child.type === 'pre') return true;

        // Check for custom components (functions) that might render blocks
        if (typeof child.type === 'function') {
          const childProps = child.props as any;
          // Code elements render as block when inline is explicitly false or has language class
          if (childProps?.inline === false) return true;
          if (childProps?.className && /language-/.test(childProps.className)) return true;
        }

        // Check for class components with displayName
        if (typeof child.type === 'object' && 'displayName' in (child.type as any)) return true;

        return false;
      });

      if (hasBlockChildren) {
        return (
          <div className="mb-3 text-gray-700 dark:text-gray-300 leading-relaxed" {...props}>
            {children}
          </div>
        );
      }

      return (
        <p className="mb-3 text-gray-700 dark:text-gray-300 leading-relaxed" {...props}>
          {children}
        </p>
      );
    },
    blockquote: ({ node, ...props }: any) => (
      <blockquote
        className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic text-gray-600 dark:text-gray-400 my-3"
        {...props}
      />
    ),
    ul: ({ node, ...props }: any) => (
      <ul className="list-disc list-inside mb-3 text-gray-700 dark:text-gray-300" {...props} />
    ),
    ol: ({ node, ...props }: any) => (
      <ol className="list-decimal list-inside mb-3 text-gray-700 dark:text-gray-300" {...props} />
    ),
    li: ({ node, ...props }: any) => <li className="mb-1" {...props} />,
    table: ({ node, ...props }: any) => (
      <div className="overflow-x-auto mb-3">
        <table
          className="border-collapse border border-gray-300 dark:border-gray-600 w-full text-sm"
          {...props}
        />
      </div>
    ),
    thead: ({ node, ...props }: any) => (
      <thead
        className="bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-600"
        {...props}
      />
    ),
    tbody: ({ node, ...props }: any) => <tbody {...props} />,
    tr: ({ node, ...props }: any) => (
      <tr
        className="border-b border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
        {...props}
      />
    ),
    th: ({ node, ...props }: any) => (
      <th
        className="px-4 py-2 text-left font-semibold text-gray-900 dark:text-white border-r border-gray-300 dark:border-gray-600"
        {...props}
      />
    ),
    td: ({ node, ...props }: any) => (
      <td
        className="px-4 py-2 text-gray-700 dark:text-gray-300 border-r border-gray-300 dark:border-gray-600"
        {...props}
      />
    ),
    code: ({ node, inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : 'text';

      // Only render as block if explicitly not inline AND has a language class (fenced code block)
      // This prevents inline code from accidentally rendering as block when inline is undefined
      const isCodeBlock = inline === false || (match && inline !== true);

      if (isCodeBlock && codeHighlight) {
        const code = String(children).replace(/\n$/, '');
        return (
          <div className="mb-3 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
            <Highlight
              language={language}
              style={(isDarkMode ? atomOneDark : atomOneLight) as any}
              customStyle={{
                margin: 0,
                padding: '12px 16px',
                fontSize: '13px',
                lineHeight: '1.5',
                background: isDarkMode ? '#282c34' : '#fafafa',
              } as any}
              {...({ wrapLongLines: true } as any)}
            >
              {code}
            </Highlight>
          </div>
        );
      }

      return inline ? (
        <code
          className="px-2 py-1 bg-gray-200 dark:bg-gray-800 text-red-600 dark:text-red-400 rounded text-sm font-mono"
          {...props}
        >
          {children}
        </code>
      ) : (
        <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg overflow-x-auto mb-3 text-sm font-mono text-gray-900 dark:text-gray-100">
          <code>{children}</code>
        </pre>
      );
    },
    a: ({ node, ...props }: any) => (
      <a
        className="text-blue-600 dark:text-blue-400 hover:underline hover:text-blue-700 dark:hover:text-blue-300"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      />
    ),
    img: ({ node, ...props }: any) => (
      <img
        className="max-w-full h-auto rounded-lg my-3 border border-gray-300 dark:border-gray-600"
        {...props}
      />
    ),
    hr: ({ node, ...props }: any) => (
      <hr className="my-4 border-gray-300 dark:border-gray-600" {...props} />
    ),
    del: ({ node, ...props }: any) => (
      <del className="line-through text-gray-600 dark:text-gray-400" {...props} />
    ),
  };

  return (
    <div
      className="w-full mb-4 rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden bg-white dark:bg-gray-900"
      role="region"
      aria-label={ariaLabel || 'Markdown content'}
    >
      <div className="p-6 max-h-96 overflow-auto prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown
          components={components as any}
          remarkPlugins={tables !== false ? [remarkGfm] : []}
          skipHtml={!allowHtml}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
};

Markdown.displayName = 'Markdown';
