import React, { useState } from 'react';

export interface JsonViewerProps {
  data: Record<string, any>;
  collapsed?: boolean;
  expandDepth?: number;
  copyable?: boolean;
  maxDepth?: number;
  ariaLabel?: string;
}

interface NodeProps {
  value: any;
  path: string;
  depth: number;
  maxDepth?: number;
  expandDepth?: number;
}

const JsonNode: React.FC<NodeProps> = ({ value, path, depth, maxDepth, expandDepth }) => {
  const [isExpanded, setIsExpanded] = useState(
    expandDepth === undefined ? depth === 0 : depth < expandDepth
  );

  const key = path.split('.').pop() || 'root';
  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);
  const shouldShowToggle = isObject && (isArray ? value.length > 0 : Object.keys(value).length > 0);
  const reachedMaxDepth = maxDepth !== undefined && depth >= maxDepth;
  const canExpand = !reachedMaxDepth;

  if (!isObject) {
    return (
      <div className="ml-4 text-sm font-mono">
        <span className="text-purple-600 dark:text-purple-400">{key}</span>
        <span className="text-gray-700 dark:text-gray-300">: </span>
        <span
          className={
            typeof value === 'string'
              ? 'text-green-600 dark:text-green-400'
              : typeof value === 'number'
                ? 'text-blue-600 dark:text-blue-400'
                : value === null
                  ? 'text-gray-500'
                  : value === true || value === false
                    ? 'text-orange-600 dark:text-orange-400'
                    : 'text-gray-700 dark:text-gray-300'
          }
        >
          {typeof value === 'string' ? `"${value}"` : String(value)}
        </span>
      </div>
    );
  }

  const entries = isArray ? value.map((v: any, i: number) => [i, v]) : Object.entries(value);
  const isEmpty = entries.length === 0;

  return (
    <div className="ml-2">
      <div className="flex items-start gap-1 text-sm font-mono">
        {shouldShowToggle && canExpand && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-0 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            aria-expanded={isExpanded}
            aria-label={`Toggle expansion of ${key}`}
          >
            {isExpanded ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        )}
        {shouldShowToggle && !canExpand && (
          <div className="w-4" />
        )}
        {!shouldShowToggle && isEmpty && (
          <div className="w-4" />
        )}

        <span className="text-purple-600 dark:text-purple-400">{key}</span>
        <span className="text-gray-700 dark:text-gray-300">: </span>
        <span className="text-gray-700 dark:text-gray-300">
          {isArray ? '[' : '{'}
          {isEmpty ? (isArray ? ']' : '}') : ''}
        </span>
      </div>

      {isExpanded && !isEmpty && (
        <div className="ml-4">
          {entries.map((entry: any, index: number) => {
            const [k, v] = entry as [any, any];
            return (
              <div key={index}>
                <JsonNode
                  value={v}
                  path={`${path}.${k}`}
                  depth={depth + 1}
                  maxDepth={maxDepth}
                  expandDepth={expandDepth}
                />
              </div>
            );
          })}
        </div>
      )}

      {isExpanded && !isEmpty && (
        <div className="ml-4 text-sm font-mono text-gray-700 dark:text-gray-300">
          {isArray ? ']' : '}'}
        </div>
      )}
    </div>
  );
};

export const JsonViewer: React.FC<JsonViewerProps> = ({
  data,
  collapsed = false,
  expandDepth = 2,
  copyable = true,
  maxDepth,
  ariaLabel,
}) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy JSON:', err);
    }
  };

  const isEmpty = Object.keys(data).length === 0;

  return (
    <div
      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden bg-white dark:bg-gray-900"
      role="region"
      aria-label={ariaLabel || 'JSON viewer'}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-600">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">JSON</span>
        {copyable && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors duration-200"
            aria-label="Copy JSON to clipboard"
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

      {/* Content */}
      <div className="p-4 overflow-auto max-h-96 bg-white dark:bg-gray-900">
        {isEmpty ? (
          <div className="text-center text-gray-500 dark:text-gray-400 text-sm">
            Empty JSON object
          </div>
        ) : (
          <div className="text-sm font-mono">
            <span className="text-gray-700 dark:text-gray-300">{'{'}</span>
            <div className="ml-4">
              <JsonNode
                value={data}
                path="root"
                depth={0}
                maxDepth={maxDepth}
                expandDepth={collapsed ? 0 : expandDepth}
              />
            </div>
            <span className="text-gray-700 dark:text-gray-300">{'}'}</span>
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-400">
        <span>{Object.keys(data).length} keys</span>
        {maxDepth && <span className="ml-4">Max depth: {maxDepth}</span>}
      </div>
    </div>
  );
};

JsonViewer.displayName = 'JsonViewer';
