/**
 * MarkdownPreview Component
 *
 * Renders Markdown content with:
 * - Syntax highlighting for code blocks
 * - Responsive styling with Tailwind
 * - Theme support (light/dark mode)
 * - Safe HTML rendering
 * - Diff highlighting for document patches
 */

import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from '@/hooks/useTheme';

export interface MarkdownPreviewProps {
  /** The Markdown content to render */
  content: string;
  /** Optional CSS class name for the container */
  className?: string;
  /** Optional diff highlighting info */
  diff?: {
    oldContent: string;
    newContent: string;
  } | null;
  /** Callback when user clears the diff */
  onClearDiff?: () => void;
}

/**
 * Compute line-by-line diff between old and new content
 * Returns segments with type: 'unchanged', 'added', or 'removed'
 */
function computeLineDiff(
  oldContent: string,
  newContent: string
): Array<{ type: 'unchanged' | 'added' | 'removed'; content: string }> {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const segments: Array<{
    type: 'unchanged' | 'added' | 'removed';
    content: string;
  }> = [];

  // Simple line-by-line diff using LCS approach
  const lcs = computeLCS(oldLines, newLines);
  let oldIdx = 0;
  let newIdx = 0;

  for (const [oIdx, nIdx] of lcs) {
    // Add removed lines before old index reaches oIdx
    while (oldIdx < oIdx) {
      segments.push({ type: 'removed', content: oldLines[oldIdx] });
      oldIdx++;
    }

    // Add added lines before new index reaches nIdx
    while (newIdx < nIdx) {
      segments.push({ type: 'added', content: newLines[newIdx] });
      newIdx++;
    }

    // Add unchanged line
    segments.push({ type: 'unchanged', content: oldLines[oldIdx] });
    oldIdx++;
    newIdx++;
  }

  // Add remaining removed lines
  while (oldIdx < oldLines.length) {
    segments.push({ type: 'removed', content: oldLines[oldIdx] });
    oldIdx++;
  }

  // Add remaining added lines
  while (newIdx < newLines.length) {
    segments.push({ type: 'added', content: newLines[newIdx] });
    newIdx++;
  }

  return segments;
}

/**
 * Compute Longest Common Subsequence
 */
