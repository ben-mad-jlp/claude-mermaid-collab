import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { fetchCodeFile, CodeFileResponse, CodeFileNotFoundError, peekPseudoFile } from '@/lib/pseudo-api';
import MonacoWrapper, { type Language } from './MonacoWrapper';
import { reportEditorDirty } from '@/hooks/useEditorAutoPromote';
import { mark } from '@/lib/perf-bus';

const PseudoViewerLazy = lazy(() =>
  import('@/pages/pseudo/PseudoViewer').then((m) => ({ default: m.PseudoViewer }))
);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export interface CodeFileViewProps {
  path: string;
  project: string;
  editMode: boolean;
  tabId: string;
}

const ProseMountedBeacon: React.FC = () => {
  useEffect(() => {
    mark('prose-mounted');
  }, []);
  return null;
};

export const CodeFileView: React.FC<CodeFileViewProps> = ({ path, project, editMode, tabId }) => {
  const [codeFileViewMode, setCodeFileViewMode] = useState<'code' | 'prose'>('code');

  const [data, setData] = useState<CodeFileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [allowLarge, setAllowLarge] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    mark('code-fetch-start');
    fetchCodeFile(project, path, { signal: controller.signal, allowLarge })
      .then((d) => {
        if (controller.signal.aborted) return;
        mark('code-fetch-end');
        setData(d);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (e instanceof Error && e.name === 'AbortError') return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setData(null);
      })
      .finally(() => {
        // Guard: React may have cleaned up this effect (aborting the
        // controller) and started a new fetch that already called
        // setLoading(true). Clobbering it here would flash a non-loading,
        // empty state until the new fetch resolves.
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, project, reloadTick, allowLarge]);

  useLayoutEffect(() => {
    if (!loading && data) {
      const raf = requestAnimationFrame(() => mark('code-first-paint'));
      return () => cancelAnimationFrame(raf);
    }
  }, [loading, data]);

  const handleChange = useCallback(
    (_value: string) => {
      reportEditorDirty(tabId);
    },
    [tabId]
  );

  const pseudo = useMemo(
    () => (data?.kind === 'text' ? peekPseudoFile(project, path) : null),
    [project, path, data?.kind]
  );
  const drift = useMemo(() => {
    if (!pseudo?.syncedAt || data?.kind !== 'text') return false;
    const syncedMs = Date.parse(pseudo.syncedAt);
    if (!Number.isFinite(syncedMs)) return false;
    return data.mtimeMs > syncedMs + 86400000;
  }, [pseudo, data]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 text-sm">
        <span className="font-mono text-xs text-gray-600 dark:text-gray-300 truncate flex-1" title={path}>
          {path}
        </span>
<div className="inline-flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
          <button
            type="button"
            onClick={() => setCodeFileViewMode('code')}
            className={`px-2 py-0.5 text-xs ${
              codeFileViewMode === 'code'
                ? 'bg-blue-500 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200'
            }`}
          >
            Code
          </button>
          <button
            type="button"
            onClick={() => {
              mark('prose-toggle');
              setCodeFileViewMode('prose');
            }}
            title={drift ? 'Prose is >1 day older than source' : undefined}
            className={`px-2 py-0.5 text-xs border-l border-gray-300 dark:border-gray-600 ${
              codeFileViewMode === 'prose'
                ? 'bg-blue-500 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200'
            }`}
          >
            Prose
            {drift && <span className="ml-1 px-1 text-[10px] rounded bg-amber-500 text-white">stale</span>}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">Loading...</div>
        ) : error ? (
          error instanceof CodeFileNotFoundError ? (
            <div className="h-full flex items-center justify-center text-gray-500 text-sm">File not found.</div>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500 text-sm gap-2">
              <span>Failed to load.</span>
              <button
                type="button"
                onClick={() => setReloadTick((t) => t + 1)}
                className="px-2 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-xs"
              >
                Retry
              </button>
            </div>
          )
        ) : !data ? null : data.kind === 'text' ? (
          data.truncated ? (
            <div className="h-full flex items-center justify-center gap-2 text-gray-500 text-sm">
              <span>File too large ({formatBytes(data.sizeBytes)})</span>
              <button
                type="button"
                onClick={() => setAllowLarge(true)}
                className="px-2 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-xs"
              >
                Fetch anyway
              </button>
            </div>
          ) : codeFileViewMode === 'prose' ? (
            <Suspense
              fallback={<div className="h-full flex items-center justify-center text-gray-500 text-sm">Loading prose...</div>}
            >
              <ProseMountedBeacon />
              <PseudoViewerLazy path={path} project={project} />
            </Suspense>
          ) : (
            <MonacoWrapper
              value={data.content}
              onChange={handleChange}
              language={(data.language ?? 'text') as Language}
              readOnly={!editMode}
              height="100%"
            />
          )
        ) : data.kind === 'image' ? (
          <div className="h-full flex items-center justify-center overflow-auto p-4">
            <img src={data.dataUrl} alt={path} className="max-w-full max-h-full object-contain" />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">
            Binary file &mdash; {formatBytes(data.sizeBytes)}
          </div>
        )}
      </div>
    </div>
  );
};

export default CodeFileView;
