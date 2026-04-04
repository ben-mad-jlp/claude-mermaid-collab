import React, { useState, useRef, useCallback } from 'react';
import { Embed } from '../types/embed';

type ViewportMode = 'mobile' | 'tablet' | 'desktop' | 'custom' | 'full';

const presetViewports: Record<'mobile' | 'tablet' | 'desktop', { width: number; height: number; radius: string; border: number }> = {
  mobile: { width: 411, height: 823, radius: '2rem', border: 8 },
  tablet: { width: 768, height: 1024, radius: '1.5rem', border: 8 },
  desktop: { width: 1280, height: 800, radius: '0.75rem', border: 4 },
};

interface EmbedViewerProps {
  embed: Embed;
}

export function EmbedViewer({ embed }: EmbedViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [viewport, setViewport] = useState<ViewportMode>(embed.subtype === 'storybook' ? 'mobile' : 'full');
  const [customWidth, setCustomWidth] = useState(600);
  const [customHeight, setCustomHeight] = useState(900);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    setError(false);
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  }, []);

  const isStorybook = embed.subtype === 'storybook';
  const isFramed = viewport !== 'full';

  const getFrameStyle = () => {
    if (viewport === 'custom') {
      return { width: customWidth, height: customHeight, radius: '0.75rem', border: 4 };
    }
    if (viewport !== 'full') {
      return presetViewports[viewport];
    }
    return null;
  };

  const frameStyle = getFrameStyle();

  const ViewportButton = ({ mode, title, children }: { mode: ViewportMode; title: string; children: React.ReactNode }) => (
    <button
      onClick={() => {
        if (mode === 'custom') {
          if (viewport === 'custom') {
            setViewport('full');
            setShowCustomInput(false);
          } else {
            setViewport('custom');
            setShowCustomInput(true);
          }
        } else {
          setViewport(viewport === mode ? 'full' : mode);
          setShowCustomInput(false);
        }
      }}
      className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
        viewport === mode
          ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400'
          : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500'
      }`}
      title={title}
    >
      {children}
    </button>
  );

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
              <ViewportButton mode="mobile" title="Mobile (411×823)">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="7" y="2" width="10" height="20" rx="2" />
                  <line x1="12" y1="18" x2="12" y2="18" strokeLinecap="round" />
                </svg>
              </ViewportButton>
              <ViewportButton mode="tablet" title="Tablet (768×1024)">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="5" y="2" width="14" height="20" rx="2" />
                  <line x1="12" y1="18" x2="12" y2="18" strokeLinecap="round" />
                </svg>
              </ViewportButton>
              <ViewportButton mode="desktop" title="Desktop (1280×800)">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" strokeLinecap="round" />
                  <line x1="12" y1="17" x2="12" y2="21" strokeLinecap="round" />
                </svg>
              </ViewportButton>
              <ViewportButton mode="custom" title="Custom size">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </ViewportButton>
              <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-0.5" />
            </>
          )}
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
        </div>
      </div>

      {/* Custom size inputs */}
      {showCustomInput && viewport === 'custom' && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <label className="text-xs text-gray-500 dark:text-gray-400">W</label>
          <input
            type="number"
            value={customWidth}
            onChange={(e) => setCustomWidth(Math.max(100, parseInt(e.target.value) || 100))}
            className="w-16 px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
          <label className="text-xs text-gray-500 dark:text-gray-400">H</label>
          <input
            type="number"
            value={customHeight}
            onChange={(e) => setCustomHeight(Math.max(100, parseInt(e.target.value) || 100))}
            className="w-16 px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
          <span className="text-xs text-gray-400 dark:text-gray-500">px</span>
        </div>
      )}

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

        {isFramed && frameStyle ? (
          <div className="flex items-center justify-center h-full bg-gray-800 dark:bg-gray-950 p-5 overflow-auto">
            <div
              style={{
                width: `${frameStyle.width}px`,
                height: `${frameStyle.height}px`,
                borderWidth: `${frameStyle.border}px`,
                borderRadius: frameStyle.radius,
              }}
              className="border-gray-600 overflow-hidden bg-white shadow-2xl shrink-0"
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