function computeLCS(
  oldLines: string[],
  newLines: string[]
): Array<[number, number]> {
  const m = oldLines.length;
  const n = newLines.length;

  // Create DP table
  const dp = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  // Fill DP table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Reconstruct LCS indices
  const result: Array<[number, number]> = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      result.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

/**
 * Markdown preview component with syntax highlighting
 *
 * Renders Markdown content with:
 * - Code syntax highlighting using Prism
 * - Theme-aware styling (light/dark mode)
 * - Responsive typography
 * - Safe HTML rendering
 * - Diff highlighting for document patches
 *
 * @example
 * ```tsx
 * <MarkdownPreview
 *   content="# Hello\n\nThis is **markdown** content"
 *   diff={{
 *     oldContent: "# Hello\n\nOld content",
 *     newContent: "# Hello\n\nNew content"
 *   }}
 *   onClearDiff={() => console.log('cleared')}
 * />
 * ```
 */
export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  className = '',
  diff,
  onClearDiff,
}) => {
  const { theme } = useTheme();

  // Memoize the markdown components to avoid unnecessary re-renders
  const components = useMemo(
    () => ({
      // Headings
      h1: ({ children }: { children?: React.ReactNode }) => (
        <h1 className="text-3xl font-bold mt-6 mb-4 text-gray-900 dark:text-white">
          {children}
        </h1>
      ),
      h2: ({ children }: { children?: React.ReactNode }) => (
        <h2 className="text-2xl font-bold mt-5 mb-3 text-gray-800 dark:text-gray-100">
          {children}
        </h2>
      ),
      h3: ({ children }: { children?: React.ReactNode }) => (
        <h3 className="text-xl font-bold mt-4 mb-2 text-gray-700 dark:text-gray-200">
          {children}
        </h3>
      ),
      h4: ({ children }: { children?: React.ReactNode }) => (
        <h4 className="text-lg font-bold mt-3 mb-2 text-gray-700 dark:text-gray-200">
          {children}
        </h4>
      ),
      h5: ({ children }: { children?: React.ReactNode }) => (
        <h5 className="text-base font-bold mt-2 mb-1 text-gray-700 dark:text-gray-200">
          {children}
        </h5>
      ),
      h6: ({ children }: { children?: React.ReactNode }) => (
        <h6 className="text-sm font-bold mt-2 mb-1 text-gray-700 dark:text-gray-200">
          {children}
        </h6>
      ),

      // Paragraphs
      p: ({ children }: { children?: React.ReactNode }) => (
        <p className="my-3 text-gray-700 dark:text-gray-300 leading-relaxed">
          {children}
        </p>
      ),

      // Text styling
      strong: ({ children }: { children?: React.ReactNode }) => (
        <strong className="font-bold text-gray-900 dark:text-white">
          {children}
        </strong>
      ),
      em: ({ children }: { children?: React.ReactNode }) => (
        <em className="italic text-gray-700 dark:text-gray-300">
          {children}
        </em>
      ),

      // Links
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          {children}
        </a>
      ),

      // Lists
      ul: ({ children }: { children?: React.ReactNode }) => (
        <ul className="list-disc list-inside my-3 ml-2 text-gray-700 dark:text-gray-300">
          {children}
        </ul>
      ),
      ol: ({ children }: { children?: React.ReactNode }) => (
        <ol className="list-decimal list-inside my-3 ml-2 text-gray-700 dark:text-gray-300">
          {children}
        </ol>
      ),
      li: ({ children }: { children?: React.ReactNode }) => (
        <li className="my-1">{children}</li>
      ),

      // Code blocks
      code: ({
        inline,
        className: codeClassName,
        children,
      }: {
        inline?: boolean;
        className?: string;
        children?: React.ReactNode;
      }) => {
        const match = /language-(\w+)/.exec(codeClassName || '');
        const language = match ? match[1] : 'text';
        const code = String(children).replace(/\n$/, '');

        if (inline) {
          return (
            <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded font-mono text-sm text-gray-900 dark:text-gray-100">
              {code}
            </code>
          );
        }

        return (
          <div className="my-4 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
            <SyntaxHighlighter
              language={language}
              style={theme === 'dark' ? oneDark : oneLight}
              showLineNumbers={false}
              customStyle={{
                margin: 0,
                padding: '1rem',
                fontSize: '0.875rem',
              }}
            >
              {code}
            </SyntaxHighlighter>
          </div>
        );
      },

      // Blockquotes
      blockquote: ({ children }: { children?: React.ReactNode }) => (
        <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 my-4 italic text-gray-600 dark:text-gray-400">
          {children}
        </blockquote>
      ),

      // Horizontal rule
      hr: () => (
        <hr className="my-4 border-t-2 border-gray-300 dark:border-gray-600" />
      ),

      // Tables
      table: ({ children }: { children?: React.ReactNode }) => (
        <table className="my-4 w-full border-collapse border border-gray-300 dark:border-gray-600">
          {children}
        </table>
      ),
      thead: ({ children }: { children?: React.ReactNode }) => (
        <thead className="bg-gray-100 dark:bg-gray-800">{children}</thead>
      ),
      tbody: ({ children }: { children?: React.ReactNode }) => (
        <tbody>{children}</tbody>
      ),
      tr: ({ children }: { children?: React.ReactNode }) => (
        <tr className="border-b border-gray-300 dark:border-gray-600">
          {children}
        </tr>
      ),
      td: ({ children }: { children?: React.ReactNode }) => (
        <td className="p-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300">
          {children}
        </td>
      ),
      th: ({ children }: { children?: React.ReactNode }) => (
        <th className="p-2 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white font-bold text-left">
          {children}
        </th>
      ),
    }),
    [theme]
  );

  // Compute diff segments if diff is provided
  const diffSegments = useMemo(() => {
    if (!diff) return null;
    try {
      return computeLineDiff(diff.oldContent, diff.newContent);
    } catch (error) {
      console.error('Failed to compute diff:', error);
      return null;
    }
  }, [diff]);


  return (
    <div
      className={`markdown-preview-container w-full h-full flex flex-col ${className}`}
      data-testid="markdown-preview"
    >
      {/* Clear Diff Button */}
      {diff && (
        <div className="flex justify-end p-2 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={onClearDiff}
            className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded border border-gray-300 dark:border-gray-600"
          >
            Clear Diff
          </button>
        </div>
      )}

      {/* Content Area */}
      {content?.trim() ? (
        <div
          className="prose dark:prose-invert max-w-none bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700 flex-1 overflow-auto"
          data-testid="markdown-content"
        >
          {diff && diffSegments ? (
            // Render with diff highlighting
            <div>
              {diffSegments.map((segment, idx) => {
                if (segment.type === 'unchanged') {
                  return (
                    <div key={idx} className="diff-unchanged">
                      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
                        {segment.content}
                      </ReactMarkdown>
                    </div>
                  );
                } else if (segment.type === 'added') {
                  return (
                    <div key={idx} className="diff-added">
                      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
                        {segment.content}
                      </ReactMarkdown>
                    </div>
                  );
                } else {
                  return (
                    <div key={idx} className="diff-removed">
                      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
                        {segment.content}
                      </ReactMarkdown>
                    </div>
                  );
                }
              })}
            </div>
          ) : (
            // Render normally
            <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center flex-1 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Enter Markdown content to preview
          </p>
        </div>
      )}
    </div>
  );
};

export default MarkdownPreview;
