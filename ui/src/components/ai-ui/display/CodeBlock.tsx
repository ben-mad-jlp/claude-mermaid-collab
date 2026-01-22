import React, { useRef } from 'react';
import Highlight from 'react-syntax-highlighter';
import { atomOneDark, atomOneLight } from 'react-syntax-highlighter/dist/cjs/styles/hljs';

export interface CodeBlockProps {
  code: string;
  language?: string;
  lineNumbers?: boolean;
  highlightLines?: number[];
  copyButton?: boolean;
  maxHeight?: string;
  ariaLabel?: string;
  theme?: 'light' | 'dark';
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language = 'text',
  lineNumbers = true,
  highlightLines = [],
  copyButton = true,
  maxHeight = '400px',
  ariaLabel,
  theme = 'dark',
}) => {
  const [copied, setCopied] = React.useState(false);
  const codeRef = useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const isDarkMode = theme === 'dark';
  const syntaxTheme = isDarkMode ? atomOneDark : atomOneLight;

  return (
    <div
      className="relative w-full rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden bg-gray-50 dark:bg-gray-900"
      role="region"
      aria-label={ariaLabel || `Code block in ${language}`}
    >
      {/* Header with language and copy button */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          {language}
        </span>
        {copyButton && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors duration-200"
            title="Copy code"
            aria-label="Copy code to clipboard"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Copied!</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <span>Copy</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Code container */}
      <div
        ref={codeRef}
        className="overflow-auto"
        style={{ maxHeight, backgroundColor: isDarkMode ? '#282c34' : '#f5f5f5' }}
      >
        <Highlight
          language={language}
          code={code}
          style={syntaxTheme as any}
          customStyle={{
            margin: 0,
            padding: '16px',
            backgroundColor: 'transparent',
            fontFamily: 'Fira Code, Menlo, Monaco, Courier New, monospace',
            fontSize: '13px',
            lineHeight: '1.5',
          } as any}
          showLineNumbers={lineNumbers}
          {...({ wrapLongLines: true } as any)}
        />
      </div>

      {/* Accessibility helper */}
      <pre className="sr-only" aria-label={`Code content in ${language}`}>
        {code}
      </pre>
    </div>
  );
};

CodeBlock.displayName = 'CodeBlock';
