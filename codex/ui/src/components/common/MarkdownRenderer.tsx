/**
 * MarkdownRenderer Component
 *
 * Markdown to HTML renderer with styling for common elements.
 * Handles headings, code blocks, lists, links, and inline formatting.
 */

import React from 'react';

export interface MarkdownRendererProps {
  /** Markdown content to render */
  content: string;
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

    if (line.startsWith('#### ')) {
      elements.push(
        <h4
          key={getKey()}
          className="text-base font-bold mt-3 mb-2 text-gray-900 dark:text-white"
        >
          {line.slice(5)}
        </h4>
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

    // Handle blockquotes
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote
          key={getKey()}
          className="pl-4 border-l-4 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 italic my-3"
        >
          {renderInlineMarkdown(line.slice(2))}
        </blockquote>
      );
      continue;
    }

    // Handle horizontal rules
    if (line.match(/^[-*_]{3,}$/)) {
      elements.push(
        <hr
          key={getKey()}
          className="my-6 border-gray-200 dark:border-gray-700"
        />
      );
      continue;
    }

    // Handle regular paragraphs
    elements.push(
      <p
        key={getKey()}
        className="mb-3 text-gray-700 dark:text-gray-300 leading-relaxed"
      >
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
        parts.push(
          processTextFormatting(remaining.slice(0, codeMatch.index), getKey)
        );
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
        parts.push(
          processTextFormatting(remaining.slice(0, linkMatch.index), getKey)
        );
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
function processTextFormatting(
  text: string,
  getKey: () => string
): React.ReactNode {
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

  // Handle italic
  const italicMatch = text.match(/\*([^*]+)\*/);
  if (italicMatch && italicMatch.index !== undefined) {
    const parts: React.ReactNode[] = [];
    if (italicMatch.index > 0) {
      parts.push(text.slice(0, italicMatch.index));
    }
    parts.push(
      <em key={getKey()} className="italic">
        {italicMatch[1]}
      </em>
    );
    if (italicMatch.index + italicMatch[0].length < text.length) {
      parts.push(text.slice(italicMatch.index + italicMatch[0].length));
    }
    return parts;
  }

  return text;
}

/**
 * MarkdownRenderer component - Renders markdown content as styled HTML
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = '',
}) => {
  if (!content || content.trim() === '') {
    return (
      <div
        className={`
          flex items-center justify-center
          min-h-[100px]
          text-gray-400 dark:text-gray-600
          ${className}
        `}
      >
        No content
      </div>
    );
  }

  return (
    <article
      className={`
        max-w-none
        prose prose-sm dark:prose-invert
        ${className}
      `}
    >
      {renderMarkdown(content)}
    </article>
  );
};

export default MarkdownRenderer;
