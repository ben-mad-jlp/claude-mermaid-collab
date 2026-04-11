import { useEffect, useState } from 'react';

interface PseudoDbStatus {
  schemaVersion: number;
  fileCount: number;
  filesWithProse: number;
  proseBreakdown: {
    heuristic: number;
    manual: number;
    llm: number;
    mixed: number;
    none: number;
  };
  lastScan: {
    id: number;
    trigger: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    files_scanned: number;
    errors: number;
  } | null;
  isScanning: boolean;
  scanProgress: { current: number; total: number } | null;
  warnings: {
    orphanCount: number;
    crossBranchOrphanCount: number;
    renameWarnings: number;
    paramDriftWarnings: number;
  };
  ctagsAvailable: boolean;
  ctagsVersion: string | null;
  cacheMode: 'memory' | 'warm-loaded' | 'cold';
  handleStatus: string;
  lastError: string | null;
}

interface PseudoStatusBarProps {
  project: string;
  fetchStatus: (project: string) => Promise<PseudoDbStatus>;
}

export function PseudoStatusBar({ project, fetchStatus }: PseudoStatusBarProps) {
  const [status, setStatus] = useState<PseudoDbStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const s = await fetchStatus(project);
        if (mounted) {
          setStatus(s);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void poll();
    const interval = status?.isScanning ? 2000 : 10000;
    const timer = setInterval(poll, interval);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [project, fetchStatus, status?.isScanning]);

  if (error) {
    return <div className="pseudo-status-bar error">Pseudo: {error}</div>;
  }
  if (!status) {
    return <div className="pseudo-status-bar loading">Pseudo: loading…</div>;
  }

  const progressText = status.scanProgress
    ? `${status.scanProgress.current}/${status.scanProgress.total}`
    : null;

  const totalWarnings =
    status.warnings.orphanCount +
    status.warnings.renameWarnings +
    status.warnings.paramDriftWarnings;

  return (
    <div className="pseudo-status-bar" data-scanning={status.isScanning}>
      <span className="schema">v{status.schemaVersion}</span>
      <span className="files">{status.fileCount} files</span>
      <span className="prose">
        {status.filesWithProse} with prose ({status.proseBreakdown.manual}m / {status.proseBreakdown.llm}l / {status.proseBreakdown.heuristic}h)
      </span>
      {status.isScanning && progressText && (
        <span className="scanning">scanning {progressText}</span>
      )}
      {totalWarnings > 0 && (
        <span className="warnings">{totalWarnings} warnings</span>
      )}
      <span className="cache">{status.cacheMode}</span>
      {!status.ctagsAvailable && (
        <span className="ctags-missing" title="ctags not installed — Go/Rust/Java/Kotlin/Ruby scanning disabled">no ctags</span>
      )}
    </div>
  );
}
