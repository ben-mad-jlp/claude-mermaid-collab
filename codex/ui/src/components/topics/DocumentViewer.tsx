/**
 * DocumentViewer Component
 *
 * Markdown document viewer with syntax highlighting support.
 * Renders markdown content in a scrollable container.
 */

import React from 'react';

export interface DocumentViewerProps {
  /** Markdown content to render */
  content: string;
  /** Optional title for the document */
  title?: string;
  /** Loading state */
  isLoading?: boolean;
  /** Optional additional class name */
  className?: string;
}

/**
 * Simple markdown renderer
 * For production, consider using react-markdown with plugins
 */
function renderMarkdown(content: string): React.ReactNode {
  // Split content into lines for processing
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLanguage = '';
  let keyCounter = 0;

  const getKey = () => `md-${keyCounter++}`;

  for (const line of lines) {
    // Handle code blocks
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLanguage = line.slice(3).trim();
        codeBlockContent = [];
      } else {
        // End of code block
        inCodeBlock = false;
        elements.push(
          <div key={getKey()} className="mb-4">
            {codeBlockLanguage && (
              <div className="px-4 py-1 text-xs font-mono text-gray-400 bg-gray-800 rounded-t-lg border-b border-gray-700">
                {codeBlockLanguage}
              </div>
            )}
            <pre
              className={`
                p-4 overflow-x-auto text-sm font-mono
                bg-gray-100 dark:bg-gray-800
                text-gray-800 dark:text-gray-200
                ${codeBlockLanguage ? 'rounded-b-lg' : 'rounded-lg'}
              `}
            >
              <code>{codeBlockContent.join('\n')}</code>
            </pre>
          </div>
        );
        codeBlockLanguage = '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Handle empty lines
    if (line.trim() === '') {
      elements.push(<div key={getKey()} className="h-4" />);
      continue;
    }

    // Handle headers
    if (line.startsWith('# ')) {
      elements.push(
        <h1
          key={getKey()}
          className="text-2xl font-bold mt-6 mb-4 text-gray-900 dark:text-white"
        >
          {line.slice(2)}
        </h1>
      );
      continue;
    }

    if (line.startsWith('## ')) {
      elements.push(
        <h2
          key={getKey()}
          className="text-xl font-bold mt-5 mb-3 text-gray-900 dark:text-white"
        >
          {line.slice(3)}
        </h2>
      );
      continue;
    }

    if (line.startsWith('### ')) {
      elements.push(
        <h3
          key={getKey()}
          className="text-lg font-bold mt-4 mb-2 text-gray-900 dark:text-white"
        >
          {line.slice(4)}
        </h3>
      );
      continue;
    }

    // Handle list items
    if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <li
          key={getKey()}
          className="ml-4 text-gray-700 dark:text-gray-300 list-disc list-inside"
        >
          {renderInlineMarkdown(line.slice(2))}
        </li>
      );
      continue;
    }

    // Handle numbered list items
    const numberedListMatch = line.match(/^(\d+)\.\s/);
    if (numberedListMatch) {
      elements.push(
        <li
          key={getKey()}
          className="ml-4 text-gray-700 dark:text-gray-300 list-decimal list-inside"
        >
          {renderInlineMarkdown(line.slice(numberedListMatch[0].length))}
        </li>
      );
      continue;
    }

    // Handle regular paragraphs
    elements.push(
      <p key={getKey()} className="mb-3 text-gray-700 dark:text-gray-300 leading-relaxed">
        {renderInlineMarkdown(line)}
      </p>
    );
  }

  return elements;
}

/**
 * Render inline markdown (bold, italic, code, links)
 */
function renderInlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyCounter = 0;

  const getKey = () => `inline-${keyCounter++}`;

  while (remaining.length > 0) {
    // Handle inline code
    const codeMatch = remaining.match(/`([^`]+)`/);
    if (codeMatch && codeMatch.index !== undefined) {
      if (codeMatch.index > 0) {
        parts.push(processTextFormatting(remaining.slice(0, codeMatch.index), getKey));
      }
      parts.push(
        <code
          key={getKey()}
          className="px-1.5 py-0.5 text-sm font-mono bg-gray-200 dark:bg-gray-700 text-red-600 dark:text-red-400 rounded"
        >
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch.index + codeMatch[0].length);
      continue;
    }

    // Handle links
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch && linkMatch.index !== undefined) {
      if (linkMatch.index > 0) {
        parts.push(processTextFormatting(remaining.slice(0, linkMatch.index), getKey));
      }
      parts.push(
        <a
          key={getKey()}
          href={linkMatch[2]}
          className="text-accent-600 dark:text-accent-400 hover:underline"
        >
          {linkMatch[1]}
        </a>
      );
      remaining = remaining.slice(linkMatch.index + linkMatch[0].length);
      continue;
    }

    // No more special formatting, add remaining text
    parts.push(processTextFormatting(remaining, getKey));
    break;
  }

  return parts;
}

/**
 * Process bold and italic formatting
 */
function processTextFormatting(text: string, getKey: () => string): React.ReactNode {
  // Handle bold
  const boldMatch = text.match(/\*\*([^*]+)\*\*/);
  if (boldMatch && boldMatch.index !== undefined) {
    const parts: React.ReactNode[] = [];
    if (boldMatch.index > 0) {
      parts.push(text.slice(0, boldMatch.index));
    }
    parts.push(
      <strong key={getKey()} className="font-semibold">
        {boldMatch[1]}
      </strong>
    );
    if (boldMatch.index + boldMatch[0].length < text.length) {
      parts.push(text.slice(boldMatch.index + boldMatch[0].length));
    }
    return parts;
  }

  return text;
}

/**
 * DocumentViewer component - Markdown document viewer
 */
export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  content,
  title,
  isLoading = false,
  className = '',
}) => {
  if (isLoading) {
    return (
      <div
        className={`
          flex items-center justify-center
          h-full min-h-[200px]
          bg-white dark:bg-gray-800
          rounded-lg
          ${className}
        `}
      >
        <div className="flex flex-col items-center gap-3">
          <svg
            className="animate-spin w-6 h-6 text-accent-500"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Loading document...
          </span>
        </div>
      </div>
    );
  }

  if (!content || content.trim() === '') {
    return (
      <div
        className={`
          flex items-center justify-center
          h-full min-h-[200px]
          bg-white dark:bg-gray-800
          rounded-lg
          ${className}
        `}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <svg
            className="w-12 h-12 text-gray-300 dark:text-gray-600"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
              clipRule="evenodd"
            />
          </svg>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No content available
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`
        flex flex-col
        h-full
        bg-white dark:bg-gray-800
        rounded-lg
        overflow-hidden
        ${className}
      `}
    >
      {/* Optional title bar */}
      {title && (
        <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {title}
          </h2>
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6">
        <article className="max-w-none prose prose-sm dark:prose-invert">
          {renderMarkdown(content)}
        </article>
      </div>
    </div>
  );
};

export default DocumentViewer;
