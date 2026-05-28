import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { fetchCodeFile, CodeFileResponse, CodeFileNotFoundError } from '@/lib/code-file-api';
import MonacoWrapper, { type Language } from './MonacoWrapper';
import { reportEditorDirty } from '@/hooks/useEditorAutoPromote';
import { mark } from '@/lib/perf-bus';

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

export const CodeFileView: React.FC<CodeFileViewProps> = ({ path, project, editMode, tabId }) => {
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

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 text-sm">
        <span className="font-mono text-xs text-gray-600 dark:text-gray-300 truncate flex-1" title={path}>
          {path}
        </span>
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
