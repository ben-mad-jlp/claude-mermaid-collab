import { useEffect, useState } from 'react';

export interface DiffFile {
  path: string;
  status: string;
  patch: string;
}

export interface DiffViewerProps {
  sessionId: string;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'A':
      return 'bg-green-100 text-green-800';
    case 'D':
      return 'bg-red-100 text-red-800';
    case 'R':
      return 'bg-blue-100 text-blue-800';
    case '??':
      return 'bg-yellow-100 text-yellow-800';
    case 'M':
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function statusLabel(status: string): string {
  if (status === '??') return 'U';
  return status;
}

function renderPatchLine(line: string, i: number) {
  let cls = 'text-gray-700';
  if (line.startsWith('+++') || line.startsWith('---')) {
    cls = 'text-gray-500 font-semibold';
  } else if (line.startsWith('@@')) {
    cls = 'text-purple-600';
  } else if (line.startsWith('+')) {
    cls = 'text-green-700 bg-green-50';
  } else if (line.startsWith('-')) {
    cls = 'text-red-700 bg-red-50';
  } else if (line.startsWith('diff ') || line.startsWith('index ')) {
    cls = 'text-gray-400';
  }
  return (
    <div key={i} className={`whitespace-pre ${cls}`}>
      {line || '\u00A0'}
    </div>
  );
}

export default function DiffViewer({ sessionId }: DiffViewerProps) {
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/agent/worktree-diff?sessionId=${encodeURIComponent(sessionId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as DiffFile[];
      })
      .then((data) => {
        if (cancelled) return;
        const arr = Array.isArray(data) ? data : [];
        setFiles(arr);
        setSelected(arr.length > 0 ? arr[0].path : null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load diff');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loading) {
    return (
      <div data-testid="diff-viewer-loading" className="p-4 text-sm text-gray-500">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="diff-viewer-error" className="p-4 text-sm text-red-600">
        {error}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div data-testid="diff-viewer-empty" className="p-4 text-sm text-gray-500">
        No changes
      </div>
    );
  }

  const current = files.find((f) => f.path === selected) ?? files[0];

  return (
    <div data-testid="diff-viewer" className="flex h-full w-full">
      <div
        data-testid="diff-file-list"
        className="w-64 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50"
      >
        <ul>
          {files.map((f) => {
            const isSelected = f.path === current.path;
            return (
              <li key={f.path}>
                <button
                  type="button"
                  data-testid={`diff-file-${f.path}`}
                  onClick={() => setSelected(f.path)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-100 ${
                    isSelected ? 'bg-white font-medium' : ''
                  }`}
                >
                  <span
                    className={`inline-block min-w-[20px] rounded px-1 text-center text-xs font-mono ${statusBadgeClass(
                      f.status,
                    )}`}
                  >
                    {statusLabel(f.status)}
                  </span>
                  <span className="truncate" title={f.path}>
                    {f.path}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div
        data-testid="diff-patch"
        className="flex-1 overflow-auto bg-white p-3 font-mono text-xs leading-5"
      >
        {current.patch
          ? current.patch.split('\n').map((line, i) => renderPatchLine(line, i))
          : <div className="text-gray-400 italic">(empty patch)</div>}
      </div>
    </div>
  );
}
