import React, { useState, useRef, useCallback } from 'react';
import { Embed } from '../types/embed';

interface EmbedViewerProps {
  embed: Embed;
}

export function EmbedViewer({ embed }: EmbedViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [phoneFrame, setPhoneFrame] = useState(embed.subtype === 'storybook');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    setError(false);
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  }, []);

  const isStorybook = embed.subtype === 'storybook';

  return (
    <div className="flex flex-col h-full" data-testid="embed-viewer">
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <span className="text-sm font-medium truncate text-gray-900 dark:text-gray-100">
          {embed.name}
        </span>
        <div className="flex items-center gap-1">
          {isStorybook && (
            <>
              <button
                onClick={() => setPhoneFrame(!phoneFrame)}
                className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
                  phoneFrame
                    ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500'
                }`}
                title="Toggle phone frame"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="7" y="2" width="10" height="20" rx="2" />
                  <line x1="12" y1="18" x2="12" y2="18" strokeLinecap="round" />
                </svg>
              </button>
              <button
                onClick={handleRefresh}
                className="w-8 h-8 rounded flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors"
                title="Refresh"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M4 4v5h5M20 20v-5h-5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M20.49 9A9 9 0 0 0 5.64 5.64L4 7m16 10l-1.64 1.36A9 9 0 0 1 3.51 15" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          )}
          {!isStorybook && (
            <button
              onClick={handleRefresh}
              className="w-8 h-8 rounded flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors"
              title="Refresh"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M4 4v5h5M20 20v-5h-5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L4 7m16 10l-1.64 1.36A9 9 0 0 1 3.51 15" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 relative overflow-hidden">
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
            <p className="text-sm mb-2">Failed to load embed</p>
            <button
              onClick={handleRefresh}
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : null}

        {loading && !error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-gray-900/50 z-10">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : null}

        {phoneFrame ? (
          <div className="flex items-center justify-center h-full bg-gray-800 dark:bg-gray-950 p-5">
            <div
              style={{ width: '411px', height: '823px' }}
              className="border-[8px] border-gray-600 rounded-[2rem] overflow-hidden bg-white shadow-2xl"
            >
              <iframe
                ref={iframeRef}
                src={embed.url}
                sandbox="allow-scripts allow-same-origin allow-popups"
                onLoad={() => { setLoading(false); setError(false); }}
                onError={() => { setLoading(false); setError(true); }}
                className="w-full h-full border-0"
                title={embed.name}
              />
            </div>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={embed.url}
            sandbox="allow-scripts allow-same-origin allow-popups"
            onLoad={() => { setLoading(false); setError(false); }}
            onError={() => { setLoading(false); setError(true); }}
            className="w-full h-full border-0"
            title={embed.name}
            style={{ width: embed.width || '100%', height: embed.height || '100%' }}
          />
        )}
      </div>
    </div>
  );
}

export default EmbedViewer;
